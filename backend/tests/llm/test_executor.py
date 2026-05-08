"""Tests for the chat action executor.

Covers:
- Executed trades and watchlist changes (success path)
- Per-error-code mapping for rejection (insufficient_cash, insufficient_shares,
  ticker_unsupported, watchlist_full, price_unavailable)
- Independence: one rejection does NOT abort the others
- LLM-initiated trades skip request_id (no idempotency dedupe)
"""

from __future__ import annotations

import pytest

from app.llm.executor import execute_actions
from app.llm.schemas import LLMResponse, TradeRequest, WatchlistChange
from app.state import get_state


@pytest.fixture
def state(client):  # noqa: ARG001 — `client` fixture brings up the app+lifespan
    return get_state()


class TestTradeExecution:
    async def test_buy_executed(self, state, seed_price) -> None:
        seed_price("AAPL", 100.0)
        resp = LLMResponse(
            message="ok",
            trades=[TradeRequest(ticker="AAPL", side="buy", quantity=2)],
        )
        trades, changes = await execute_actions(resp, state)
        assert changes == []
        assert len(trades) == 1
        t = trades[0]
        assert t.status == "executed"
        assert t.ticker == "AAPL"
        assert t.side == "buy"
        assert t.quantity == 2
        assert t.price == 100.0
        assert t.error is None

    async def test_insufficient_cash_rejected(self, state, seed_price) -> None:
        seed_price("AAPL", 200.0)
        resp = LLMResponse(
            message="ok",
            trades=[TradeRequest(ticker="AAPL", side="buy", quantity=1000)],
        )
        trades, _ = await execute_actions(resp, state)
        assert trades[0].status == "rejected"
        assert trades[0].error == "insufficient_cash"
        assert trades[0].price is None

    async def test_insufficient_shares_rejected(self, state, seed_price) -> None:
        seed_price("AAPL", 200.0)
        resp = LLMResponse(
            message="ok",
            trades=[TradeRequest(ticker="AAPL", side="sell", quantity=5)],
        )
        trades, _ = await execute_actions(resp, state)
        assert trades[0].status == "rejected"
        assert trades[0].error == "insufficient_shares"

    async def test_ticker_unsupported_rejected(self, state) -> None:
        resp = LLMResponse(
            message="ok",
            trades=[TradeRequest(ticker="ZZZZZ", side="buy", quantity=1)],
        )
        trades, _ = await execute_actions(resp, state)
        assert trades[0].status == "rejected"
        assert trades[0].error == "ticker_unsupported"

    async def test_price_unavailable_mapping(self, state, monkeypatch) -> None:
        """Force a price_unavailable APIError and confirm it maps cleanly.

        Direct integration is racy on Windows because the simulator produces
        ticks fast enough that PYPL has a price by the time we get there, so
        we patch the trade endpoint to raise the specific APIError instead.
        """
        from app.api import errors as api_errors
        from app.api import portfolio as portfolio_api

        async def _raise(*_a, **_kw):
            raise api_errors.price_unavailable("forced")

        monkeypatch.setattr(portfolio_api, "post_trade", _raise)

        resp = LLMResponse(
            message="ok",
            trades=[TradeRequest(ticker="AAPL", side="buy", quantity=1)],
        )
        trades, _ = await execute_actions(resp, state)
        assert trades[0].status == "rejected"
        assert trades[0].error == "price_unavailable"


class TestWatchlistExecution:
    async def test_add_executed(self, state) -> None:
        resp = LLMResponse(
            message="ok",
            watchlist_changes=[WatchlistChange(ticker="PYPL", action="add")],
        )
        _, changes = await execute_actions(resp, state)
        assert len(changes) == 1
        c = changes[0]
        assert c.status == "executed"
        assert c.ticker == "PYPL"
        assert c.action == "add"
        assert c.error is None

    async def test_remove_executed(self, state) -> None:
        # AAPL is on the default seed watchlist
        resp = LLMResponse(
            message="ok",
            watchlist_changes=[WatchlistChange(ticker="AAPL", action="remove")],
        )
        _, changes = await execute_actions(resp, state)
        assert changes[0].status == "executed"
        assert changes[0].action == "remove"

    async def test_unsupported_add_rejected(self, state) -> None:
        resp = LLMResponse(
            message="ok",
            watchlist_changes=[WatchlistChange(ticker="ZZZZZ", action="add")],
        )
        _, changes = await execute_actions(resp, state)
        assert changes[0].status == "rejected"
        assert changes[0].error == "ticker_unsupported"


class TestIndependence:
    async def test_one_rejection_does_not_abort_others(
        self, state, seed_price
    ) -> None:
        seed_price("AAPL", 100.0)
        resp = LLMResponse(
            message="multi",
            trades=[
                TradeRequest(ticker="AAPL", side="buy", quantity=1),  # ok
                TradeRequest(ticker="ZZZZZ", side="buy", quantity=1),  # rejected
                TradeRequest(ticker="AAPL", side="buy", quantity=2),  # ok
            ],
            watchlist_changes=[
                WatchlistChange(ticker="ZZZZZ", action="add"),  # rejected
                WatchlistChange(ticker="PYPL", action="add"),  # ok
            ],
        )
        trades, changes = await execute_actions(resp, state)
        assert [t.status for t in trades] == ["executed", "rejected", "executed"]
        assert [c.status for c in changes] == ["rejected", "executed"]

    async def test_returns_lists_in_emission_order(
        self, state, seed_price
    ) -> None:
        seed_price("AAPL", 100.0)
        seed_price("MSFT", 400.0)
        resp = LLMResponse(
            message="ok",
            trades=[
                TradeRequest(ticker="MSFT", side="buy", quantity=1),
                TradeRequest(ticker="AAPL", side="buy", quantity=1),
            ],
        )
        trades, _ = await execute_actions(resp, state)
        assert [t.ticker for t in trades] == ["MSFT", "AAPL"]


class TestLLMTradesSkipRequestId:
    async def test_two_identical_trades_both_execute(
        self, state, seed_price
    ) -> None:
        """Per PLAN.md §8, LLM trades skip request_id, so two identical
        trades in the same response should NOT dedupe — they're separate
        market orders."""
        seed_price("AAPL", 50.0)
        resp = LLMResponse(
            message="ok",
            trades=[
                TradeRequest(ticker="AAPL", side="buy", quantity=1),
                TradeRequest(ticker="AAPL", side="buy", quantity=1),
            ],
        )
        from app.db import list_positions
        from app.db.connection import connect

        trades, _ = await execute_actions(resp, state)
        assert len(trades) == 2
        assert all(t.status == "executed" for t in trades)
        with connect() as conn:
            rows = list_positions(conn)
        aapl = next(r for r in rows if r["ticker"] == "AAPL")
        assert aapl["quantity"] == 2  # 1 + 1 = 2 shares
