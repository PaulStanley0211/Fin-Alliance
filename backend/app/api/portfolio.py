"""Portfolio endpoints: view positions, execute trades, fetch P&L history."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.api import errors
from app.api.schemas import (
    HistoryResponse,
    HistorySnapshot,
    PortfolioResponse,
    Position,
    TradeRequest,
    TradeResponse,
)
from app.api.tickers import validate_ticker_supported
from app.db import (
    InsufficientSharesError,
    apply_buy,
    apply_sell,
    get_position,
    get_user,
    list_positions,
    list_snapshots,
    record_trade,
    update_cash_balance,
    write_snapshot_now,
)
from app.db.connection import connect
from app.db.repositories import find_trade_by_request_id, realized_pnl
from app.state import AppState, get_state

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _position_view(row: dict, current_price: float | None) -> Position:
    qty = row["quantity"]
    avg = row["avg_cost"]
    price = current_price if current_price is not None else avg
    market_value = qty * price
    unrealized = (price - avg) * qty
    pct = ((price - avg) / avg * 100.0) if avg else 0.0
    return Position(
        ticker=row["ticker"],
        quantity=qty,
        avg_cost=avg,
        current_price=current_price,
        market_value=market_value,
        unrealized_pnl=unrealized,
        unrealized_pnl_percent=pct,
    )


@router.get("", response_model=PortfolioResponse)
def get_portfolio(state: AppState = Depends(get_state)) -> PortfolioResponse:
    cache = state.price_cache
    with connect() as conn:
        user = get_user(conn)
        cash = float(user["cash_balance"]) if user else 0.0
        position_rows = list_positions(conn)
        realized = realized_pnl(conn)

    positions: list[Position] = []
    market_total = 0.0
    for row in position_rows:
        cur = cache.get_price(row["ticker"]) if cache is not None else None
        view = _position_view(row, cur)
        positions.append(view)
        market_total += view.market_value

    return PortfolioResponse(
        cash_balance=cash,
        positions=positions,
        total_value=cash + market_total,
        realized_pnl=realized,
    )


@router.get("/history", response_model=HistoryResponse)
def get_history(
    range: Literal["1h", "1d", "1w", "1m", "all"] = Query(default="1d"),
) -> HistoryResponse:
    with connect() as conn:
        rows = list_snapshots(conn, range_=range)
    return HistoryResponse(
        range=range,
        snapshots=[
            HistorySnapshot(total_value=r["total_value"], recorded_at=r["recorded_at"])
            for r in rows
        ],
    )


def _trade_response_from_row(
    row: dict,
    cash_balance: float,
    position_quantity: float,
) -> TradeResponse:
    return TradeResponse(
        id=row["id"],
        ticker=row["ticker"],
        side=row["side"],
        quantity=row["quantity"],
        price=row["price"],
        cost_basis=row["cost_basis"],
        executed_at=row["executed_at"],
        cash_balance=cash_balance,
        position_quantity=position_quantity,
    )


@router.post("/trade", response_model=TradeResponse)
async def post_trade(
    body: TradeRequest,
    state: AppState = Depends(get_state),
) -> TradeResponse:
    """Execute a market order at the current cached price.

    Order of operations:
      1. Idempotency check on (user_id, request_id), if provided.
      2. Validate ticker against the data-source policy.
      3. Resolve current price from the cache; subscribe via the data
         source if the ticker isn't already streaming (defensive — with
         all 60 sector tickers pre-subscribed this is rarely hit).
      4. Apply buy/sell to positions, capture cost_basis.
      5. Update cash balance.
      6. Record the trade row (with cost_basis and request_id).
      7. Write a portfolio snapshot.
    """
    cache = state.price_cache
    source = state.market_source

    # 1. Idempotency
    if body.request_id is not None:
        with connect() as conn:
            existing = find_trade_by_request_id(conn, body.request_id)
        if existing is not None:
            return _replay_trade(existing)

    # 2. Ticker validation (per current data-source policy)
    validate_ticker_supported(body.ticker)

    # 3. Current price
    if cache is None:
        raise errors.price_unavailable()
    price = cache.get_price(body.ticker)
    if price is None:
        # Subscribe so the next poll/sim tick lands a price, then bail with
        # a recoverable error — the caller can retry shortly.
        if source is not None:
            await source.add_ticker(body.ticker)
            price = cache.get_price(body.ticker)
        if price is None:
            raise errors.price_unavailable(
                f"No price yet for {body.ticker}. Try again in a moment."
            )

    # 4–6. Execute trade (single connection for atomicity-ish)
    with connect() as conn:
        user = get_user(conn)
        if user is None:
            raise errors.invalid_request("User profile missing.")
        cash = float(user["cash_balance"])
        cost = body.quantity * price

        if body.side == "buy":
            if cash < cost:
                raise errors.insufficient_cash(
                    f"Need ${cost:,.2f}, have ${cash:,.2f}."
                )
            applied = apply_buy(conn, body.ticker, body.quantity, price)
            new_cash = cash - cost
        else:
            try:
                applied = apply_sell(conn, body.ticker, body.quantity, price)
            except InsufficientSharesError as e:
                raise errors.insufficient_shares(str(e)) from e
            new_cash = cash + cost

        update_cash_balance(conn, new_cash)
        trade_row = record_trade(
            conn,
            ticker=body.ticker,
            side=body.side,
            quantity=body.quantity,
            price=price,
            cost_basis=applied.cost_basis,
            request_id=body.request_id,
        )

    # 7. Snapshot for the P&L chart.
    if cache is not None:
        try:
            write_snapshot_now(cache)
        except Exception:  # noqa: BLE001 — snapshot failure must not break trade
            import logging
            logging.getLogger(__name__).exception("snapshot after trade failed")

    return _trade_response_from_row(
        trade_row,
        cash_balance=new_cash,
        position_quantity=applied.new_quantity,
    )


def _replay_trade(row: dict) -> TradeResponse:
    """Reconstruct a TradeResponse for an idempotent dedupe hit.

    We re-read the *current* user cash and current position quantity to
    keep the response accurate even though the trade itself is the original.
    """
    with connect() as conn:
        user = get_user(conn)
        cash = float(user["cash_balance"]) if user else 0.0
        pos = get_position(conn, row["ticker"])
    qty = pos["quantity"] if pos is not None else 0.0
    return _trade_response_from_row(row, cash_balance=cash, position_quantity=qty)
