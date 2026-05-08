"""Tests for the mock LLM dispatch table (PLAN.md §9 LLM Mock Mode).

The six branches of the dispatch table are a public contract with the E2E
suite. Any change to these tests is a breaking change.
"""

from __future__ import annotations

import pytest

from app.llm.mock import mock_llm
from app.llm.schemas import LLMResponse


class TestGreetingBranch:
    @pytest.mark.parametrize(
        "msg",
        [
            "",
            "   ",
            "\t\n",
            "hi",
            "Hi",
            "HELLO",
            "hey",
            "hi there",
            "hello world",
        ],
    )
    def test_greeting(self, msg: str):
        r = mock_llm(msg)
        assert r.message == "Hi, I'm FinAlly. Ask me about your portfolio."
        assert r.trades == []
        assert r.watchlist_changes == []


class TestBuyBranch:
    def test_buy_integer_quantity(self):
        r = mock_llm("buy 10 AAPL")
        assert r.message == "Buying 10 AAPL."
        assert len(r.trades) == 1
        t = r.trades[0]
        assert t.ticker == "AAPL"
        assert t.side == "buy"
        assert t.quantity == 10
        assert r.watchlist_changes == []

    def test_buy_fractional_quantity(self):
        r = mock_llm("buy 2.5 GOOGL")
        assert r.message == "Buying 2.5 GOOGL."
        assert r.trades[0].quantity == 2.5
        assert r.trades[0].ticker == "GOOGL"

    def test_buy_lowercase_ticker_normalised(self):
        # Spec says the dispatch table is case-insensitive; lowercase still matches
        # and the ticker is uppercased into the response.
        r = mock_llm("buy 10 aapl")
        assert r.message == "Buying 10 AAPL."
        assert r.trades and r.trades[0].ticker == "AAPL"

    def test_buy_inside_sentence(self):
        r = mock_llm("Please buy 5 NVDA right away")
        assert len(r.trades) == 1
        assert r.trades[0].ticker == "NVDA"
        assert r.trades[0].quantity == 5


class TestSellBranch:
    def test_sell_integer(self):
        r = mock_llm("sell 3 TSLA")
        assert r.message == "Selling 3 TSLA."
        assert len(r.trades) == 1
        assert r.trades[0].side == "sell"
        assert r.trades[0].ticker == "TSLA"
        assert r.trades[0].quantity == 3

    def test_sell_fractional(self):
        r = mock_llm("sell 0.5 META")
        assert r.trades[0].quantity == 0.5

    def test_buy_takes_precedence_when_both_keywords(self):
        # Order in the dispatch table: greeting -> buy -> sell. So "buy" wins.
        r = mock_llm("buy 1 AAPL and sell 2 GOOGL")
        assert r.trades[0].side == "buy"
        assert r.trades[0].ticker == "AAPL"


class TestWatchBranch:
    def test_watch_basic(self):
        r = mock_llm("watch PYPL")
        assert r.message == "Added PYPL to your watchlist."
        assert r.trades == []
        assert len(r.watchlist_changes) == 1
        assert r.watchlist_changes[0].ticker == "PYPL"
        assert r.watchlist_changes[0].action == "add"

    def test_watch_inside_sentence(self):
        r = mock_llm("could you watch SHOP for me")
        assert r.watchlist_changes[0].ticker == "SHOP"

    def test_watchlist_substring_does_not_match(self):
        # "watchlist" should not trigger because of \\b boundary on \\s+
        r = mock_llm("show me my watchlist")
        assert "Mock response" in r.message
        assert r.watchlist_changes == []


class TestUnwatchBranch:
    def test_unwatch(self):
        r = mock_llm("unwatch PYPL")
        assert r.message == "Removed PYPL from your watchlist."
        assert r.watchlist_changes[0].action == "remove"

    def test_remove(self):
        r = mock_llm("remove SHOP")
        assert r.message == "Removed SHOP from your watchlist."
        assert r.watchlist_changes[0].ticker == "SHOP"
        assert r.watchlist_changes[0].action == "remove"


class TestFallthrough:
    @pytest.mark.parametrize(
        "msg",
        [
            "what should I do",
            "is my portfolio risky?",
            "tell me about Tesla",
        ],
    )
    def test_falls_through_to_generic(self, msg: str):
        r = mock_llm(msg)
        assert r.message == f"Mock response: I received '{msg}'."
        assert r.trades == []
        assert r.watchlist_changes == []

    def test_non_string_input_is_safe(self):
        r = mock_llm(None)  # type: ignore[arg-type]
        # None becomes empty -> matches the greeting branch via ^\s*$
        assert r.message == "Hi, I'm FinAlly. Ask me about your portfolio."


class TestPriorityOrder:
    """Make sure dispatch order is greeting -> buy -> sell -> watch -> unwatch -> fallthrough."""

    def test_buy_beats_watch(self):
        r = mock_llm("buy 1 AAPL and watch GOOGL")
        # "buy" wins; watchlist_changes stays empty
        assert r.trades and r.trades[0].ticker == "AAPL"
        assert r.watchlist_changes == []

    def test_sell_beats_watch(self):
        r = mock_llm("sell 1 AAPL and watch GOOGL")
        assert r.trades and r.trades[0].side == "sell"
        assert r.watchlist_changes == []


class TestReturnType:
    """Mock responses must always be valid LLMResponse objects."""

    def test_returns_llm_response(self):
        for msg in ["", "hi", "buy 1 AAPL", "sell 1 AAPL", "watch X", "unwatch X", "garbage"]:
            r = mock_llm(msg)
            assert isinstance(r, LLMResponse)
            assert isinstance(r.message, str)
