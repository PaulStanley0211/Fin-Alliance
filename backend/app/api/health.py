"""Combined liveness/readiness check.

PLAN.md §8 + 2026-05-09 redesign §5: returns 200 once the database is
initialized AND either:

- a market-data tick has landed within the last 60 seconds (market_data="running"), or
- the underlying real-data source reports the market is currently *closed*
  (market_data="closed"). A stale cache during weekends / overnight is
  expected, not a fault.

Returns 503 only when DB init failed, the source died, or the source is
running with the market open but no tick in 60s.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Response

from app.api.schemas import HealthResponse
from app.market.market_status import current_market_status
from app.state import AppState, get_state

router = APIRouter(tags=["system"])

TICK_FRESHNESS_SECONDS = 60.0


@router.get("/api/health", response_model=HealthResponse)
def get_health(
    response: Response,
    state: AppState = Depends(get_state),
) -> HealthResponse:
    db_status: str = "ready" if state.db_ready else "error"

    market_status: str
    if state.market_source is None or state.price_cache is None:
        market_status = "warming"
    elif state.last_tick_monotonic == 0.0:
        # No tick yet. If the market is closed (off-hours), that's fine —
        # we may simply have come up after the close. Otherwise we're warming.
        market_status = "closed" if current_market_status() == "closed" else "warming"
    else:
        elapsed = time.monotonic() - state.last_tick_monotonic
        if elapsed <= TICK_FRESHNESS_SECONDS:
            market_status = "running"
        elif current_market_status() == "closed":
            market_status = "closed"
        else:
            market_status = "error"

    overall: str
    if db_status == "ready" and market_status in ("running", "warming", "closed"):
        overall = "ok"
    else:
        overall = "error"

    if overall == "error":
        response.status_code = 503

    return HealthResponse(
        status=overall,  # type: ignore[arg-type]
        db=db_status,  # type: ignore[arg-type]
        market_data=market_status,  # type: ignore[arg-type]
    )
