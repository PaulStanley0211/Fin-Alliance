"""LiteLLM client for FinAlly's chat assistant — streaming edition.

Defaults to ``anthropic/claude-haiku-4-5`` (PLAN.md §9). LiteLLM picks up the
``ANTHROPIC_API_KEY`` env var automatically.

The model emits a tagged response (see ``prompt.py``):

    <reply>
    Conversational text...
    </reply>
    <actions>
    {"trades": [...], "watchlist_changes": []}
    </actions>

We stream the raw assistant text from Anthropic, run it through a small
state-machine parser, and yield ``(delta, action_payload)`` tuples to the
caller:

- ``delta`` is non-empty only while we're inside ``<reply>...</reply>`` —
  it carries the next chunk of user-visible text. The parser holds back the
  trailing few characters of its buffer so it never accidentally emits the
  start of ``</reply>``.
- ``action_payload`` is non-None only on the final yield, after the stream
  has closed. It carries the parsed ``LLMResponse`` (with the tagged-format
  reply already extracted) so the caller can run the executor.

Two entry points:

- ``stream_llm(...)`` — async generator over the real LiteLLM call.
- ``stream_mock(...)`` — async generator that emits the deterministic mock
  response in one delta + one final payload, used when ``LLM_MOCK=true``.

On any failure (network, timeout, anything raised inside LiteLLM) the
generator raises ``LLMCallError``. The ``/api/chat`` route catches it and
emits an SSE ``error`` event.
"""

from __future__ import annotations

import json
import logging
import os
from typing import AsyncIterator, Iterable

from .mock import mock_llm
from .prompt import build_messages
from .schemas import LLMResponse, PortfolioContext

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "anthropic/claude-haiku-4-5"

# Keep responses tight. The system prompt asks for 2-3 sentences; this is the
# safety cap so a model wandering off-script can't drag the latency past ~4s.
MAX_OUTPUT_TOKENS = 600

# Hard timeout on the LiteLLM call. Long enough for a normal-length response
# even on a cache miss, short enough that we surface "couldn't reach the
# assistant" promptly when Anthropic is slow.
COMPLETION_TIMEOUT_SECONDS = 30.0

# Transient retries — covers 5xx / network blips. LiteLLM uses exponential
# backoff between attempts.
NUM_RETRIES = 2

REPLY_OPEN = "<reply>"
REPLY_CLOSE = "</reply>"
ACTIONS_OPEN = "<actions>"
ACTIONS_CLOSE = "</actions>"


class LLMCallError(RuntimeError):
    """Raised when the LLM call or structured-output parse fails."""


def _is_mock_enabled() -> bool:
    return os.environ.get("LLM_MOCK", "").strip().lower() == "true"


# ---------------------------------------------------------------------------
# Tagged-format streaming parser
# ---------------------------------------------------------------------------


class TaggedStreamParser:
    """Incremental parser for the model's tagged response format.

    The model is asked to emit something like::

        <reply>
        Conversational text...
        </reply>
        <actions>{"trades": [...], "watchlist_changes": []}</actions>

    In practice Anthropic Haiku frequently *omits* ``<reply>`` and writes
    plain text directly before ``<actions>``. The parser treats ``<actions>``
    as the only required delimiter:

    - Everything before ``<actions>`` is the user-visible reply (with any
      stray ``<reply>``/``</reply>`` tokens stripped).
    - The JSON inside ``<actions>...</actions>`` is parsed at the end.
    - If neither tag ever shows up, the whole output is the reply (fallback).

    A holdback buffer (length of ``<actions>``) prevents the parser from
    accidentally streaming the start of that tag as user-visible text.
    """

    _HOLDBACK = len(ACTIONS_OPEN)

    def __init__(self) -> None:
        self._raw = ""              # everything we've seen, for finalize()
        self._buffer = ""           # pending pre-<actions> text
        self._actions_started = False

    # ------------------------------------------------------------------

    def feed(self, chunk: str) -> str:
        """Consume a chunk of raw model text and return the user-visible delta.

        Returns ``""`` while the buffer holds only characters that *might*
        be the start of ``<actions>``, or once the actions block has begun.
        """
        if not chunk:
            return ""
        self._raw += chunk
        if self._actions_started:
            # Past the delimiter; nothing more to emit.
            return ""

        self._buffer += chunk

        idx = self._buffer.find(ACTIONS_OPEN)
        if idx >= 0:
            # The actions block begins. Everything before it is the final
            # reply chunk — emit and switch state.
            delta = self._buffer[:idx]
            self._buffer = ""
            self._actions_started = True
            return _clean_delta(delta)

        # Hold back the last few chars in case <actions> is partially in
        # the buffer.
        if len(self._buffer) > self._HOLDBACK:
            emit = self._buffer[: -self._HOLDBACK]
            self._buffer = self._buffer[-self._HOLDBACK :]
            return _clean_delta(emit)
        return ""

    # ------------------------------------------------------------------

    def finalize(self) -> tuple[str, dict]:
        """Return ``(reply_text, actions_dict)`` after the stream ends.

        ``reply_text`` is the model's text up to (but excluding) the
        ``<actions>`` block, with any stray ``<reply>`` / ``</reply>`` tags
        stripped. If ``<actions>`` never appeared the whole output is the
        reply (fallback). ``actions_dict`` defaults to empty arrays when the
        block is missing or malformed.
        """
        raw = self._raw

        actions_idx = raw.find(ACTIONS_OPEN)
        reply_text = (raw[:actions_idx] if actions_idx >= 0 else raw)
        reply_text = (
            reply_text.replace(REPLY_OPEN, "").replace(REPLY_CLOSE, "").strip()
        )

        actions: dict = {"trades": [], "watchlist_changes": []}
        if actions_idx >= 0:
            inner_start = actions_idx + len(ACTIONS_OPEN)
            close_idx = raw.find(ACTIONS_CLOSE, inner_start)
            actions_blob = (
                raw[inner_start:close_idx] if close_idx >= 0 else raw[inner_start:]
            )
            try:
                parsed = json.loads(actions_blob.strip())
                if isinstance(parsed, dict):
                    actions = {
                        "trades": parsed.get("trades", []) or [],
                        "watchlist_changes": parsed.get("watchlist_changes", []) or [],
                    }
            except json.JSONDecodeError as exc:
                logger.warning(
                    "Failed to parse <actions> JSON; treating as empty. err=%s blob=%r",
                    exc,
                    actions_blob[:200],
                )

        return reply_text, actions


def _clean_delta(s: str) -> str:
    """Scrub a streaming delta of optional opening/closing reply tags and
    leading newlines so the user sees clean prose.

    Tags can appear anywhere in a chunk because the model's chunking is up
    to it — we strip them as plain substrings rather than trying to
    state-machine around them.
    """
    if not s:
        return s
    s = s.replace(REPLY_OPEN, "").replace(REPLY_CLOSE, "")
    return s.lstrip("\n\r")


# ---------------------------------------------------------------------------
# Streaming entry points
# ---------------------------------------------------------------------------


async def stream_llm(
    user_message: str,
    ctx: PortfolioContext,
    history: Iterable[object] = (),
    *,
    model: str = DEFAULT_MODEL,
) -> AsyncIterator[tuple[str, LLMResponse | None]]:
    """Top-level streaming dispatch: mock when ``LLM_MOCK=true``, else real.

    Yields ``(delta_text, payload)`` tuples. ``delta_text`` is the next chunk
    of user-visible reply text (possibly empty during the buffering phases).
    ``payload`` is non-None on the final yield only — it carries the
    ``LLMResponse`` (message + parsed trades/watchlist_changes) so the
    caller can run the executor.

    Raises ``LLMCallError`` on any failure of the real path. The mock path
    never fails.
    """
    if _is_mock_enabled():
        async for item in _stream_mock(user_message):
            yield item
        return
    async for item in _stream_real(user_message, ctx, history, model=model):
        yield item


async def _stream_mock(user_message: str) -> AsyncIterator[tuple[str, LLMResponse | None]]:
    """Stream a deterministic mock response in two ticks.

    Emits the full mock message as a single delta, then a final tuple with
    the parsed ``LLMResponse`` carrying any deterministic trades/watchlist
    changes from the §9 dispatch table.
    """
    response = mock_llm(user_message)
    yield (response.message, None)
    yield ("", response)


async def _stream_real(
    user_message: str,
    ctx: PortfolioContext,
    history: Iterable[object],
    *,
    model: str,
) -> AsyncIterator[tuple[str, LLMResponse | None]]:
    """Stream the tagged-format response from Anthropic via LiteLLM."""
    try:
        from litellm import acompletion
    except ImportError as exc:  # pragma: no cover - dependency declared in pyproject
        raise LLMCallError(f"LiteLLM not installed: {exc}") from exc

    messages = build_messages(ctx, history, user_message)
    parser = TaggedStreamParser()

    try:
        stream = await acompletion(
            model=model,
            messages=messages,
            stream=True,
            max_tokens=MAX_OUTPUT_TOKENS,
            timeout=COMPLETION_TIMEOUT_SECONDS,
            num_retries=NUM_RETRIES,
        )
    except Exception as exc:
        logger.exception("LiteLLM completion failed to start")
        raise LLMCallError(f"LLM completion failed: {exc}") from exc

    try:
        async for chunk in stream:
            text = _extract_chunk_text(chunk)
            if not text:
                continue
            delta = parser.feed(text)
            if delta:
                yield (delta, None)
    except Exception as exc:
        logger.exception("LiteLLM stream errored mid-flight")
        raise LLMCallError(f"LLM stream failed: {exc}") from exc

    reply_text, actions_dict = parser.finalize()
    try:
        payload = LLMResponse.model_validate(
            {
                "message": reply_text,
                "trades": actions_dict.get("trades", []),
                "watchlist_changes": actions_dict.get("watchlist_changes", []),
            }
        )
    except Exception as exc:
        # Last-ditch fallback: keep the user's text, drop the actions.
        logger.warning("Failed to validate parsed LLM payload: %s", exc)
        payload = LLMResponse(
            message=reply_text or "(no reply)",
            trades=[],
            watchlist_changes=[],
        )

    yield ("", payload)


def _extract_chunk_text(chunk: object) -> str:
    """Pull the content delta out of a LiteLLM streaming chunk.

    LiteLLM yields ``ModelResponse``-like objects with ``choices[0].delta``;
    the delta has either ``content`` (plain text) or ``tool_calls`` (we
    don't request structured output anymore, so this should never fire).
    """
    try:
        choices = chunk.choices  # type: ignore[attr-defined]
    except AttributeError:
        return ""
    if not choices:
        return ""
    delta = getattr(choices[0], "delta", None)
    if delta is None:
        return ""
    text = getattr(delta, "content", None)
    return text if isinstance(text, str) else ""


__all__ = [
    "DEFAULT_MODEL",
    "LLMCallError",
    "TaggedStreamParser",
    "stream_llm",
]
