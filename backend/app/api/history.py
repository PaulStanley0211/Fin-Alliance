"""GET /api/history/{ticker}?range=…

Per-ticker historical close prices for the MainChart. Backed by `yfinance`
(Yahoo Finance Python wrapper) — it handles the cookie/crumb auth that the
raw chart endpoint rejects when called from a server IP without a session.

Responses are TTL-cached in memory so we don't hammer the upstream when
multiple clients (or rapid ticker switches) ask for the same series.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, Query

from app.api.errors import APIError

logger = logging.getLogger(__name__)


# Map our range tokens to yfinance (period, interval). Intraday for short
# windows, daily candles for longer ones — matches what users expect.
RANGE_TO_YF: dict[str, tuple[str, str]] = {
    "1d": ("1d", "5m"),
    "1w": ("5d", "15m"),
    "1m": ("1mo", "1d"),
    "3m": ("3mo", "1d"),
    "6m": ("6mo", "1d"),
    "1y": ("1y", "1d"),
}

CACHE_TTL_SECONDS = 300.0  # 5 minutes


_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_locks: dict[tuple[str, str], asyncio.Lock] = {}


def _lock_for(key: tuple[str, str]) -> asyncio.Lock:
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    return lock


def _yf_fetch_blocking(ticker: str, period: str, interval: str) -> list[tuple[int, float]]:
    """Synchronous yfinance call. Runs in a thread executor below.

    Returns a list of (unix_seconds, close_price) tuples. Empty list on
    upstream failure or unknown ticker.
    """
    # Import inside the function so the cost only hits the request path,
    # not module load (yfinance pulls in pandas).
    import yfinance as yf  # type: ignore[import-untyped]

    try:
        t = yf.Ticker(ticker)
        df = t.history(period=period, interval=interval, auto_adjust=False, actions=False)
    except Exception:  # noqa: BLE001 — yfinance can raise lots of things
        logger.exception("yfinance fetch failed for %s %s/%s", ticker, period, interval)
        return []

    if df is None or df.empty:
        return []

    # `df.index` is a DatetimeIndex (timezone-aware). Convert to unix seconds.
    out: list[tuple[int, float]] = []
    closes = df["Close"]
    for ts, close in closes.items():
        try:
            ts_unix = int(ts.timestamp())
            close_f = float(close)
        except (AttributeError, TypeError, ValueError):
            continue
        if close_f <= 0 or close_f != close_f:  # NaN check
            continue
        out.append((ts_unix, close_f))
    return out


async def _get_history_cached(ticker: str, range_token: str) -> list[tuple[int, float]]:
    period, interval = RANGE_TO_YF[range_token]
    key = (ticker, range_token)
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and (now - cached[0]) < CACHE_TTL_SECONDS:
        return cached[1]["points"]

    async with _lock_for(key):
        cached = _cache.get(key)
        if cached is not None and (time.monotonic() - cached[0]) < CACHE_TTL_SECONDS:
            return cached[1]["points"]
        # yfinance's history() blocks on network I/O; offload to a thread.
        points = await asyncio.to_thread(_yf_fetch_blocking, ticker, period, interval)
        _cache[key] = (time.monotonic(), {"points": points})
        return points


router = APIRouter()


@router.get("/api/history/{ticker}")
async def get_history(
    ticker: str,
    range: str = Query("1d", description="One of 1d, 1w, 1m, 3m, 6m, 1y"),
) -> dict[str, Any]:
    """Return historical close prices for `ticker` over the requested range.

    Response shape:
        {
            "ticker": "AAPL",
            "range": "1d",
            "points": [[<unix_seconds>, <close_price>], ...]
        }
    """
    ticker = ticker.upper().strip()
    if not ticker or not ticker.isalpha():
        raise APIError(400, "invalid_ticker", "ticker must be alphabetic")
    range_token = range.lower()
    if range_token not in RANGE_TO_YF:
        raise APIError(
            400,
            "invalid_range",
            f"range must be one of {sorted(RANGE_TO_YF.keys())}",
        )

    points = await _get_history_cached(ticker, range_token)
    if not points:
        raise APIError(
            502,
            "history_unavailable",
            f"no chart data available for {ticker} ({range_token})",
        )
    return {"ticker": ticker, "range": range_token, "points": points}
