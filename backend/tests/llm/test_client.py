"""Tests for the LiteLLM client wrapper.

We never make a real Anthropic call here — the real path is exercised by
patching `litellm.acompletion`.

Note on env handling: LiteLLM eagerly loads the project-root `.env` on
import, which sets `LLM_MOCK=true`. The conftest's autouse fixture also
sets it. Tests that need the real-llm dispatch path must `delenv` after
import time and force `LLM_MOCK=` (empty) to defeat both layers.

`asyncio_mode = "auto"` in pyproject means async test functions run
without the `@pytest.mark.asyncio` decorator.
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


def _make_fake_acompletion(response):
    """Return an async stand-in for `litellm.acompletion`.

    `response` may be a SimpleNamespace or an Exception instance to raise.
    The kwargs the call was made with are recorded on `fake.captured`.
    """

    async def fake(**kwargs):
        fake.captured = kwargs
        if isinstance(response, BaseException):
            raise response
        return response

    fake.captured = {}
    return fake


class TestDispatch:
    async def test_mock_mode_routes_to_mock(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("LLM_MOCK", "true")
        r = await call_llm("hi", _ctx(), [])
        assert r.message == "Hi, I'm FinAlly. Ask me about your portfolio."

    async def test_mock_mode_case_insensitive(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("LLM_MOCK", "TRUE")
        r = await call_llm("buy 1 AAPL", _ctx(), [])
        assert r.trades and r.trades[0].ticker == "AAPL"

    async def test_mock_mode_off_calls_real(self, monkeypatch: pytest.MonkeyPatch):
        # `setenv("")` defeats both the conftest autouse fixture and any
        # `LLM_MOCK=true` leaked from the project-root `.env` (loaded by
        # LiteLLM at import time).
        monkeypatch.setenv("LLM_MOCK", "")

        fake = _make_fake_acompletion(_fake_completion_response('{"message": "ok"}'))
        monkeypatch.setattr("litellm.acompletion", fake)
        r = await call_llm("hello", _ctx(), [])
        assert r.message == "ok"
        assert fake.captured["model"] == DEFAULT_MODEL
        assert fake.captured["response_format"] is LLMResponse

    async def test_llm_mock_false_uses_real_path(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("LLM_MOCK", "false")

        fake = _make_fake_acompletion(_fake_completion_response('{"message": "real"}'))
        monkeypatch.setattr("litellm.acompletion", fake)
        r = await call_llm("hello", _ctx(), [])
        assert r.message == "real"


class TestRealLLMSuccess:
    async def test_parses_full_response(self, monkeypatch: pytest.MonkeyPatch):
        json_str = (
            '{"message": "Bought.", '
            '"trades": [{"ticker": "AAPL", "side": "buy", "quantity": 5}], '
            '"watchlist_changes": []}'
        )
        fake = _make_fake_acompletion(_fake_completion_response(json_str))
        monkeypatch.setattr("litellm.acompletion", fake)
        r = await real_llm("buy 5 AAPL", _ctx(), [])
        assert r.message == "Bought."
        assert r.trades[0].quantity == 5

    async def test_passes_messages_argument(self, monkeypatch: pytest.MonkeyPatch):
        fake = _make_fake_acompletion(_fake_completion_response('{"message": "x"}'))
        monkeypatch.setattr("litellm.acompletion", fake)
        history = [
            {"role": "user", "content": "earlier"},
            {"role": "assistant", "content": "earlier reply"},
        ]
        await real_llm("now", _ctx(), history)
        msgs = fake.captured["messages"]
        assert msgs[0]["role"] == "system"
        assert msgs[-1] == {"role": "user", "content": "now"}
        # History rows preserved between system and new-user
        assert {"role": "user", "content": "earlier"} in msgs

    async def test_system_prompt_has_cache_control(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """The static instructions block must carry `cache_control: ephemeral`
        so Anthropic re-uses the cached prefix on follow-up turns."""
        fake = _make_fake_acompletion(_fake_completion_response('{"message": "x"}'))
        monkeypatch.setattr("litellm.acompletion", fake)
        await real_llm("now", _ctx(), [])
        system_msg = fake.captured["messages"][0]
        assert system_msg["role"] == "system"
        # Two-block content: static (cached) + dynamic portfolio.
        blocks = system_msg["content"]
        assert isinstance(blocks, list) and len(blocks) == 2
        assert blocks[0]["cache_control"] == {"type": "ephemeral"}
        assert "cache_control" not in blocks[1]

    async def test_max_tokens_capped(self, monkeypatch: pytest.MonkeyPatch):
        fake = _make_fake_acompletion(_fake_completion_response('{"message": "x"}'))
        monkeypatch.setattr("litellm.acompletion", fake)
        await real_llm("now", _ctx(), [])
        assert fake.captured["max_tokens"] > 0
        assert fake.captured["max_tokens"] <= 1024  # sanity cap

    async def test_custom_model_override(self, monkeypatch: pytest.MonkeyPatch):
        fake = _make_fake_acompletion(_fake_completion_response('{"message": "x"}'))
        monkeypatch.setattr("litellm.acompletion", fake)
        await real_llm("now", _ctx(), [], model="anthropic/claude-sonnet-4-6")
        assert fake.captured["model"] == "anthropic/claude-sonnet-4-6"


class TestRealLLMFailures:
    async def test_completion_exception_becomes_llm_call_error(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        fake = _make_fake_acompletion(RuntimeError("network down"))
        monkeypatch.setattr("litellm.acompletion", fake)
        with pytest.raises(LLMCallError) as exc:
            await real_llm("x", _ctx(), [])
        assert "network down" in str(exc.value)

    async def test_empty_content_raises(self, monkeypatch: pytest.MonkeyPatch):
        fake = _make_fake_acompletion(_fake_completion_response(""))
        monkeypatch.setattr("litellm.acompletion", fake)
        with pytest.raises(LLMCallError, match="empty"):
            await real_llm("x", _ctx(), [])

    async def test_malformed_json_raises(self, monkeypatch: pytest.MonkeyPatch):
        fake = _make_fake_acompletion(_fake_completion_response("not json {"))
        monkeypatch.setattr("litellm.acompletion", fake)
        with pytest.raises(LLMCallError, match="parse"):
            await real_llm("x", _ctx(), [])

    async def test_schema_violation_raises(self, monkeypatch: pytest.MonkeyPatch):
        fake = _make_fake_acompletion(_fake_completion_response("{}"))  # no message
        monkeypatch.setattr("litellm.acompletion", fake)
        with pytest.raises(LLMCallError, match="parse"):
            await real_llm("x", _ctx(), [])

    async def test_unexpected_response_shape_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        # No `choices` attribute -> AttributeError caught -> LLMCallError
        fake = _make_fake_acompletion(SimpleNamespace())
        monkeypatch.setattr("litellm.acompletion", fake)
        with pytest.raises(LLMCallError):
            await real_llm("x", _ctx(), [])
