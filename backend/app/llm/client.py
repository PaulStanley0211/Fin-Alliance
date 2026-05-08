"""LiteLLM client for FinAlly's chat assistant.

Defaults to ``anthropic/claude-haiku-4-5`` (PLAN.md §9). LiteLLM picks up the
``ANTHROPIC_API_KEY`` env var automatically.

Two entry points:

- ``call_llm(user_message, ctx, history)`` — top-level dispatch. Returns an
  ``LLMResponse`` either by routing to ``mock_llm`` when ``LLM_MOCK=true`` or
  by calling Anthropic.
- ``real_llm(...)`` — pure Anthropic path; exposed mainly for testing with
  mocks.

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


class LLMCallError(RuntimeError):
    """Raised when the LLM call or structured-output parse fails."""


def _is_mock_enabled() -> bool:
    return os.environ.get("LLM_MOCK", "").strip().lower() == "true"


def call_llm(
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
    return real_llm(user_message, ctx, history, model=model)


def real_llm(
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
        from litellm import completion
    except ImportError as exc:  # pragma: no cover - dependency declared in pyproject
        raise LLMCallError(f"LiteLLM not installed: {exc}") from exc

    messages = build_messages(ctx, history, user_message)

    try:
        response = completion(
            model=model,
            messages=messages,
            response_format=LLMResponse,
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
