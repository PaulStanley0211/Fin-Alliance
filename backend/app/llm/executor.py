"""Apply LLM-emitted trade and watchlist actions.

The executor doesn't know any trade business logic; it only *invokes* the
existing trade endpoint (`post_trade`) and translates its outcomes into the
per-action result objects we return to the frontend (PLAN.md §9 wire
format).

Watchlist actions emitted by the model are short-circuited with
`watchlist_disabled` — the watchlist concept was removed in the redesign
(spec §6) and all sector tickers stream by default. The system prompt is
also updated to stop suggesting watchlist actions; this is the
belt-and-braces fallback if the model drifts.

If a handler raises `APIError`, we map its `code` to the LLM `ExecutionError`
literal. Anything else is logged and reported as `internal_error`.
"""

from __future__ import annotations

import logging

from app.api import errors as api_errors
from app.api import portfolio as portfolio_api
from app.api import schemas as api_schemas
from app.state import AppState

from .schemas import (
    ExecutedTrade,
    ExecutedWatchlistChange,
    ExecutionError,
    LLMResponse,
    TradeRequest,
    WatchlistChange,
)

logger = logging.getLogger(__name__)

# Map backend error codes -> our LLM ExecutionError literal. Codes from
# `app/api/errors.py`. Anything not in this set falls through to "internal_error".
_ERROR_CODE_MAP: dict[str, ExecutionError] = {
    "insufficient_cash": "insufficient_cash",
    "insufficient_shares": "insufficient_shares",
    "ticker_unsupported": "ticker_unsupported",
    "watchlist_full": "watchlist_full",
    "price_unavailable": "price_unavailable",
    "duplicate_request": "duplicate_request",
    "invalid_request": "invalid_request",
}


def _map_api_error(exc: api_errors.APIError) -> ExecutionError:
    return _ERROR_CODE_MAP.get(exc.code, "internal_error")


DEFAULT_EXEC_USER_ID = "default"


async def _execute_one_trade(
    trade: TradeRequest,
    state: AppState,
    *,
    user_id: str = DEFAULT_EXEC_USER_ID,
) -> ExecutedTrade:
    """Run one LLM-emitted trade through the backend's trade endpoint.

    We invoke ``portfolio_api.post_trade`` directly rather than through HTTP
    so error codes propagate as ``APIError`` exceptions. FastAPI's ``Depends``
    isn't running here, so we pass the auth_user dict (the only field
    ``post_trade`` reads is ``id``) explicitly.
    """
    body = api_schemas.TradeRequest(
        ticker=trade.ticker,
        side=trade.side,
        quantity=trade.quantity,
        request_id=None,  # LLM trades don't dedupe
    )

    try:
        result = await portfolio_api.post_trade(body, state, {"id": user_id})
    except api_errors.APIError as exc:
        return ExecutedTrade(
            ticker=trade.ticker,
            side=trade.side,
            quantity=trade.quantity,
            status="rejected",
            price=None,
            error=_map_api_error(exc),
        )
    except Exception:
        logger.exception(
            "Unexpected error executing LLM trade %s %s %s",
            trade.side,
            trade.quantity,
            trade.ticker,
        )
        return ExecutedTrade(
            ticker=trade.ticker,
            side=trade.side,
            quantity=trade.quantity,
            status="rejected",
            price=None,
            error="internal_error",
        )

    return ExecutedTrade(
        ticker=result.ticker,
        side=result.side,
        quantity=result.quantity,
        status="executed",
        price=result.price,
        error=None,
    )


def _reject_watchlist_change(change: WatchlistChange) -> ExecutedWatchlistChange:
    """Always reject — the watchlist concept was removed (spec §6)."""
    return ExecutedWatchlistChange(
        ticker=change.ticker,
        action=change.action,
        status="rejected",
        error="watchlist_disabled",
    )


async def execute_actions(
    response: LLMResponse,
    state: AppState,
    *,
    user_id: str = DEFAULT_EXEC_USER_ID,
) -> tuple[list[ExecutedTrade], list[ExecutedWatchlistChange]]:
    """Execute every action in `response`, preserving emission order.

    Trades run through the live trade endpoint scoped to ``user_id``.
    Watchlist changes are short-circuited with ``watchlist_disabled`` (spec
    §6 — watchlist removed).

    Each trade is independent — one rejection does NOT abort the others. The
    returned lists have the same length and order as ``response.trades`` and
    ``response.watchlist_changes`` respectively.
    """
    executed_trades: list[ExecutedTrade] = [
        await _execute_one_trade(trade, state, user_id=user_id)
        for trade in response.trades
    ]
    executed_watchlist: list[ExecutedWatchlistChange] = [
        _reject_watchlist_change(change) for change in response.watchlist_changes
    ]
    return executed_trades, executed_watchlist
