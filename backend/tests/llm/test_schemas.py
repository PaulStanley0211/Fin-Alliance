"""Tests for the LLM Pydantic schemas."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.llm.schemas import (
    ChatResponseEnvelope,
    ExecutedTrade,
    ExecutedWatchlistChange,
    LLMResponse,
    PortfolioContext,
    PortfolioPosition,
    TradeRequest,
    WatchlistChange,
    WatchlistEntry,
)


class TestTradeRequest:
    def test_valid_buy(self):
        t = TradeRequest(ticker="AAPL", side="buy", quantity=10)
        assert t.ticker == "AAPL"
        assert t.side == "buy"
        assert t.quantity == 10

    def test_normalises_lowercase_ticker(self):
        t = TradeRequest(ticker="  aapl  ", side="buy", quantity=1)
        assert t.ticker == "AAPL"

    def test_fractional_quantity(self):
        t = TradeRequest(ticker="GOOGL", side="sell", quantity=0.5)
        assert t.quantity == 0.5

    def test_rejects_zero_quantity(self):
        with pytest.raises(ValidationError):
            TradeRequest(ticker="AAPL", side="buy", quantity=0)

    def test_rejects_negative_quantity(self):
        with pytest.raises(ValidationError):
            TradeRequest(ticker="AAPL", side="buy", quantity=-1)

    def test_rejects_invalid_side(self):
        with pytest.raises(ValidationError):
            TradeRequest(ticker="AAPL", side="hold", quantity=1)

    def test_rejects_non_string_ticker(self):
        with pytest.raises(ValidationError):
            TradeRequest(ticker=123, side="buy", quantity=1)

    def test_extra_fields_ignored(self):
        t = TradeRequest(ticker="AAPL", side="buy", quantity=1, extra_field="x")
        assert not hasattr(t, "extra_field")


class TestWatchlistChange:
    def test_add(self):
        w = WatchlistChange(ticker="PYPL", action="add")
        assert w.ticker == "PYPL"
        assert w.action == "add"

    def test_remove_normalises(self):
        w = WatchlistChange(ticker="pypl", action="remove")
        assert w.ticker == "PYPL"

    def test_invalid_action(self):
        with pytest.raises(ValidationError):
            WatchlistChange(ticker="AAPL", action="follow")


class TestLLMResponse:
    def test_minimal_message_only(self):
        r = LLMResponse(message="Hello")
        assert r.message == "Hello"
        assert r.trades == []
        assert r.watchlist_changes == []

    def test_full_response(self):
        r = LLMResponse(
            message="Buying.",
            trades=[{"ticker": "AAPL", "side": "buy", "quantity": 10}],
            watchlist_changes=[{"ticker": "PYPL", "action": "add"}],
        )
        assert len(r.trades) == 1
        assert r.trades[0].ticker == "AAPL"
        assert r.watchlist_changes[0].ticker == "PYPL"

    def test_parses_valid_json(self):
        json_str = (
            '{"message": "Bought.", '
            '"trades": [{"ticker": "AAPL", "side": "buy", "quantity": 5}], '
            '"watchlist_changes": []}'
        )
        r = LLMResponse.model_validate_json(json_str)
        assert r.message == "Bought."
        assert r.trades[0].quantity == 5

    def test_parses_missing_optional_arrays(self):
        # Real-world: model omits the action arrays when there's nothing to do.
        r = LLMResponse.model_validate_json('{"message": "Just analysis."}')
        assert r.trades == []
        assert r.watchlist_changes == []

    def test_rejects_malformed_json(self):
        with pytest.raises(ValueError):
            LLMResponse.model_validate_json("{not json")

    def test_rejects_missing_message(self):
        with pytest.raises(ValidationError):
            LLMResponse.model_validate_json("{}")

    def test_rejects_invalid_trade_in_array(self):
        bad = (
            '{"message": "x", '
            '"trades": [{"ticker": "AAPL", "side": "BUY_HARDER", "quantity": 1}]}'
        )
        with pytest.raises(ValidationError):
            LLMResponse.model_validate_json(bad)

    def test_extra_top_level_fields_ignored(self):
        r = LLMResponse.model_validate_json('{"message": "x", "metadata": {"foo": 1}}')
        assert r.message == "x"


class TestExecutedActions:
    def test_executed_trade_status(self):
        e = ExecutedTrade(
            ticker="AAPL", side="buy", quantity=10, status="executed", price=190.5
        )
        assert e.status == "executed"
        assert e.error is None

    def test_rejected_trade_with_error(self):
        e = ExecutedTrade(
            ticker="AAPL",
            side="buy",
            quantity=10,
            status="rejected",
            price=None,
            error="insufficient_cash",
        )
        assert e.error == "insufficient_cash"
        assert e.price is None

    def test_executed_watchlist_change(self):
        e = ExecutedWatchlistChange(ticker="PYPL", action="add", status="executed")
        assert e.error is None

    def test_invalid_error_code_rejected(self):
        with pytest.raises(ValidationError):
            ExecutedTrade(
                ticker="AAPL",
                side="buy",
                quantity=1,
                status="rejected",
                error="not_in_error_enum",
            )


class TestChatResponseEnvelope:
    def test_minimal_envelope(self):
        env = ChatResponseEnvelope(message="hi")
        assert env.message == "hi"
        assert env.executed_trades == []
        assert env.executed_watchlist_changes == []
        assert env.error is None

    def test_envelope_serialises_with_alias_fields(self):
        env = ChatResponseEnvelope(
            message="Bought 10 AAPL.",
            executed_trades=[
                ExecutedTrade(
                    ticker="AAPL",
                    side="buy",
                    quantity=10,
                    status="executed",
                    price=190.5,
                )
            ],
            executed_watchlist_changes=[
                ExecutedWatchlistChange(ticker="PYPL", action="add", status="executed"),
            ],
        )
        data = env.model_dump()
        assert data["message"] == "Bought 10 AAPL."
        assert data["executed_trades"][0]["price"] == 190.5
        assert data["executed_watchlist_changes"][0]["ticker"] == "PYPL"
        assert data["error"] is None

    def test_error_envelope(self):
        env = ChatResponseEnvelope(message="Sorry, I'm offline.", error="llm_call_failed")
        assert env.error == "llm_call_failed"


class TestPortfolioContext:
    def test_empty_portfolio(self):
        ctx = PortfolioContext(cash_balance=10000.0, total_value=10000.0)
        assert ctx.positions == []
        assert ctx.watchlist == []

    def test_full_portfolio(self):
        ctx = PortfolioContext(
            cash_balance=8000.0,
            positions=[
                PortfolioPosition(
                    ticker="AAPL",
                    quantity=10,
                    avg_cost=190.0,
                    current_price=200.0,
                    unrealized_pnl=100.0,
                    unrealized_pnl_percent=5.26,
                )
            ],
            watchlist=[WatchlistEntry(ticker="GOOGL", current_price=175.5)],
            total_value=10000.0,
        )
        assert len(ctx.positions) == 1
        assert ctx.watchlist[0].ticker == "GOOGL"
