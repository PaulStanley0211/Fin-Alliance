"""Build a `PortfolioContext` snapshot from live application state.

Used by `POST /api/chat` to ground the system prompt with the user's current
cash, positions (with live prices and unrealized P&L), and watchlist (with
latest streamed prices). Pulls from the same DB rows + price cache the REST
endpoints expose so the LLM sees exactly what the UI sees.
"""

from __future__ import annotations

from app.db import get_user, list_positions, list_watchlist
from app.db.connection import connect
from app.market import PriceCache

from .schemas import PortfolioContext, PortfolioPosition, WatchlistEntry


def build_portfolio_context(price_cache: PriceCache | None) -> PortfolioContext:
    """Snapshot the user's portfolio state for the LLM system prompt.

    Cash + positions + realized total are read from the DB. Live prices come
    from the price cache (None if a ticker hasn't streamed yet). Total value
    is `cash + Σ(quantity × current_price)` using the avg cost as a fallback
    when a position has no streamed price yet, matching the portfolio
    endpoint's behavior.
    """
    with connect() as conn:
        user = get_user(conn)
        cash = float(user["cash_balance"]) if user else 0.0
        position_rows = list_positions(conn)
        watchlist_tickers = list_watchlist(conn)

    positions: list[PortfolioPosition] = []
    market_total = 0.0
    for row in position_rows:
        ticker = row["ticker"]
        qty = float(row["quantity"])
        avg = float(row["avg_cost"])
        cur = price_cache.get_price(ticker) if price_cache is not None else None
        price = cur if cur is not None else avg
        unrealized = (price - avg) * qty
        pct = ((price - avg) / avg * 100.0) if avg else 0.0
        positions.append(
            PortfolioPosition(
                ticker=ticker,
                quantity=qty,
                avg_cost=avg,
                current_price=price,
                unrealized_pnl=unrealized,
                unrealized_pnl_percent=pct,
            )
        )
        market_total += qty * price

    watchlist: list[WatchlistEntry] = []
    for ticker in watchlist_tickers:
        cur = price_cache.get_price(ticker) if price_cache is not None else None
        watchlist.append(WatchlistEntry(ticker=ticker, current_price=cur))

    return PortfolioContext(
        cash_balance=cash,
        positions=positions,
        watchlist=watchlist,
        total_value=cash + market_total,
    )
