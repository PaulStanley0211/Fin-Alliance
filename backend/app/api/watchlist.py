"""Watchlist endpoints — CRUD on the user's tracked tickers."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api import errors
from app.api.schemas import (
    WatchlistAddRequest,
    WatchlistEntry,
    WatchlistResponse,
)
from app.api.tickers import WATCHLIST_LIMIT, validate_ticker_supported
from app.db import (
    add_to_watchlist,
    list_watchlist,
    remove_from_watchlist,
)
from app.db.connection import connect
from app.market import PriceCache
from app.state import AppState, get_state

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


def _entry_for(ticker: str, cache: PriceCache | None) -> WatchlistEntry:
    if cache is None:
        return WatchlistEntry(
            ticker=ticker,
            price=None,
            previous_price=None,
            direction=None,
            timestamp=None,
        )
    update = cache.get(ticker)
    if update is None:
        return WatchlistEntry(
            ticker=ticker,
            price=None,
            previous_price=None,
            direction=None,
            timestamp=None,
        )
    return WatchlistEntry(
        ticker=ticker,
        price=update.price,
        previous_price=update.previous_price,
        direction=update.direction,
        timestamp=update.timestamp,
    )


@router.get("", response_model=WatchlistResponse)
def get_watchlist(state: AppState = Depends(get_state)) -> WatchlistResponse:
    with connect() as conn:
        tickers = list_watchlist(conn)
    return WatchlistResponse(tickers=[_entry_for(t, state.price_cache) for t in tickers])


@router.post("", response_model=WatchlistEntry)
async def post_watchlist(
    body: WatchlistAddRequest,
    state: AppState = Depends(get_state),
) -> WatchlistEntry:
    """Add a ticker. Validates support, enforces 25-cap, fires the data-source add."""
    ticker = body.ticker
    validate_ticker_supported(ticker)

    with connect() as conn:
        existing = list_watchlist(conn)
        if ticker in existing:
            return _entry_for(ticker, state.price_cache)
        if len(existing) >= WATCHLIST_LIMIT:
            raise errors.watchlist_full(WATCHLIST_LIMIT)
        add_to_watchlist(conn, ticker)

    if state.market_source is not None:
        await state.market_source.add_ticker(ticker)
    return _entry_for(ticker, state.price_cache)


@router.delete("/{ticker}", status_code=204)
async def delete_watchlist(
    ticker: str,
    state: AppState = Depends(get_state),
) -> None:
    ticker = ticker.upper().strip()
    with connect() as conn:
        remove_from_watchlist(conn, ticker)
    if state.market_source is not None:
        await state.market_source.remove_ticker(ticker)
    return None
