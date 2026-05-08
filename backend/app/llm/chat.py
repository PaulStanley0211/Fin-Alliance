"""POST /api/chat — the LLM-backed chat endpoint.

Pipeline (PLAN.md §9):
  1. Validate body and load conversation history (oldest-first, capped 20).
  2. Build a `PortfolioContext` from DB + price cache.
  3. Call the LLM client (mock when LLM_MOCK=true).
  4. Execute LLM-emitted trades and watchlist changes via the executor.
  5. Persist user + assistant messages (assistant carries the action envelope).
  6. Return `{message, executed_trades[], executed_watchlist_changes[], error}`.

If the LLM call itself fails (network, parse error, etc.), we return a
fallback envelope with `error` set and empty action arrays. We still persist
both the user message and the fallback assistant message so the conversation
history stays consistent.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app.db import append_chat_message, recent_chat_messages
from app.db.connection import connect
from app.state import AppState, get_state

from .client import LLMCallError, call_llm
from .context import build_portfolio_context
from .executor import execute_actions
from .schemas import ChatResponseEnvelope

logger = logging.getLogger(__name__)

# Fallback message shown when the LLM call fails entirely. Kept short so the
# frontend can render it in the chat panel without truncation.
FALLBACK_MESSAGE = (
    "Sorry — I couldn't reach the assistant just now. Please try again in a moment."
)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    message: str = Field(..., min_length=1, max_length=4000)


@router.post("", response_model=ChatResponseEnvelope)
async def post_chat(
    body: ChatRequest,
    state: AppState = Depends(get_state),
) -> ChatResponseEnvelope:
    user_message = body.message

    # Load the most recent 20 turns oldest-first. Each item is
    # {role, content, actions, ...}; build_messages() keeps the role/content
    # only.
    with connect() as conn:
        history = recent_chat_messages(conn, limit=20)

    # Snapshot the portfolio for grounding the system prompt.
    ctx = build_portfolio_context(state.price_cache)

    # Persist the user message before calling the LLM. If the LLM call fails
    # the user's turn is still in the log, which makes retries / debugging
    # straightforward.
    with connect() as conn:
        append_chat_message(conn, role="user", content=user_message)

    # Call the LLM. On any failure, fall back gracefully — never crash the
    # request.
    try:
        llm_response = call_llm(user_message, ctx, history)
    except LLMCallError as exc:
        logger.warning("LLM call failed: %s", exc)
        envelope = ChatResponseEnvelope(
            message=FALLBACK_MESSAGE,
            executed_trades=[],
            executed_watchlist_changes=[],
            error="llm_call_failed",
        )
        # Persist the fallback assistant message so the chat log stays in sync.
        with connect() as conn:
            append_chat_message(
                conn,
                role="assistant",
                content=envelope.message,
                actions=envelope.model_dump(exclude={"message"}),
            )
        return envelope

    # Auto-execute any actions the LLM emitted. Each action is independent —
    # rejections do not abort the others.
    executed_trades, executed_watchlist = await execute_actions(llm_response, state)

    envelope = ChatResponseEnvelope(
        message=llm_response.message,
        executed_trades=executed_trades,
        executed_watchlist_changes=executed_watchlist,
        error=None,
    )

    # Persist the assistant message with the *outcome* envelope (minus the
    # message text itself) so chat_messages.actions matches PLAN.md §7.
    with connect() as conn:
        append_chat_message(
            conn,
            role="assistant",
            content=envelope.message,
            actions=envelope.model_dump(exclude={"message"}),
        )

    return envelope
