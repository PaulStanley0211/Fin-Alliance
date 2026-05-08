"""SSE streaming endpoint for live price updates.

Per PLAN.md §6:
- Each price-update event carries a `market_status` field (open/closed/warming).
- The server emits a `: ping\\n\\n` SSE comment every 15s so middleboxes don't
  sever idle connections during quiet periods or off-hours.
- On client connect, the cache is immediately snapshotted (warm-up) so the
  client gets last-known prices before the next tick lands. If the cache is
  empty (fresh container), nothing is emitted until the first tick.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from .cache import PriceCache
from .market_status import current_market_status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stream", tags=["streaming"])

HEARTBEAT_INTERVAL_SECONDS = 15.0
DEFAULT_TICK_INTERVAL = 0.5


def create_stream_router(price_cache: PriceCache) -> APIRouter:
    """Create the SSE streaming router with a reference to the price cache.

    This factory pattern lets us inject the PriceCache without globals.
    """

    @router.get("/prices")
    async def stream_prices(request: Request) -> StreamingResponse:
        """SSE endpoint for live price updates.

        Streams all tracked ticker prices on cache change (~500ms cadence on
        the simulator, longer on Massive). Each event payload includes a
        `market_status` field. A `: ping` heartbeat is emitted every 15s
        regardless of price activity.
        """
        return StreamingResponse(
            _generate_events(price_cache, request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering if proxied
            },
        )

    return router


def _build_payload(price_cache: PriceCache) -> str | None:
    """Serialize the cache contents as the SSE `data:` line, or None if empty."""
    prices = price_cache.get_all()
    if not prices:
        return None
    status = current_market_status()
    payload = {
        ticker: {**update.to_dict(), "market_status": status}
        for ticker, update in prices.items()
    }
    return f"data: {json.dumps(payload)}\n\n"


def _warming_payload() -> str:
    """Emitted on connect when the cache is empty so the client knows we're alive.

    Carries `market_status: "warming"` and an empty prices object — enough
    for the frontend to flip the connection-status dot off "yellow" the
    moment the connection is established.
    """
    payload = {"prices": {}, "market_status": "warming"}
    return f"data: {json.dumps(payload)}\n\n"


async def _generate_events(
    price_cache: PriceCache,
    request: Request,
    interval: float = DEFAULT_TICK_INTERVAL,
    heartbeat_interval: float = HEARTBEAT_INTERVAL_SECONDS,
) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted events: warm-up snapshot, change-driven price events,
    and 15s heartbeat comments. Stops when the client disconnects.
    """
    yield "retry: 1000\n\n"

    client_ip = request.client.host if request.client else "unknown"
    logger.info("SSE client connected: %s", client_ip)

    last_version = -1
    last_emit = time.monotonic()  # any send (price or heartbeat) refreshes this

    # Warm-up: snapshot whatever the cache holds *right now*, or signal warming.
    initial_payload = _build_payload(price_cache)
    if initial_payload is not None:
        yield initial_payload
        last_version = price_cache.version
    else:
        yield _warming_payload()
    last_emit = time.monotonic()

    try:
        while True:
            if await request.is_disconnected():
                logger.info("SSE client disconnected: %s", client_ip)
                break

            current_version = price_cache.version
            if current_version != last_version:
                last_version = current_version
                payload = _build_payload(price_cache)
                if payload is not None:
                    yield payload
                    last_emit = time.monotonic()

            # Heartbeat any time we've been silent past the threshold.
            if time.monotonic() - last_emit >= heartbeat_interval:
                yield ": ping\n\n"
                last_emit = time.monotonic()

            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        logger.info("SSE stream cancelled for: %s", client_ip)
