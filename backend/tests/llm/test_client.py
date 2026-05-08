"""Tests for the LiteLLM client wrapper.

We never make a real Anthropic call here — the real path is exercised by
patching `litellm.completion`.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.llm.client import DEFAULT_MODEL, LLMCallError, call_llm, real_llm
from app.llm.schemas import LLMResponse, PortfolioContext


def _ctx() -> PortfolioContext:
    return PortfolioContext(cash_balance=10000.0, total_value=10000.0)


def _fake_completion_response(json_str: str) -> SimpleNamespace:
    """Build a duck-typed LiteLLM ModelResponse stand-in."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=json_str))]
    )


class TestDispatch:
    def test_mock_mode_routes_to_mock(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("LLM_MOCK", "true")
        r = call_llm("hi", _ctx(), [])
        assert r.message == "Hi, I'm FinAlly. Ask me about your portfolio."

    def test_mock_mode_case_insensitive(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("LLM_MOCK", "TRUE")
        r = call_llm("buy 1 AAPL", _ctx(), [])
        assert r.trades and r.trades[0].ticker == "AAPL"

    def test_mock_mode_off_calls_real(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("LLM_MOCK", raising=False)

        called = {}

        def fake_completion(**kwargs):
            called.update(kwargs)
            return _fake_completion_response('{"message": "ok"}')

        monkeypatch.setattr("litellm.completion", fake_completion)
        r = call_llm("hello", _ctx(), [])
        assert r.message == "ok"
        assert called["model"] == DEFAULT_MODEL
        assert called["response_format"] is LLMResponse

    def test_llm_mock_false_uses_real_path(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("LLM_MOCK", "false")

        def fake_completion(**kwargs):
            return _fake_completion_response('{"message": "real"}')

        monkeypatch.setattr("litellm.completion", fake_completion)
        r = call_llm("hello", _ctx(), [])
        assert r.message == "real"


class TestRealLLMSuccess:
    def test_parses_full_response(self, monkeypatch: pytest.MonkeyPatch):
        json_str = (
            '{"message": "Bought.", '
            '"trades": [{"ticker": "AAPL", "side": "buy", "quantity": 5}], '
            '"watchlist_changes": []}'
        )
        monkeypatch.setattr(
            "litellm.completion",
            lambda **_: _fake_completion_response(json_str),
        )
        r = real_llm("buy 5 AAPL", _ctx(), [])
        assert r.message == "Bought."
        assert r.trades[0].quantity == 5

    def test_passes_messages_argument(self, monkeypatch: pytest.MonkeyPatch):
        captured = {}

        def fake_completion(**kwargs):
            captured.update(kwargs)
            return _fake_completion_response('{"message": "x"}')

        monkeypatch.setattr("litellm.completion", fake_completion)
        history = [
            {"role": "user", "content": "earlier"},
            {"role": "assistant", "content": "earlier reply"},
        ]
        real_llm("now", _ctx(), history)
        msgs = captured["messages"]
        assert msgs[0]["role"] == "system"
        assert msgs[-1] == {"role": "user", "content": "now"}
        # History rows preserved between system and new-user
        assert {"role": "user", "content": "earlier"} in msgs

    def test_custom_model_override(self, monkeypatch: pytest.MonkeyPatch):
        captured = {}

        def fake_completion(**kwargs):
            captured.update(kwargs)
            return _fake_completion_response('{"message": "x"}')

        monkeypatch.setattr("litellm.completion", fake_completion)
        real_llm("now", _ctx(), [], model="anthropic/claude-sonnet-4-6")
        assert captured["model"] == "anthropic/claude-sonnet-4-6"


class TestRealLLMFailures:
    def test_completion_exception_becomes_llm_call_error(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        def boom(**_):
            raise RuntimeError("network down")

        monkeypatch.setattr("litellm.completion", boom)
        with pytest.raises(LLMCallError) as exc:
            real_llm("x", _ctx(), [])
        assert "network down" in str(exc.value)

    def test_empty_content_raises(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "litellm.completion",
            lambda **_: _fake_completion_response(""),
        )
        with pytest.raises(LLMCallError, match="empty"):
            real_llm("x", _ctx(), [])

    def test_malformed_json_raises(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "litellm.completion",
            lambda **_: _fake_completion_response("not json {"),
        )
        with pytest.raises(LLMCallError, match="parse"):
            real_llm("x", _ctx(), [])

    def test_schema_violation_raises(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "litellm.completion",
            lambda **_: _fake_completion_response("{}"),  # missing message
        )
        with pytest.raises(LLMCallError, match="parse"):
            real_llm("x", _ctx(), [])

    def test_unexpected_response_shape_raises(self, monkeypatch: pytest.MonkeyPatch):
        # No `choices` attribute -> AttributeError caught -> LLMCallError
        monkeypatch.setattr(
            "litellm.completion",
            lambda **_: SimpleNamespace(),
        )
        with pytest.raises(LLMCallError):
            real_llm("x", _ctx(), [])
