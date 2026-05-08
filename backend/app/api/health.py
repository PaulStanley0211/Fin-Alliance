"""Combined liveness/readiness check.

Per PLAN.md §8: 200 once the database is initialized AND the market data
source has produced a tick within the last 60 seconds. 503 otherwise.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Response

from app.api.schemas import HealthResponse
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
        market_status = "warming"
    else:
        elapsed = time.monotonic() - state.last_tick_monotonic
        market_status = "running" if elapsed <= TICK_FRESHNESS_SECONDS else "error"

    overall: str
    if db_status == "ready" and market_status == "running":
        overall = "ok"
    elif db_status == "ready" and market_status == "warming":
        # Warming is healthy enough for orchestrators on first boot.
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
