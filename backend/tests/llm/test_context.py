"""Tests for the portfolio-context builder used by the chat prompt."""

from __future__ import annotations

import pytest

from app.llm.context import build_portfolio_context
from app.state import get_state


@pytest.fixture
def state(client):  # noqa: ARG001 — bring up the lifespan + DB seed
    return get_state()


def test_initial_context_matches_seed(state) -> None:
    ctx = build_portfolio_context(state.price_cache)
    assert ctx.cash_balance == 10000.0
    assert ctx.total_value == 10000.0
    assert ctx.positions == []
    # Spec §6 — watchlist removed; context no longer renders a watchlist.
    assert ctx.watchlist == []


def test_context_picks_up_streamed_prices_for_positions(
    state, client, seed_price, authed_user_id
) -> None:  # noqa: ARG001
    """Streamed prices flow through positions (the watchlist field is gone)."""
    seed_price("AAPL", 100.0)
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 1, "side": "buy"},
    )
    assert resp.status_code == 200, resp.text
    seed_price("AAPL", 250.0)

    ctx = build_portfolio_context(state.price_cache, user_id=authed_user_id)
    aapl = next(p for p in ctx.positions if p.ticker == "AAPL")
    assert aapl.current_price == 250.0


def test_context_after_buy_reflects_position(client, seed_price, authed_user_id) -> None:
    seed_price("AAPL", 100.0)
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 5, "side": "buy"},
    )
    assert resp.status_code == 200, resp.text

    ctx = build_portfolio_context(get_state().price_cache, user_id=authed_user_id)
    assert ctx.cash_balance == 9500.0
    assert len(ctx.positions) == 1
    aapl = ctx.positions[0]
    assert aapl.ticker == "AAPL"
    assert aapl.quantity == 5
    assert aapl.avg_cost == 100.0
    assert aapl.current_price == 100.0
    assert aapl.unrealized_pnl == 0.0
    assert aapl.unrealized_pnl_percent == 0.0
    # Total = 9500 cash + 500 market value
    assert ctx.total_value == 10000.0


def test_context_uses_avg_cost_when_price_missing(client, authed_user_id) -> None:
    # Buy a position, then drop the cached price — simulate a fresh cache
    # where the ticker hasn't ticked since restart. Context should fall
    # back to avg_cost so the position still renders.
    from app.market import PriceCache

    cache = get_state().price_cache
    assert isinstance(cache, PriceCache)
    cache.update(ticker="AAPL", price=80.0)

    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 1, "side": "buy"},
    )
    assert resp.status_code == 200, resp.text

    cache.remove("AAPL")

    ctx = build_portfolio_context(cache, user_id=authed_user_id)
    aapl = next(p for p in ctx.positions if p.ticker == "AAPL")
    # Falls back to avg_cost (= 80), so unrealized P&L is 0.
    assert aapl.current_price == 80.0
    assert aapl.unrealized_pnl == 0.0


def test_context_unrealized_pnl_calculation(client, seed_price, authed_user_id) -> None:
    seed_price("AAPL", 100.0)
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 10, "side": "buy"})
    # Price moves up
    seed_price("AAPL", 120.0)

    ctx = build_portfolio_context(get_state().price_cache, user_id=authed_user_id)
    aapl = ctx.positions[0]
    assert aapl.avg_cost == 100.0
    assert aapl.current_price == 120.0
    assert aapl.unrealized_pnl == pytest.approx(200.0)  # 20 × 10
    assert aapl.unrealized_pnl_percent == pytest.approx(20.0)


def test_context_with_no_cache(state) -> None:  # noqa: ARG001
    """If price_cache is None, totals fall back to cash only."""
    ctx = build_portfolio_context(None)
    assert ctx.cash_balance == 10000.0
    assert ctx.total_value == 10000.0
    assert ctx.positions == []
    assert ctx.watchlist == []
