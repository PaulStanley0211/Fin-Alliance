"""POST /api/chat — the LLM-backed chat endpoint, streaming edition.

The response is `text/event-stream`. The frontend opens a fetch + ReadableStream
and consumes three event types:

- ``event: delta`` — ``data: {"text": "..."}`` — incremental reply text. Many
  of these arrive between the request and ``done``; the frontend appends each
  to the assistant bubble as it lands.
- ``event: done`` — ``data: {"executed_trades": [...], "executed_watchlist_changes": [...], "error": null}``
  — final outcome envelope. Sent exactly once, at the end of a successful turn.
- ``event: error`` — ``data: {"message": "...", "error": "llm_call_failed"}``
  — sent instead of ``done`` if the LLM call itself failed. Fallback text plus
  an error code so the frontend can render the same error chip as before.

Pipeline (PLAN.md §9):

  1. Validate body and load conversation history (oldest-first, capped 20).
     Validation errors return a regular JSON 400 — no streaming kicks in
     until we know the request is well-formed.
  2. Persist the user message (so it shows up in history even if streaming
     fails partway through).
  3. Build a `PortfolioContext` from DB + price cache.
  4. Stream the LLM reply, forwarding `delta` events to the client.
  5. On the final yield (carrying the parsed `LLMResponse`), run the
     executor for any trades / watchlist changes the model emitted.
  6. Persist the assistant message with the executed-action envelope and
     emit ``event: done``.

If the LLM call fails (network, parse, etc.) we emit ``event: error`` with
a fallback message and persist that as the assistant turn so the
conversation history stays consistent.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user
from app.db import append_chat_message, recent_chat_messages
from app.db.connection import connect
from app.state import AppState, get_state

from .client import LLMCallError, stream_llm
from .context import build_portfolio_context
from .executor import execute_actions
from .schemas import ChatResponseEnvelope, LLMResponse

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


@router.post("")
async def post_chat(
    body: ChatRequest,
    state: AppState = Depends(get_state),
    auth_user: dict = Depends(current_user),
) -> StreamingResponse:
    return StreamingResponse(
        _chat_event_stream(body.message, state, user_id=auth_user["id"]),
        media_type="text/event-stream",
        # Disable proxy buffering so chunks don't pile up in front of the client.
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# SSE event-stream generator
# ---------------------------------------------------------------------------


async def _chat_event_stream(
    user_message: str,
    state: AppState,
    *,
    user_id: str,
) -> AsyncIterator[bytes]:
    """Yield raw SSE event bytes covering one chat turn.

    Every yield is a complete event (``event: <name>\\ndata: <json>\\n\\n``)
    so middleboxes can flush them line-buffered.
    """
    # Step 1 — load history (cap 20 most recent, oldest-first).
    with connect() as conn:
        history = recent_chat_messages(conn, limit=20, user_id=user_id)

    # Step 2 — snapshot portfolio state for grounding.
    ctx = build_portfolio_context(state.price_cache, user_id=user_id)

    # Step 3 — persist the user message *before* the model call. If the call
    # explodes mid-flight, the user's turn is still in the history.
    with connect() as conn:
        append_chat_message(conn, role="user", content=user_message, user_id=user_id)

    # Step 4 — drive the streaming LLM call.
    final_payload: LLMResponse | None = None
    streamed_any_text = False

    try:
        async for delta, payload in stream_llm(user_message, ctx, history):
            if delta:
                streamed_any_text = True
                yield _sse_event("delta", {"text": delta})
            if payload is not None:
                final_payload = payload
    except LLMCallError as exc:
        logger.warning("LLM call failed: %s", exc)
        # Emit a fallback message as a delta so the assistant bubble has
        # *something* visible (browsers that swallowed the `error` event
        # still get a readable bubble), then the explicit `error` event so
        # the panel can render the red chip.
        if not streamed_any_text:
            yield _sse_event("delta", {"text": FALLBACK_MESSAGE})
        yield _sse_event(
            "error",
            {"message": FALLBACK_MESSAGE, "error": "llm_call_failed"},
        )
        # Persist the fallback assistant turn for chat-history continuity.
        envelope = ChatResponseEnvelope(
            message=FALLBACK_MESSAGE,
            executed_trades=[],
            executed_watchlist_changes=[],
            error="llm_call_failed",
        )
        with connect() as conn:
            append_chat_message(
                conn,
                role="assistant",
                content=envelope.message,
                actions=envelope.model_dump(exclude={"message"}),
                user_id=user_id,
            )
        return

    # Step 5 — execute actions from the parsed payload.
    if final_payload is None:
        # The stream ended without ever yielding a final payload (shouldn't
        # happen with a well-behaved generator, but treat it as an error).
        logger.error("LLM stream ended without a final payload")
        yield _sse_event(
            "error",
            {"message": FALLBACK_MESSAGE, "error": "llm_call_failed"},
        )
        return

    executed_trades, executed_watchlist = await execute_actions(
        final_payload, state, user_id=user_id
    )

    envelope = ChatResponseEnvelope(
        message=final_payload.message,
        executed_trades=executed_trades,
        executed_watchlist_changes=executed_watchlist,
        error=None,
    )

    # Step 6 — persist the assistant turn, then emit `done`.
    with connect() as conn:
        append_chat_message(
            conn,
            role="assistant",
            content=envelope.message,
            actions=envelope.model_dump(exclude={"message"}),
            user_id=user_id,
        )

    yield _sse_event(
        "done",
        {
            "executed_trades": [t.model_dump() for t in executed_trades],
            "executed_watchlist_changes": [w.model_dump() for w in executed_watchlist],
            "error": None,
        },
    )


def _sse_event(event_name: str, data: dict) -> bytes:
    """Format one SSE frame as bytes.

    Lines are separated by ``\\n`` and each event is terminated by a blank
    line per the SSE wire spec.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_name}\ndata: {payload}\n\n".encode("utf-8")
