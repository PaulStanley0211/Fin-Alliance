"""FastAPI application entry point.

Wires the lifespan (DB init → market data source → snapshot writer → SSE
router → static files), registers all REST routers, and exposes a single
`app` object for `uvicorn app.main:app`.

Design notes:
- The `PriceCache` is constructed eagerly at import time so the SSE router
  (which the market module builds via a factory taking the cache) can be
  mounted before `lifespan` runs. The market data source then writes into
  this same cache during startup.
- `/api/*` routers are mounted before the static-files mount at "/", so an
  API path always wins over a same-named file in the SPA bundle.
- The static directory is `/app/static/` inside the container (Dockerfile
  copies `frontend/out/` there). For local dev without a built frontend the
  mount is skipped silently.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db import (
    SnapshotWriter,
    init_db,
    list_watchlist,
)
from app.db.connection import connect
from app.market import (
    PriceCache,
    create_market_data_source,
    create_stream_router,
)
from app.state import AppState, get_state

logger = logging.getLogger(__name__)

DEFAULT_TICKERS = [
    "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA",
    "NVDA", "META", "JPM", "V", "NFLX",
]
STATIC_DIR = Path(os.environ.get("FINALLY_STATIC_DIR", "/app/static"))
TICK_WATCHER_INTERVAL = 0.5


async def _tick_watcher(state: AppState) -> None:
    """Track the cache version so /api/health can compute "tick within 60s".

    The market source already increments the cache version on every price
    update; we just snapshot the resulting `monotonic()` so health checks
    don't have to scan the cache.
    """
    import time

    while True:
        try:
            cache = state.price_cache
            if cache is not None:
                v = cache.version
                if v != state.last_cache_version:
                    state.last_cache_version = v
                    state.last_tick_monotonic = time.monotonic()
        except Exception:  # noqa: BLE001 — must not die
            logger.exception("tick watcher iteration failed")
        await asyncio.sleep(TICK_WATCHER_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown.

    Ordered per PLAN.md §7: DB init runs to completion before any background
    task touches the DB, and market data starts before the snapshot writer
    so the first snapshot can use real prices.
    """
    state = get_state()

    # 1. DB schema + seed (idempotent). Synchronous; runs in the event loop.
    init_db()
    state.db_ready = True
    logger.info("Database initialized")

    # 2. Start the market data source against the pre-built cache.
    # Tickers = persisted watchlist (init_db has already inserted defaults).
    with connect() as conn:
        persisted = list_watchlist(conn)
    tickers = persisted if persisted else list(DEFAULT_TICKERS)
    cache = state.price_cache
    assert cache is not None  # constructed at import time
    source = create_market_data_source(cache)
    await source.start(tickers)
    state.market_source = source
    logger.info("Market data source started with %d tickers", len(tickers))

    # 3. Snapshot writer (background). Records portfolio_snapshots every 30s.
    writer = SnapshotWriter(cache)
    await writer.start()
    state.snapshot_writer = writer

    # 4. Tick watcher.
    tick_task = asyncio.create_task(_tick_watcher(state), name="tick-watcher")
    state.background_tasks.append(tick_task)

    try:
        yield
    finally:
        # Reverse-order shutdown.
        for task in state.background_tasks:
            task.cancel()
        for task in state.background_tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:  # noqa: BLE001
                logger.exception("Background task raised on shutdown")
        state.background_tasks.clear()

        if state.snapshot_writer is not None:
            await state.snapshot_writer.stop()
            state.snapshot_writer = None

        if state.market_source is not None:
            await state.market_source.stop()
            state.market_source = None

        state.db_ready = False
        logger.info("Lifespan shutdown complete")


def create_app() -> FastAPI:
    """Build the FastAPI app. Exposed as a factory so tests can swap pieces."""
    from app.api.errors import register_exception_handlers

    app = FastAPI(
        title="FinAlly",
        description="AI Trading Workstation",
        version="0.1.0",
        lifespan=lifespan,
    )
    register_exception_handlers(app)

    # Build the shared PriceCache up-front so the SSE router (factory takes
    # the cache) can be mounted right now. The lifespan starts the data
    # source against this same cache.
    state = get_state()
    if state.price_cache is None:
        state.price_cache = PriceCache()

    app.include_router(create_stream_router(state.price_cache))

    # REST routers — registered after the SSE router so they're mounted
    # before the static-files catch-all. Each module's import is guarded
    # so the app still boots when a downstream engineer hasn't shipped yet.
    _mount_rest_routers(app)

    # Static frontend. Last so it's the catch-all for unmatched paths.
    if STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
        logger.info("Mounted static files from %s", STATIC_DIR)
    else:
        logger.info("Static dir %s not found — skipping SPA mount", STATIC_DIR)

    return app


def _mount_rest_routers(app: FastAPI) -> None:
    """Include the per-resource API routers, tolerating absent modules.

    During the build the LLM engineer's chat router and the rest of the
    backend's REST routers may not exist yet. We import lazily and skip
    anything that isn't on disk.
    """
    for module_name, attr in (
        ("app.api.health", "router"),
        ("app.api.portfolio", "router"),
        ("app.api.watchlist", "router"),
        ("app.llm.chat", "router"),
    ):
        try:
            module = __import__(module_name, fromlist=[attr])
        except ModuleNotFoundError:
            logger.debug("Router module %s not available; skipping", module_name)
            continue
        router = getattr(module, attr, None)
        if router is None:
            logger.debug("Router %s.%s missing; skipping", module_name, attr)
            continue
        app.include_router(router)
        logger.info("Mounted router: %s", module_name)


app = create_app()


__all__ = ["app", "create_app", "lifespan"]
