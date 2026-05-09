"""Finnhub WebSocket client implementing MarketDataSource.

Connection model: a single long-lived WebSocket to `wss://ws.finnhub.io?token=...`.
Subscribes to one symbol per `{"type":"subscribe","symbol":<T>}` frame.
Trade messages (`{type:"trade", data:[{p,s,t,v}]}`) are written into the
shared `PriceCache`, which is what the SSE stream and the rest of the app
read from.

Reconnection
------------
Authentication failures (401 / "invalid token" close frame) are surfaced as
`MarketDataAuthError` from `start()` so the factory can fall back to the
simulator. *After* a successful start, transient disconnects are recovered
by an internal task with exponential backoff (1s -> 30s cap).

Concurrency
-----------
`start()` is awaited once. After it returns, `add_ticker` /
`remove_ticker` send subscribe / unsubscribe frames over the established
connection. A single internal task owns the receive loop; reconnects are
serialized through that task. The active subscription set is kept in-memory
so re-subscribes happen automatically after a reconnect.

Tickers added via `add_ticker` are NOT persisted across restart.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import httpx
import websockets
from websockets.exceptions import (
    ConnectionClosed,
    ConnectionClosedError,
    InvalidStatus,
)

from .cache import PriceCache
from .interface import MarketDataAuthError, MarketDataSource

logger = logging.getLogger(__name__)


FINNHUB_WS_URL_TEMPLATE = "wss://ws.finnhub.io?token={token}"
FINNHUB_REST_QUOTE_URL = "https://finnhub.io/api/v1/quote"

# How often to refresh REST quotes when the WS is silent (off-hours).
# 5 minutes keeps us well under Finnhub's 60-calls/min free tier (50 tickers
# every 5 min ≈ 0.17 calls/sec average).
REST_REFRESH_INTERVAL_SECONDS = 300.0

# Reconnect backoff: 1, 2, 4, 8, 16, 30, 30, ... (capped)
INITIAL_BACKOFF_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 30.0
BACKOFF_MULTIPLIER = 2.0

# How long start() waits for the initial connection before giving up
# (and surfacing whatever happened — auth error, network error, etc.)
INITIAL_CONNECT_TIMEOUT = 10.0


class FinnhubDataSource(MarketDataSource):
    """Real-time market data via Finnhub's WebSocket trades feed."""

    def __init__(
        self,
        api_key: str,
        price_cache: PriceCache,
        url_template: str = FINNHUB_WS_URL_TEMPLATE,
    ) -> None:
        self._api_key = api_key
        self._cache = price_cache
        self._url = url_template.format(token=api_key)

        # Active subscription set (uppercase ticker symbols).
        self._tickers: set[str] = set()

        # Tickers we've issued a subscribe frame for on the *current* socket.
        # Reset every reconnect so the recv loop knows what to re-send.
        self._subscribed_on_current_ws: set[str] = set()

        # Live WebSocket; None when disconnected / before start.
        self._ws: Any | None = None
        self._ws_lock = asyncio.Lock()

        # The recv-and-reconnect task. Owns the lifetime of `self._ws`.
        self._task: asyncio.Task[None] | None = None
        # Background task that polls REST quotes on a slow cadence so the cache
        # has prices outside US market hours (when the WS sends nothing).
        self._rest_refresh_task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()

        # Set the first time the recv loop has a working connection so that
        # `start()` can wait for the initial handshake before returning.
        self._first_connect_event = asyncio.Event()
        self._first_connect_error: BaseException | None = None

    # ------------------------------------------------------------------
    # MarketDataSource public API
    # ------------------------------------------------------------------

    async def start(self, tickers: list[str]) -> None:
        """Open the WebSocket and subscribe to `tickers`.

        Before opening the WebSocket we fetch a REST `/quote` for every
        ticker so the cache has real prices immediately, even outside US
        market hours when the WS is silent. We then start a background task
        that re-polls those quotes every few minutes so the cache doesn't
        go stale during a long market-closed window.

        Raises `MarketDataAuthError` if the initial connection is rejected
        with a 401 or an obvious "invalid token" close frame. Other
        transient errors are absorbed and retried in the background.
        """
        self._tickers = {t.upper().strip() for t in tickers}
        self._stopping.clear()
        self._first_connect_event.clear()
        self._first_connect_error = None

        # Seed the cache with the latest REST quote for each ticker so the
        # UI has prices to render right away, regardless of market hours.
        await self._refresh_rest_quotes(sorted(self._tickers))

        # Start the slow REST refresher in the background.
        self._rest_refresh_task = asyncio.create_task(
            self._rest_refresh_loop(), name="finnhub-rest-refresh"
        )

        self._task = asyncio.create_task(self._run_loop(), name="finnhub-loop")

        try:
            await asyncio.wait_for(
                self._first_connect_event.wait(),
                timeout=INITIAL_CONNECT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            # We didn't get a working connection in time. The loop keeps
            # trying in the background, but the caller (factory at boot)
            # may want to fall back.
            if isinstance(self._first_connect_error, MarketDataAuthError):
                await self._cleanup()
                raise self._first_connect_error
            logger.warning(
                "Finnhub initial connect timed out; continuing with retries in background"
            )
            return

        if self._first_connect_error is not None:
            err = self._first_connect_error
            await self._cleanup()
            raise err

        logger.info(
            "Finnhub started with %d ticker subscriptions",
            len(self._tickers),
        )

    async def stop(self) -> None:
        await self._cleanup()

    async def add_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        if not ticker:
            return
        if ticker in self._tickers:
            return
        self._tickers.add(ticker)
        await self._send_frame({"type": "subscribe", "symbol": ticker})
        self._subscribed_on_current_ws.add(ticker)
        logger.info("Finnhub: subscribed to %s", ticker)

    async def remove_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        if not ticker:
            return
        was_known = ticker in self._tickers
        self._tickers.discard(ticker)
        self._subscribed_on_current_ws.discard(ticker)
        self._cache.remove(ticker)
        if was_known:
            await self._send_frame({"type": "unsubscribe", "symbol": ticker})
            logger.info("Finnhub: unsubscribed from %s", ticker)

    def get_tickers(self) -> list[str]:
        return sorted(self._tickers)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _cleanup(self) -> None:
        self._stopping.set()
        # Close the WS first so the recv loop unblocks.
        ws = self._ws
        if ws is not None:
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        if self._rest_refresh_task and not self._rest_refresh_task.done():
            self._rest_refresh_task.cancel()
            try:
                await self._rest_refresh_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None
        self._rest_refresh_task = None
        self._ws = None
        self._subscribed_on_current_ws.clear()
        logger.info("Finnhub stopped")

    async def _refresh_rest_quotes(self, tickers: list[str]) -> None:
        """Fetch `/quote` for every ticker in parallel and seed the cache.

        Free tier permits 60 calls/min; we cap concurrency at 10 to be polite
        and finish 50 quotes in well under 10 seconds. Failures are logged
        and skipped — a single bad ticker shouldn't poison the batch.
        """
        if not tickers:
            return
        semaphore = asyncio.Semaphore(10)
        timeout = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            await asyncio.gather(
                *(self._fetch_one_quote(client, semaphore, t) for t in tickers),
                return_exceptions=True,
            )

    async def _fetch_one_quote(
        self,
        client: httpx.AsyncClient,
        semaphore: asyncio.Semaphore,
        ticker: str,
    ) -> None:
        async with semaphore:
            try:
                resp = await client.get(
                    FINNHUB_REST_QUOTE_URL,
                    params={"symbol": ticker, "token": self._api_key},
                )
            except (httpx.HTTPError, OSError) as e:
                logger.debug("Finnhub REST quote failed for %s: %s", ticker, e)
                return
        if resp.status_code != 200:
            logger.debug("Finnhub REST quote %s -> HTTP %s", ticker, resp.status_code)
            return
        try:
            payload = resp.json()
        except ValueError:
            return
        # Free-tier shape: {"c":..., "d":..., "dp":..., "h":..., "l":..., "o":..., "pc":..., "t":...}
        # `c` = current/last price, `pc` = previous close, `t` = unix seconds.
        try:
            price = float(payload.get("c") or 0.0)
            prev_close = float(payload.get("pc") or 0.0)
            ts = float(payload.get("t") or time.time())
        except (TypeError, ValueError):
            return
        if price <= 0.0:
            # Finnhub returns c=0 for unknown tickers; skip rather than
            # poisoning the cache with a zero.
            logger.debug("Finnhub REST quote %s returned zero price; skipping", ticker)
            return
        # Seed the cache with TWO updates so `direction` becomes up/down (not
        # flat) and the SSE payload carries a real previous_price that the
        # frontend can use to draw a 2-point chart immediately.
        if prev_close > 0.0 and abs(prev_close - price) > 1e-6:
            # First write yesterday's close at the prior session's timestamp,
            # then today's quote at its real time. The cache's previous_price
            # ends up = prev_close, price = c, direction = sign(c - pc).
            self._cache.update(ticker=ticker, price=prev_close, timestamp=ts - 86400.0)
            self._cache.update(ticker=ticker, price=price, timestamp=ts)
        else:
            self._cache.update(ticker=ticker, price=price, timestamp=ts)

    async def _rest_refresh_loop(self) -> None:
        """Periodically re-fetch REST quotes so the cache stays fresh during
        long market-closed windows when the WebSocket emits nothing."""
        try:
            while not self._stopping.is_set():
                try:
                    await asyncio.wait_for(
                        self._stopping.wait(),
                        timeout=REST_REFRESH_INTERVAL_SECONDS,
                    )
                    return  # stopping
                except asyncio.TimeoutError:
                    pass
                if self._stopping.is_set():
                    return
                try:
                    await self._refresh_rest_quotes(sorted(self._tickers))
                except Exception:  # noqa: BLE001
                    logger.exception("Finnhub: background REST refresh failed")
        except asyncio.CancelledError:
            raise

    async def _send_frame(self, frame: dict[str, Any]) -> None:
        """Send a JSON frame on the live WS. Silent no-op if disconnected.

        After a reconnect, the recv loop replays subscriptions for every
        ticker in `self._tickers`, so a frame lost during a disconnect
        isn't a correctness problem.
        """
        async with self._ws_lock:
            ws = self._ws
            if ws is None:
                return
            try:
                await ws.send(json.dumps(frame))
            except (ConnectionClosed, OSError):
                # Disconnect mid-send; recv loop will reconnect.
                pass
            except Exception:  # noqa: BLE001
                logger.exception("Finnhub: send failed")

    async def _run_loop(self) -> None:
        """Top-level connect/recv/reconnect loop."""
        backoff = INITIAL_BACKOFF_SECONDS
        first_attempt = True

        while not self._stopping.is_set():
            try:
                await self._connect_and_serve()
                # Healthy shutdown of the current connection (e.g. stop()).
                # Reset backoff for the next attempt and continue (or break
                # if stopping flag has been set in the meantime).
                backoff = INITIAL_BACKOFF_SECONDS
            except MarketDataAuthError as e:
                # Auth failure — surface to start() if this was the first try
                # and let the loop end. We do not retry an auth failure.
                if first_attempt and not self._first_connect_event.is_set():
                    self._first_connect_error = e
                    self._first_connect_event.set()
                logger.error("Finnhub: auth failure (%s); not retrying", e)
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.warning("Finnhub: connection error (%s); reconnect in %.1fs", e, backoff)
            finally:
                first_attempt = False

            if self._stopping.is_set():
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_SECONDS)

    async def _connect_and_serve(self) -> None:
        """Open a connection, subscribe, and process incoming messages.

        Raises:
            MarketDataAuthError: if the upstream rejects the token.
            Any other exception: caught by `_run_loop` for backoff.
        """
        try:
            ws = await websockets.connect(self._url, max_size=2**20)
        except InvalidStatus as e:
            status = _extract_handshake_status(e)
            if status in (401, 403):
                raise MarketDataAuthError(f"Finnhub rejected token (HTTP {status})") from e
            raise

        async with self._ws_lock:
            self._ws = ws
            self._subscribed_on_current_ws.clear()

        try:
            # Subscribe to the active set on this fresh connection.
            for ticker in sorted(self._tickers):
                try:
                    await ws.send(json.dumps({"type": "subscribe", "symbol": ticker}))
                    self._subscribed_on_current_ws.add(ticker)
                except (ConnectionClosed, OSError):
                    raise

            # Connection is live: signal start() if it's still waiting.
            if not self._first_connect_event.is_set():
                self._first_connect_event.set()

            await self._receive_until_closed(ws)
        finally:
            async with self._ws_lock:
                self._ws = None
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass

    async def _receive_until_closed(self, ws: Any) -> None:
        try:
            async for raw in ws:
                self._handle_raw_message(raw)
        except ConnectionClosedError as e:
            # Finnhub closes with code 1008 + reason="invalid api key" for
            # bad tokens; surface that as auth.
            rcvd = getattr(e, "rcvd", None)
            code = getattr(rcvd, "code", None) if rcvd is not None else None
            reason = (getattr(rcvd, "reason", "") or "").lower() if rcvd is not None else ""
            if code in (1008, 4001) and "invalid" in reason:
                raise MarketDataAuthError(f"Finnhub closed connection: {reason}") from e
            raise
        except ConnectionClosed:
            return

    def _handle_raw_message(self, raw: Any) -> None:
        """Decode one frame from the WS and route it.

        Finnhub message shapes:
          - {"type":"trade","data":[{"p":190.5,"s":"AAPL","t":1690000000,"v":100}, ...]}
          - {"type":"ping"}
          - {"type":"error","msg":"..."}
        """
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            logger.debug("Finnhub: ignoring non-JSON frame")
            return

        msg_type = payload.get("type")
        if msg_type == "trade":
            for entry in payload.get("data") or []:
                self._handle_trade_entry(entry)
        elif msg_type == "ping":
            return
        elif msg_type == "error":
            logger.warning("Finnhub error message: %s", payload.get("msg"))
        else:
            logger.debug("Finnhub: ignoring message type %r", msg_type)

    def _handle_trade_entry(self, entry: dict[str, Any]) -> None:
        try:
            symbol = entry["s"]
            price = float(entry["p"])
            # `t` is unix milliseconds per Finnhub docs.
            timestamp = float(entry["t"]) / 1000.0
        except (KeyError, TypeError, ValueError):
            logger.debug("Finnhub: skipping malformed trade entry %r", entry)
            return
        self._cache.update(ticker=symbol, price=price, timestamp=timestamp)


def _extract_handshake_status(err: Exception) -> int | None:
    """Pull the HTTP status off a `websockets.InvalidStatus` exception.

    `InvalidStatus` exposes the status either as `status_code` directly or
    on a wrapped `response` object depending on the websockets version.
    """
    code = getattr(err, "status_code", None)
    if isinstance(code, int):
        return code
    response = getattr(err, "response", None)
    code = getattr(response, "status_code", None)
    if isinstance(code, int):
        return code
    return None
