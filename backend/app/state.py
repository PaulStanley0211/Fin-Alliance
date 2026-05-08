"""Process-wide application state.

The FastAPI lifespan owns these singletons. Route handlers reach them via the
`get_state()` dependency rather than touching globals directly, which keeps
tests easy (they swap in a fresh `AppState` per `TestClient`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.db import SnapshotWriter
    from app.market import MarketDataSource, PriceCache


@dataclass
class AppState:
    """Singletons shared across requests.

    `db_ready` flips True after `init_db()` succeeds. `last_tick_monotonic` is
    a `time.monotonic()` value updated whenever the price cache version changes;
    `/api/health` uses it for the 60s liveness window.
    """

    price_cache: PriceCache | None = None
    market_source: MarketDataSource | None = None
    snapshot_writer: SnapshotWriter | None = None
    db_ready: bool = False
    last_cache_version: int = -1
    last_tick_monotonic: float = 0.0
    background_tasks: list = field(default_factory=list)


_state = AppState()


def get_state() -> AppState:
    """Return the process-wide AppState. Used as a FastAPI dependency."""
    return _state


def reset_state_for_tests() -> None:
    """Reset the singleton — only meant for tests that build a fresh app."""
    global _state
    _state = AppState()
