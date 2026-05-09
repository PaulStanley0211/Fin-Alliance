"""LiteLLM client for FinAlly's chat assistant.

Defaults to ``anthropic/claude-haiku-4-5`` (PLAN.md §9). LiteLLM picks up the
``ANTHROPIC_API_KEY`` env var automatically.

Two entry points:

- ``call_llm(user_message, ctx, history)`` — top-level dispatch. Async.
  Returns an ``LLMResponse`` either by routing to ``mock_llm`` when
  ``LLM_MOCK=true`` or by calling Anthropic via LiteLLM's async API.
- ``real_llm(...)`` — async pure-Anthropic path; exposed mainly for testing
  with mocks.

Latency notes (why this file looks the way it does):

- We use ``litellm.acompletion`` so the call doesn't block the FastAPI event
  loop, and so concurrent SSE clients aren't paused while we wait on
  Anthropic.
- ``max_tokens`` is capped to keep the worst-case response time bounded —
  Haiku 4.5 generates at ~100-150 tokens/s, so an uncapped run-on answer
  alone can dominate latency.
- Prompt caching is wired up in ``prompt.build_messages`` (the static
  instructions block is marked ``cache_control: ephemeral``).
- ``num_retries=2`` covers transient 5xx / network blips without amplifying
  the user-visible delay much (LiteLLM uses exponential backoff).

On any failure (network, parse, anything raised inside LiteLLM) we raise
``LLMCallError``. The /api/chat router catches it and returns a fallback
envelope (PLAN.md §9 wire format ``error`` field).
"""

from __future__ import annotations

import logging
import os
from typing import Iterable

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


class LLMCallError(RuntimeError):
    """Raised when the LLM call or structured-output parse fails."""


def _is_mock_enabled() -> bool:
    return os.environ.get("LLM_MOCK", "").strip().lower() == "true"


async def call_llm(
    user_message: str,
    ctx: PortfolioContext,
    history: Iterable[object] = (),
    *,
    model: str = DEFAULT_MODEL,
) -> LLMResponse:
    """Top-level dispatch: mock if LLM_MOCK=true, else real LiteLLM call.

    Raises LLMCallError on failure of the real path. The mock path never
    fails — it always returns a deterministic response.
    """
    if _is_mock_enabled():
        return mock_llm(user_message)
    return await real_llm(user_message, ctx, history, model=model)


async def real_llm(
    user_message: str,
    ctx: PortfolioContext,
    history: Iterable[object] = (),
    *,
    model: str = DEFAULT_MODEL,
) -> LLMResponse:
    """Call Anthropic via LiteLLM with structured output.

    Imports LiteLLM lazily so unit tests in mock mode don't pay the import cost
    and so missing-key failures surface only when the real path is exercised.
    """
    try:
        from litellm import acompletion
    except ImportError as exc:  # pragma: no cover - dependency declared in pyproject
        raise LLMCallError(f"LiteLLM not installed: {exc}") from exc

    messages = build_messages(ctx, history, user_message)

    try:
        response = await acompletion(
            model=model,
            messages=messages,
            response_format=LLMResponse,
            max_tokens=MAX_OUTPUT_TOKENS,
            timeout=COMPLETION_TIMEOUT_SECONDS,
            num_retries=NUM_RETRIES,
        )
    except Exception as exc:
        logger.exception("LiteLLM completion failed")
        raise LLMCallError(f"LLM completion failed: {exc}") from exc

    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, KeyError) as exc:
        raise LLMCallError(f"Unexpected LiteLLM response shape: {exc}") from exc

    if not content:
        raise LLMCallError("LLM returned empty content")

    try:
        return LLMResponse.model_validate_json(content)
    except Exception as exc:
        logger.warning("Failed to parse structured LLM output: %s", content[:200])
        raise LLMCallError(f"Failed to parse LLM JSON: {exc}") from exc
