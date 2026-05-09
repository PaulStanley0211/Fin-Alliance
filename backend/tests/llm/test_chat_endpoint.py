"""Tests for POST /api/chat — full pipeline with mock LLM, streaming SSE.

These exercise the same wiring as production: the FastAPI lifespan runs,
the simulator + snapshot writer + SSE router are mounted, and a fresh DB is
seeded. `LLM_MOCK=true` is forced by an autouse fixture, so the deterministic
mock dispatch from PLAN.md §9 drives the LLM responses.

The chat path emits a `text/event-stream` response with three event types:
``delta`` (incremental reply text), ``done`` (final action envelope), and
``error`` (fallback path). The ``_post_chat`` helper consumes the stream
and reconstructs an envelope shape compatible with the pre-streaming
contract so most assertions stay readable.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient

from app.db import recent_chat_messages
from app.db.connection import connect


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    """Parse a complete SSE response body into ``(event_name, data_dict)``.

    Uses the minimal subset of the SSE spec we actually emit: each event is
    a ``event: NAME`` line followed by ``data: JSON``, separated by a blank
    line. Comments / retry directives are not produced by the chat path.
    """
    events: list[tuple[str, dict]] = []
    for raw_block in body.split("\n\n"):
        block = raw_block.strip()
        if not block:
            continue
        event_name = "message"
        data_lines: list[str] = []
        for line in block.split("\n"):
            if line.startswith("event:"):
                event_name = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
        if not data_lines:
            continue
        try:
            data = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            continue
        events.append((event_name, data))
    return events


def _envelope_from_events(events: list[tuple[str, dict]]) -> dict[str, Any]:
    """Reduce a list of SSE events into the legacy ``ChatResponseEnvelope``
    shape so existing assertions stay terse.

    The reconstructed envelope has: ``message`` (joined deltas), the two
    action arrays, and an ``error`` field (set if an ``error`` event was
    emitted instead of ``done``).
    """
    message_parts: list[str] = []
    executed_trades: list[dict] = []
    executed_watchlist: list[dict] = []
    error: str | None = None

    for name, data in events:
        if name == "delta":
            message_parts.append(data.get("text", ""))
        elif name == "done":
            executed_trades = data.get("executed_trades", [])
            executed_watchlist = data.get("executed_watchlist_changes", [])
            error = data.get("error")
        elif name == "error":
            # Only adopt the error value if `done` didn't already win.
            if error is None:
                error = data.get("error", "llm_call_failed")

    return {
        "message": "".join(message_parts),
        "executed_trades": executed_trades,
        "executed_watchlist_changes": executed_watchlist,
        "error": error,
    }


def _post_chat(client: TestClient, message: str) -> dict[str, Any]:
    resp = client.post("/api/chat", json={"message": message})
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("content-type", "").startswith("text/event-stream"), (
        f"unexpected content-type: {resp.headers.get('content-type')}"
    )
    events = _parse_sse(resp.text)
    return _envelope_from_events(events)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


class TestRequestValidation:
    def test_empty_message_rejected(self, client: TestClient) -> None:
        resp = client.post("/api/chat", json={"message": ""})
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_request"

    def test_missing_message_rejected(self, client: TestClient) -> None:
        resp = client.post("/api/chat", json={})
        assert resp.status_code == 400


# --------------------------------------------------------------------------
# SSE wire format
# --------------------------------------------------------------------------


class TestSseShape:
    def test_emits_delta_then_done(self, client: TestClient) -> None:
        resp = client.post("/api/chat", json={"message": "hi"})
        assert resp.status_code == 200
        events = _parse_sse(resp.text)
        names = [n for n, _ in events]
        # At least one delta, then exactly one terminal done.
        assert names[-1] == "done"
        assert "delta" in names
        # Done payload has the three §9 outcome fields.
        done_payload = [d for n, d in events if n == "done"][-1]
        assert set(done_payload.keys()) == {
            "executed_trades",
            "executed_watchlist_changes",
            "error",
        }


# --------------------------------------------------------------------------
# Mock-mode envelope shape
# --------------------------------------------------------------------------


class TestEnvelopeShape:
    def test_greeting_returns_envelope(self, client: TestClient) -> None:
        body = _post_chat(client, "hi")
        assert body["message"] == "Hi, I'm FinAlly. Ask me about your portfolio."
        assert body["executed_trades"] == []
        assert body["executed_watchlist_changes"] == []
        assert body["error"] is None

    def test_fallthrough_branch_renders_message(self, client: TestClient) -> None:
        body = _post_chat(client, "what should I do")
        assert "Mock response" in body["message"]
        assert body["executed_trades"] == []
        assert body["executed_watchlist_changes"] == []

    def test_envelope_keys_match_spec(self, client: TestClient) -> None:
        body = _post_chat(client, "hi")
        assert set(body.keys()) == {
            "message",
            "executed_trades",
            "executed_watchlist_changes",
            "error",
        }


# --------------------------------------------------------------------------
# Trade execution paths via the mock dispatch
# --------------------------------------------------------------------------


class TestTradeExecution:
    def test_buy_executes(self, client: TestClient, seed_price) -> None:
        seed_price("AAPL", 200.0)
        body = _post_chat(client, "buy 5 AAPL")
        assert body["message"] == "Buying 5 AAPL."
        assert len(body["executed_trades"]) == 1
        t = body["executed_trades"][0]
        assert t == {
            "ticker": "AAPL",
            "side": "buy",
            "quantity": 5,
            "status": "executed",
            "price": 200.0,
            "error": None,
        }
        # Side-effect: cash decreased, position created.
        portfolio = client.get("/api/portfolio").json()
        assert portfolio["cash_balance"] == 9000.0
        assert any(p["ticker"] == "AAPL" for p in portfolio["positions"])

    def test_buy_insufficient_cash_rejected(
        self, client: TestClient, seed_price
    ) -> None:
        seed_price("AAPL", 200.0)
        body = _post_chat(client, "buy 100 AAPL")  # $20k > $10k cash
        t = body["executed_trades"][0]
        assert t["status"] == "rejected"
        assert t["error"] == "insufficient_cash"
        assert t["price"] is None

    def test_sell_without_position_rejected(
        self, client: TestClient, seed_price
    ) -> None:
        seed_price("AAPL", 200.0)
        body = _post_chat(client, "sell 1 AAPL")
        t = body["executed_trades"][0]
        assert t["status"] == "rejected"
        assert t["error"] == "insufficient_shares"

    def test_buy_unsupported_ticker_rejected(
        self, client: TestClient, seed_price
    ) -> None:
        # ZZZZZ is not in the simulator allowlist (and we're not on Massive).
        body = _post_chat(client, "buy 1 ZZZZZ")
        t = body["executed_trades"][0]
        assert t["status"] == "rejected"
        assert t["error"] == "ticker_unsupported"


# --------------------------------------------------------------------------
# Watchlist changes
# --------------------------------------------------------------------------


_WATCHLIST_DISABLED_MSG = (
    "Watchlist actions are disabled now that all sectors stream by default."
)


class TestWatchlistChanges:
    """Spec §6 — watchlist removed. The mock still emits watchlist
    actions through the model -> executor pipeline; the executor
    short-circuits all of them with `watchlist_disabled`."""

    def test_watch_rejected(self, client: TestClient) -> None:
        body = _post_chat(client, "watch PYPL")
        assert body["message"] == _WATCHLIST_DISABLED_MSG
        assert len(body["executed_watchlist_changes"]) == 1
        change = body["executed_watchlist_changes"][0]
        assert change == {
            "ticker": "PYPL",
            "action": "add",
            "status": "rejected",
            "error": "watchlist_disabled",
        }

    def test_unwatch_rejected(self, client: TestClient) -> None:
        body = _post_chat(client, "unwatch AAPL")
        change = body["executed_watchlist_changes"][0]
        assert change["status"] == "rejected"
        assert change["error"] == "watchlist_disabled"
        assert change["ticker"] == "AAPL"
        assert change["action"] == "remove"

    def test_remove_keyword_rejected(self, client: TestClient) -> None:
        body = _post_chat(client, "remove GOOGL")
        change = body["executed_watchlist_changes"][0]
        assert change["status"] == "rejected"
        assert change["error"] == "watchlist_disabled"
        assert change["action"] == "remove"

    def test_watch_unsupported_ticker_still_watchlist_disabled(
        self, client: TestClient
    ) -> None:
        # We never reach ticker validation; the executor short-circuits
        # before that.
        body = _post_chat(client, "watch ZZZZZ")
        change = body["executed_watchlist_changes"][0]
        assert change["status"] == "rejected"
        assert change["error"] == "watchlist_disabled"


# --------------------------------------------------------------------------
# Persistence — chat_messages table
# --------------------------------------------------------------------------


class TestChatPersistence:
    def test_user_and_assistant_persisted(
        self, client: TestClient, authed_user_id: str
    ) -> None:
        _post_chat(client, "hi")
        with connect() as conn:
            rows = recent_chat_messages(conn, user_id=authed_user_id)
        # 1 user + 1 assistant
        assert len(rows) == 2
        assert rows[0]["role"] == "user"
        assert rows[0]["content"] == "hi"
        assert rows[0]["actions"] is None
        assert rows[1]["role"] == "assistant"
        assert rows[1]["content"].startswith("Hi, I'm FinAlly")
        # Assistant `actions` mirrors the wire envelope (minus message).
        actions = rows[1]["actions"]
        assert actions is not None
        assert actions["executed_trades"] == []
        assert actions["executed_watchlist_changes"] == []
        assert actions["error"] is None

    def test_actions_shape_for_trade(
        self, client: TestClient, seed_price, authed_user_id: str
    ) -> None:
        seed_price("AAPL", 100.0)
        _post_chat(client, "buy 1 AAPL")
        with connect() as conn:
            rows = recent_chat_messages(conn, user_id=authed_user_id)
        actions = rows[-1]["actions"]
        assert actions is not None
        assert len(actions["executed_trades"]) == 1
        et = actions["executed_trades"][0]
        # Per-action persistence shape matches the §9 envelope.
        assert set(et.keys()) == {
            "ticker",
            "side",
            "quantity",
            "status",
            "price",
            "error",
        }
        assert et["status"] == "executed"

    def test_history_carries_into_subsequent_call(
        self, client: TestClient, authed_user_id: str
    ) -> None:
        _post_chat(client, "first")
        _post_chat(client, "second")
        with connect() as conn:
            rows = recent_chat_messages(conn, user_id=authed_user_id)
        # 4 messages total; oldest-first.
        assert len(rows) == 4
        assert rows[0]["content"] == "first"
        assert rows[2]["content"] == "second"


# --------------------------------------------------------------------------
# Fallback path on LLM failure
# --------------------------------------------------------------------------


class TestLLMFallback:
    def test_llm_call_failure_returns_error_event(
        self, client: TestClient, monkeypatch, authed_user_id: str
    ) -> None:
        """When stream_llm raises LLMCallError, the endpoint emits an
        `error` event and persists a fallback assistant turn."""
        monkeypatch.setenv("LLM_MOCK", "false")

        async def boom(*_args, **_kwargs):
            from app.llm.client import LLMCallError

            # Async generators must yield-or-raise; raising before any yield
            # surfaces from the first `__anext__` call inside the endpoint.
            raise LLMCallError("simulated network failure")
            yield  # pragma: no cover - keeps this an async generator

        # Patch where chat.py looks it up.
        monkeypatch.setattr("app.llm.chat.stream_llm", boom)

        resp = client.post("/api/chat", json={"message": "hello"})
        assert resp.status_code == 200
        events = _parse_sse(resp.text)
        names = [n for n, _ in events]
        assert "error" in names
        envelope = _envelope_from_events(events)
        assert envelope["error"] == "llm_call_failed"
        assert envelope["executed_trades"] == []
        assert envelope["executed_watchlist_changes"] == []
        assert (
            "couldn" in envelope["message"].lower()
            or "sorry" in envelope["message"].lower()
        )

        # User + fallback-assistant still persisted so the chat log is consistent.
        with connect() as conn:
            rows = recent_chat_messages(conn, user_id=authed_user_id)
        assert len(rows) == 2
        assert rows[0]["role"] == "user"
        assert rows[1]["role"] == "assistant"
        assert rows[1]["actions"]["error"] == "llm_call_failed"


# --------------------------------------------------------------------------
# Mounting smoke test
# --------------------------------------------------------------------------


class TestMounting:
    def test_chat_route_mounted_via_main(self, client: TestClient) -> None:
        # Sanity: POST should route to our handler, not 404.
        resp = client.post("/api/chat", json={"message": "hello"})
        assert resp.status_code == 200
