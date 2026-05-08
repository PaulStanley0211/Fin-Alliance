"""Tests for the system-prompt builder and message assembly."""

from __future__ import annotations

from app.llm.prompt import HISTORY_LIMIT, build_messages, build_system_prompt
from app.llm.schemas import PortfolioContext, PortfolioPosition, WatchlistEntry


def _empty_ctx() -> PortfolioContext:
    return PortfolioContext(cash_balance=10000.0, total_value=10000.0)


def _full_ctx() -> PortfolioContext:
    return PortfolioContext(
        cash_balance=8000.0,
        positions=[
            PortfolioPosition(
                ticker="AAPL",
                quantity=10,
                avg_cost=190.0,
                current_price=200.0,
                unrealized_pnl=100.0,
                unrealized_pnl_percent=5.26,
            ),
            PortfolioPosition(
                ticker="GOOGL",
                quantity=2,
                avg_cost=170.0,
                current_price=180.0,
                unrealized_pnl=20.0,
                unrealized_pnl_percent=5.88,
            ),
        ],
        watchlist=[
            WatchlistEntry(ticker="MSFT", current_price=420.0),
            WatchlistEntry(ticker="NVDA", current_price=None),
        ],
        total_value=10120.0,
    )


class TestSystemPrompt:
    def test_includes_cash_and_total(self):
        ctx = _full_ctx()
        prompt = build_system_prompt(ctx)
        assert "$8000.00" in prompt
        assert "$10120.00" in prompt

    def test_includes_position_lines(self):
        ctx = _full_ctx()
        prompt = build_system_prompt(ctx)
        assert "AAPL" in prompt
        assert "GOOGL" in prompt
        assert "$190.00" in prompt  # avg cost
        assert "$200.00" in prompt  # current price
        assert "+5.26%" in prompt   # pnl percent

    def test_includes_watchlist(self):
        ctx = _full_ctx()
        prompt = build_system_prompt(ctx)
        assert "MSFT" in prompt
        assert "$420.00" in prompt
        assert "NVDA" in prompt
        # Missing-price watchlist entry shows em-dash
        assert "—" in prompt

    def test_empty_portfolio_renders_none(self):
        ctx = _empty_ctx()
        prompt = build_system_prompt(ctx)
        assert "Positions (0)" in prompt
        assert "Watchlist (0)" in prompt
        assert "(none)" in prompt

    def test_explicit_intent_rule_present(self):
        prompt = build_system_prompt(_empty_ctx())
        # PLAN.md §9 — the prompt MUST encode the explicit-intent constraint.
        assert "explicit" in prompt.lower()
        assert "trades" in prompt

    def test_describes_json_schema(self):
        prompt = build_system_prompt(_empty_ctx())
        assert "trades" in prompt
        assert "watchlist_changes" in prompt
        assert "message" in prompt


class TestBuildMessages:
    def test_minimum_shape(self):
        msgs = build_messages(_empty_ctx(), [], "Hello")
        assert len(msgs) == 2
        assert msgs[0]["role"] == "system"
        assert msgs[1]["role"] == "user"
        assert msgs[1]["content"] == "Hello"

    def test_includes_history_in_order(self):
        history = [
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "reply"},
            {"role": "user", "content": "second"},
        ]
        msgs = build_messages(_empty_ctx(), history, "third")
        assert msgs[0]["role"] == "system"
        assert msgs[1] == {"role": "user", "content": "first"}
        assert msgs[2] == {"role": "assistant", "content": "reply"}
        assert msgs[3] == {"role": "user", "content": "second"}
        assert msgs[4] == {"role": "user", "content": "third"}

    def test_trims_history_to_limit(self):
        history = [
            {"role": "user", "content": f"msg-{i}"} for i in range(HISTORY_LIMIT + 5)
        ]
        msgs = build_messages(_empty_ctx(), history, "now")
        # System + HISTORY_LIMIT + new user
        assert len(msgs) == HISTORY_LIMIT + 2
        # Oldest in trimmed window is msg-5 (since we cap to most recent 20)
        assert msgs[1]["content"] == "msg-5"

    def test_skips_malformed_history_entries(self):
        history = [
            {"role": "user", "content": "valid"},
            {"role": "system", "content": "system messages should not survive"},
            {"role": "assistant"},  # no content
            "not a dict",
            {"role": "user", "content": 123},  # non-string content
            {"role": "assistant", "content": "kept"},
        ]
        msgs = build_messages(_empty_ctx(), history, "next")
        # system + valid + kept + new user = 4
        contents = [m["content"] for m in msgs]
        assert "valid" in contents
        assert "kept" in contents
        assert "system messages should not survive" not in contents

    def test_accepts_objects_with_role_and_content_attrs(self):
        class Row:
            def __init__(self, role: str, content: str) -> None:
                self.role = role
                self.content = content

        history = [Row("user", "hi"), Row("assistant", "hello")]
        msgs = build_messages(_empty_ctx(), history, "next")
        assert msgs[1] == {"role": "user", "content": "hi"}
        assert msgs[2] == {"role": "assistant", "content": "hello"}
