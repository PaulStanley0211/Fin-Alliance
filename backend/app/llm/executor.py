"""Apply LLM-emitted trade and watchlist actions.

The executor doesn't know any trade or watchlist business logic; it only
*invokes* the existing Backend Engineer endpoints (`post_trade`,
`post_watchlist`, `delete_watchlist`) and translates their outcomes into the
per-action result objects we return to the frontend (PLAN.md §9 wire format).

Why call the route handlers directly instead of an HTTP round-trip?

- They're plain async functions taking a `body` and a `state` dependency.
  No HTTP serialization needed.
- They already implement ticker validation, watchlist-cap enforcement,
  trade math, idempotency, and snapshot writes — duplicating any of that
  here would diverge from the manual-trade path.
- LLM-initiated trades skip `request_id` per PLAN.md §8, which is the
  default for our schema's `TradeRequest`.

If a handler raises `APIError`, we map its `code` to the LLM `ExecutionError`
literal. Anything else is logged and reported as `internal_error`.
"""

from __future__ import annotations

import logging

from app.api import errors as api_errors
from app.api import portfolio as portfolio_api
from app.api import schemas as api_schemas
from app.api import watchlist as watchlist_api
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


async def _execute_one_trade(trade: TradeRequest, state: AppState) -> ExecutedTrade:
    """Run one LLM-emitted trade through the backend's trade endpoint."""
    body = api_schemas.TradeRequest(
        ticker=trade.ticker,
        side=trade.side,
        quantity=trade.quantity,
        request_id=None,  # LLM trades don't dedupe
    )

    try:
        result = await portfolio_api.post_trade(body, state)
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


async def _execute_one_watchlist_change(
    change: WatchlistChange, state: AppState
) -> ExecutedWatchlistChange:
    """Run one LLM-emitted add/remove through the backend's watchlist endpoints."""
    try:
        if change.action == "add":
            body = api_schemas.WatchlistAddRequest(ticker=change.ticker)
            await watchlist_api.post_watchlist(body, state)
        else:  # "remove"
            await watchlist_api.delete_watchlist(change.ticker, state)
    except api_errors.APIError as exc:
        return ExecutedWatchlistChange(
            ticker=change.ticker,
            action=change.action,
            status="rejected",
            error=_map_api_error(exc),
        )
    except Exception:
        logger.exception(
            "Unexpected error on LLM watchlist %s %s", change.action, change.ticker
        )
        return ExecutedWatchlistChange(
            ticker=change.ticker,
            action=change.action,
            status="rejected",
            error="internal_error",
        )

    return ExecutedWatchlistChange(
        ticker=change.ticker,
        action=change.action,
        status="executed",
        error=None,
    )


async def execute_actions(
    response: LLMResponse,
    state: AppState,
) -> tuple[list[ExecutedTrade], list[ExecutedWatchlistChange]]:
    """Execute every action in `response`, preserving emission order.

    Trades run before watchlist changes (matches PLAN.md §9 schema order; the
    trade endpoint already auto-adds tickers, so a "buy AAPL" + "watch AAPL"
    pair is naturally idempotent on the watchlist side).

    Each action is independent — one rejection does NOT abort the others. The
    returned lists have the same length and order as `response.trades` and
    `response.watchlist_changes` respectively.
    """
    executed_trades: list[ExecutedTrade] = [
        await _execute_one_trade(trade, state) for trade in response.trades
    ]
    executed_watchlist: list[ExecutedWatchlistChange] = [
        await _execute_one_watchlist_change(change, state)
        for change in response.watchlist_changes
    ]
    return executed_trades, executed_watchlist
