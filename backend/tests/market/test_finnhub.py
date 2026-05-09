"""Tests for FinnhubDataSource.

The Finnhub client opens a single WebSocket per process. We replace the
real `websockets.connect` with a fake that captures sent frames and lets
the test push messages back through the receive iterator.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any
from unittest.mock import patch

import pytest

from app.market import finnhub_client as finnhub_module
from app.market.cache import PriceCache
from app.market.finnhub_client import FinnhubDataSource
from app.market.interface import MarketDataAuthError


class FakeWebSocket:
    """In-memory stand-in for `websockets.WebSocketClientProtocol`.

    Tests push messages onto `_inbox` to simulate the server. The async
    iterator (`async for msg in ws`) yields them in order, then awaits
    indefinitely until closed.
    """

    def __init__(self) -> None:
        self.sent: list[str] = []
        self._inbox: asyncio.Queue[str | object] = asyncio.Queue()
        self._sentinel = object()  # close marker
        self.closed = False
        self._close_exc: BaseException | None = None

    async def send(self, message: str) -> None:
        if self.closed:
            from websockets.exceptions import ConnectionClosed

            raise ConnectionClosed(rcvd=None, sent=None)
        self.sent.append(message)

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            await self._inbox.put(self._sentinel)

    def push(self, payload: dict[str, Any] | str) -> None:
        msg = payload if isinstance(payload, str) else json.dumps(payload)
        self._inbox.put_nowait(msg)

    def push_close(self, exc: BaseException | None = None) -> None:
        self._close_exc = exc
        self._inbox.put_nowait(self._sentinel)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._inbox.get()
        if item is self._sentinel:
            self.closed = True
            if self._close_exc is not None:
                raise self._close_exc
            raise StopAsyncIteration
        return item  # type: ignore[return-value]


@contextlib.asynccontextmanager
async def _running_source(
    cache: PriceCache,
    tickers: list[str],
    fake_ws: FakeWebSocket,
):
    """Start a FinnhubDataSource against a single FakeWebSocket and clean up.

    Each call to `websockets.connect` returns the *same* fake. After the
    test body the source is stopped which closes the fake and cancels the
    background loop.
    """

    async def _connect(*_args, **_kwargs):
        return fake_ws

    source = FinnhubDataSource(api_key="test-key", price_cache=cache)
    with patch.object(finnhub_module.websockets, "connect", _connect):
        await source.start(tickers)
        try:
            yield source
        finally:
            await source.stop()


# ----------------------------------------------------------------------
# Subscribe / lifecycle
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_subscribes_to_each_ticker():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL", "MSFT"], fake):
        # Allow the loop to issue subscribes.
        for _ in range(20):
            if len(fake.sent) >= 2:
                break
            await asyncio.sleep(0.01)
        sent = [json.loads(s) for s in fake.sent]
        symbols = sorted(s["symbol"] for s in sent)
        assert symbols == ["AAPL", "MSFT"]
        assert all(s["type"] == "subscribe" for s in sent)


@pytest.mark.asyncio
async def test_start_normalizes_tickers_to_upper():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["aapl", " msft "], fake):
        for _ in range(20):
            if len(fake.sent) >= 2:
                break
            await asyncio.sleep(0.01)
        symbols = sorted(json.loads(s)["symbol"] for s in fake.sent)
        assert symbols == ["AAPL", "MSFT"]


@pytest.mark.asyncio
async def test_get_tickers_returns_active_set():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL", "MSFT"], fake) as source:
        assert source.get_tickers() == ["AAPL", "MSFT"]


# ----------------------------------------------------------------------
# Trade messages → cache
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trade_message_updates_cache():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL"], fake):
        # Wait for the receive loop to be live (one subscribe sent).
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)

        fake.push({
            "type": "trade",
            "data": [
                {"s": "AAPL", "p": 230.55, "t": 1707580800000, "v": 100},
            ],
        })

        for _ in range(50):
            if cache.get_price("AAPL") is not None:
                break
            await asyncio.sleep(0.01)

        update = cache.get("AAPL")
        assert update is not None
        assert update.price == 230.55
        # Timestamps come in milliseconds; the client converts to seconds.
        assert update.timestamp == 1707580800.0


@pytest.mark.asyncio
async def test_trade_message_with_multiple_entries():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL", "MSFT"], fake):
        for _ in range(20):
            if len(fake.sent) >= 2:
                break
            await asyncio.sleep(0.01)

        fake.push({
            "type": "trade",
            "data": [
                {"s": "AAPL", "p": 231.00, "t": 1707580800000, "v": 100},
                {"s": "MSFT", "p": 416.10, "t": 1707580800001, "v": 50},
            ],
        })

        for _ in range(50):
            if cache.get_price("AAPL") and cache.get_price("MSFT"):
                break
            await asyncio.sleep(0.01)

        assert cache.get_price("AAPL") == 231.00
        assert cache.get_price("MSFT") == 416.10


@pytest.mark.asyncio
async def test_malformed_trade_entry_is_skipped():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL"], fake):
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)

        fake.push({
            "type": "trade",
            "data": [
                {"s": "AAPL"},  # missing price + timestamp
                {"s": "AAPL", "p": 232.00, "t": 1707580800000, "v": 100},
            ],
        })

        for _ in range(50):
            if cache.get_price("AAPL") is not None:
                break
            await asyncio.sleep(0.01)

        assert cache.get_price("AAPL") == 232.00


@pytest.mark.asyncio
async def test_ping_message_is_ignored():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL"], fake):
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)

        fake.push({"type": "ping"})
        await asyncio.sleep(0.05)
        assert cache.get_price("AAPL") is None


@pytest.mark.asyncio
async def test_non_json_frame_is_ignored():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL"], fake):
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)

        fake.push("not json at all")
        await asyncio.sleep(0.05)  # Should not crash the loop


# ----------------------------------------------------------------------
# add_ticker / remove_ticker
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_ticker_sends_subscribe_frame():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL"], fake) as source:
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)
        baseline = list(fake.sent)

        await source.add_ticker("MSFT")

        new_frames = [json.loads(f) for f in fake.sent[len(baseline):]]
        assert any(f["type"] == "subscribe" and f["symbol"] == "MSFT" for f in new_frames)
        assert "MSFT" in source.get_tickers()


@pytest.mark.asyncio
async def test_add_ticker_dedupes():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL"], fake) as source:
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)
        before = len(fake.sent)

        await source.add_ticker("AAPL")  # already there
        assert len(fake.sent) == before


@pytest.mark.asyncio
async def test_remove_ticker_sends_unsubscribe_and_purges_cache():
    cache = PriceCache()
    fake = FakeWebSocket()
    async with _running_source(cache, ["AAPL"], fake) as source:
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)

        cache.update("AAPL", 230.0)
        baseline = list(fake.sent)

        await source.remove_ticker("AAPL")

        new_frames = [json.loads(f) for f in fake.sent[len(baseline):]]
        assert any(f["type"] == "unsubscribe" and f["symbol"] == "AAPL" for f in new_frames)
        assert "AAPL" not in source.get_tickers()
        assert cache.get("AAPL") is None


# ----------------------------------------------------------------------
# Stop / cleanup
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_is_idempotent():
    cache = PriceCache()
    source = FinnhubDataSource(api_key="key", price_cache=cache)
    await source.stop()
    await source.stop()  # No-op


@pytest.mark.asyncio
async def test_stop_cancels_running_task():
    cache = PriceCache()
    fake = FakeWebSocket()
    source = FinnhubDataSource(api_key="key", price_cache=cache)

    async def _connect(*_a, **_k):
        return fake

    with patch.object(finnhub_module.websockets, "connect", _connect):
        await source.start(["AAPL"])
        assert source._task is not None
        await source.stop()
        assert source._task is None


# ----------------------------------------------------------------------
# Auth failures
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_error_via_handshake_status():
    """A 401 during the handshake is surfaced as MarketDataAuthError."""
    from websockets.exceptions import InvalidStatus

    class _FakeResponse:
        status_code = 401

    cache = PriceCache()
    source = FinnhubDataSource(api_key="bad-key", price_cache=cache)

    async def _connect(*_a, **_k):
        raise InvalidStatus(_FakeResponse())  # type: ignore[arg-type]

    with patch.object(finnhub_module.websockets, "connect", _connect):
        with pytest.raises(MarketDataAuthError):
            await source.start(["AAPL"])


@pytest.mark.asyncio
async def test_auth_error_via_close_frame_terminates_loop():
    """A 1008 close with 'invalid' reason terminates the recv loop without retrying.

    The close arrives *after* start() has already returned (the first
    handshake succeeded), so the test verifies that the background loop
    detects the auth-flavored close, classifies it as MarketDataAuthError,
    and exits without scheduling further reconnect attempts.
    """
    from websockets.exceptions import ConnectionClosedError
    from websockets.frames import Close

    cache = PriceCache()
    fake = FakeWebSocket()
    source = FinnhubDataSource(api_key="bad-key", price_cache=cache)

    async def _connect(*_a, **_k):
        return fake

    exc = ConnectionClosedError(Close(code=1008, reason="invalid api key"), None)

    with patch.object(finnhub_module.websockets, "connect", _connect):
        await source.start(["AAPL"])

        # Wait for the recv loop to be actively iterating, then push the close.
        for _ in range(20):
            if fake.sent:
                break
            await asyncio.sleep(0.01)
        fake.push_close(exc)

        # The loop should exit on its own (no infinite reconnect).
        for _ in range(50):
            if source._task is None or source._task.done():
                break
            await asyncio.sleep(0.02)
        assert source._task is not None
        assert source._task.done()
        # And bringing this to user-visible state — stop() is a no-op clean-up.
        await source.stop()


# ----------------------------------------------------------------------
# Reconnect on disconnect
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconnect_after_disconnect_resubscribes():
    """After a non-auth disconnect, the loop reconnects and resubscribes."""
    from websockets.exceptions import ConnectionClosed

    cache = PriceCache()
    fakes: list[FakeWebSocket] = [FakeWebSocket(), FakeWebSocket()]
    call_count = {"n": 0}

    async def _connect(*_a, **_k):
        ws = fakes[min(call_count["n"], len(fakes) - 1)]
        call_count["n"] += 1
        return ws

    source = FinnhubDataSource(api_key="key", price_cache=cache)
    # Shorten the initial backoff so the test runs quickly.
    with (
        patch.object(finnhub_module, "INITIAL_BACKOFF_SECONDS", 0.05),
        patch.object(finnhub_module, "MAX_BACKOFF_SECONDS", 0.1),
        patch.object(finnhub_module.websockets, "connect", _connect),
    ):
        await source.start(["AAPL"])
        try:
            for _ in range(20):
                if fakes[0].sent:
                    break
                await asyncio.sleep(0.01)
            assert fakes[0].sent  # First WS got the subscribe.

            # Simulate the connection dropping with a non-auth close.
            fakes[0].push_close(ConnectionClosed(None, None))

            # The loop should reconnect onto fakes[1] and re-subscribe.
            for _ in range(60):
                if fakes[1].sent:
                    break
                await asyncio.sleep(0.05)

            symbols = [json.loads(s)["symbol"] for s in fakes[1].sent]
            assert "AAPL" in symbols
        finally:
            await source.stop()
