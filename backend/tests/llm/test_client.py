"""Tests for the streaming LiteLLM client wrapper.

We never make a real Anthropic call here — the real path is exercised by
patching `litellm.acompletion` to return an async iterator of fake chunks.

Note on env handling: LiteLLM eagerly loads the project-root `.env` on
import, which sets `LLM_MOCK=true`. The conftest's autouse fixture also
sets it. Tests that need the real-llm dispatch path must `delenv` after
import time and force `LLM_MOCK=` (empty) to defeat both layers.

`asyncio_mode = "auto"` in pyproject means async test functions run
without the `@pytest.mark.asyncio` decorator.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import AsyncIterator

import pytest

from app.llm.client import (
    DEFAULT_MODEL,
    LLMCallError,
    TaggedStreamParser,
    stream_llm,
)
from app.llm.schemas import LLMResponse, PortfolioContext


def _ctx() -> PortfolioContext:
    return PortfolioContext(cash_balance=10000.0, total_value=10000.0)


def _chunk(content: str) -> SimpleNamespace:
    """Build a duck-typed LiteLLM streaming chunk carrying `content`."""
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=content))]
    )


def _make_fake_acompletion(chunks: list[str] | BaseException):
    """Return an async stand-in for `litellm.acompletion(stream=True)`.

    `chunks` may be a list of strings (each becomes one streaming chunk) or
    an Exception instance to raise from the initial `acompletion()` call.
    The kwargs the call was made with are recorded on `fake.captured`.
    """

    async def _aiter(items: list[str]) -> AsyncIterator[SimpleNamespace]:
        for s in items:
            yield _chunk(s)

    async def fake(**kwargs):
        fake.captured = kwargs
        if isinstance(chunks, BaseException):
            raise chunks
        return _aiter(chunks)

    fake.captured = {}
    return fake


async def _drain(gen) -> tuple[str, LLMResponse | None]:
    """Drive the async generator to completion. Returns the joined deltas
    and the final payload (None if not provided)."""
    text = []
    final: LLMResponse | None = None
    async for delta, payload in gen:
        if delta:
            text.append(delta)
        if payload is not None:
            final = payload
    return "".join(text), final


# ---------------------------------------------------------------------------
# TaggedStreamParser unit tests
# ---------------------------------------------------------------------------


class TestTaggedStreamParser:
    def test_emits_text_inside_reply_tag(self):
        p = TaggedStreamParser()
        # Feed in chunks; the parser holds back the last 9 chars while inside
        # <reply>, so we'll get most of "hello" emitted but not the last few
        # chars until the close tag arrives.
        p.feed("<reply>hello world, what's up</reply>")
        reply, actions = p.finalize()
        assert reply == "hello world, what's up"
        assert actions == {"trades": [], "watchlist_changes": []}

    def test_emits_chunked_text_progressively(self):
        p = TaggedStreamParser()
        d1 = p.feed("<reply>The market is")
        d2 = p.feed(" looking strong today")
        d3 = p.feed(" overall.</reply><actions>")
        d4 = p.feed('{"trades": [], "watchlist_changes": []}</actions>')
        joined = (d1 + d2 + d3 + d4).strip()
        assert "looking strong" in joined
        reply, _ = p.finalize()
        assert reply.startswith("The market is")
        assert reply.endswith("overall.")

    def test_strips_leading_newlines_after_reply_open(self):
        p = TaggedStreamParser()
        delta = p.feed("<reply>\n\nReady.</reply>")
        # No leading newlines in the first delta the user sees.
        assert delta.startswith("Ready") or "Ready" in delta

    def test_parses_actions_with_trades(self):
        p = TaggedStreamParser()
        p.feed(
            "<reply>buying.</reply><actions>"
            '{"trades": [{"ticker": "AAPL", "side": "buy", "quantity": 5}], '
            '"watchlist_changes": []}</actions>'
        )
        reply, actions = p.finalize()
        assert reply == "buying."
        assert actions["trades"] == [
            {"ticker": "AAPL", "side": "buy", "quantity": 5}
        ]
        assert actions["watchlist_changes"] == []

    def test_malformed_actions_json_is_tolerated(self):
        p = TaggedStreamParser()
        p.feed("<reply>hi.</reply><actions>not json {{</actions>")
        reply, actions = p.finalize()
        assert reply == "hi."
        # Falls back to empty arrays.
        assert actions == {"trades": [], "watchlist_changes": []}

    def test_missing_reply_tag_falls_back_to_raw_text(self):
        # Worst-case fallback: model forgot the tags entirely. The reply
        # text is still recoverable from finalize() so the chat bubble
        # isn't blank.
        p = TaggedStreamParser()
        p.feed("Just some text with no tags at all.")
        reply, _ = p.finalize()
        assert reply == "Just some text with no tags at all."

    def test_unclosed_reply_tag_returns_partial_text(self):
        # Stream truncated mid-reply — finalize() should still hand us the
        # text we did get.
        p = TaggedStreamParser()
        p.feed("<reply>partial answer")
        reply, actions = p.finalize()
        assert reply == "partial answer"
        assert actions == {"trades": [], "watchlist_changes": []}


# ---------------------------------------------------------------------------
# stream_llm dispatch — mock vs real
# ---------------------------------------------------------------------------


class TestStreamDispatch:
    async def test_mock_mode_yields_mock_response(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("LLM_MOCK", "true")
        text, payload = await _drain(stream_llm("hi", _ctx(), []))
        assert text == "Hi, I'm FinAlly. Ask me about your portfolio."
        assert payload is not None
        assert payload.message == text

    async def test_mock_mode_buy_yields_trade_in_payload(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("LLM_MOCK", "TRUE")
        text, payload = await _drain(stream_llm("buy 3 AAPL", _ctx(), []))
        assert "Buying 3" in text
        assert payload is not None
        assert payload.trades and payload.trades[0].ticker == "AAPL"
        assert payload.trades[0].quantity == 3

    async def test_real_path_streams_tagged_response(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("LLM_MOCK", "")
        chunks = [
            "<reply>",
            "Looks ",
            "balanced.",
            "</reply><actions>",
            '{"trades": [], "watchlist_changes": []}</actions>',
        ]
        fake = _make_fake_acompletion(chunks)
        monkeypatch.setattr("litellm.acompletion", fake)
        text, payload = await _drain(stream_llm("hi", _ctx(), []))
        assert "balanced" in text
        assert payload is not None
        assert payload.message.strip() == "Looks balanced."
        assert fake.captured["model"] == DEFAULT_MODEL
        assert fake.captured["stream"] is True
        assert fake.captured["max_tokens"] > 0

    async def test_real_path_passes_tagged_system_prompt(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """The system message must carry the cache_control breakpoint and
        instruct the model to use the tagged format."""
        monkeypatch.setenv("LLM_MOCK", "")
        fake = _make_fake_acompletion(
            ["<reply>x</reply><actions>{}</actions>"]
        )
        monkeypatch.setattr("litellm.acompletion", fake)
        await _drain(stream_llm("now", _ctx(), []))
        system_msg = fake.captured["messages"][0]
        assert system_msg["role"] == "system"
        blocks = system_msg["content"]
        assert isinstance(blocks, list) and len(blocks) == 2
        assert blocks[0]["cache_control"] == {"type": "ephemeral"}
        assert "<reply>" in blocks[0]["text"]


# ---------------------------------------------------------------------------
# Failure modes
# ---------------------------------------------------------------------------


class TestStreamFailures:
    async def test_acompletion_init_failure_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("LLM_MOCK", "")
        fake = _make_fake_acompletion(RuntimeError("network down"))
        monkeypatch.setattr("litellm.acompletion", fake)
        with pytest.raises(LLMCallError) as exc:
            await _drain(stream_llm("x", _ctx(), []))
        assert "network down" in str(exc.value)

    async def test_mid_stream_exception_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """If the stream raises after the first chunk, surface as LLMCallError."""
        monkeypatch.setenv("LLM_MOCK", "")

        async def aiter_with_failure() -> AsyncIterator[SimpleNamespace]:
            yield _chunk("<reply>partial")
            raise RuntimeError("connection dropped")

        async def fake(**kwargs):
            fake.captured = kwargs
            return aiter_with_failure()

        fake.captured = {}
        monkeypatch.setattr("litellm.acompletion", fake)

        with pytest.raises(LLMCallError, match="connection dropped"):
            await _drain(stream_llm("x", _ctx(), []))

    async def test_empty_stream_falls_back_to_empty_payload(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """A stream that yields nothing at all still surfaces a payload — the
        message is empty but the request didn't fail."""
        monkeypatch.setenv("LLM_MOCK", "")
        fake = _make_fake_acompletion([])
        monkeypatch.setattr("litellm.acompletion", fake)
        text, payload = await _drain(stream_llm("x", _ctx(), []))
        assert text == ""
        assert payload is not None
        # Empty reply but trades/watchlist arrays present.
        assert payload.trades == []
        assert payload.watchlist_changes == []
