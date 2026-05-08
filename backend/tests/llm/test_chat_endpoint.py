"""Tests for POST /api/chat — full pipeline with mock LLM.

These exercise the same wiring as production: the FastAPI lifespan runs,
the simulator + snapshot writer + SSE router are mounted, and a fresh DB is
seeded. `LLM_MOCK=true` is forced by an autouse fixture, so the deterministic
mock dispatch from PLAN.md §9 drives the LLM responses.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.db import recent_chat_messages
from app.db.connection import connect


def _post_chat(client: TestClient, message: str) -> dict[str, Any]:
    resp = client.post("/api/chat", json={"message": message})
    assert resp.status_code == 200, resp.text
    return resp.json()


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


class TestWatchlistChanges:
    def test_watch_adds_ticker(self, client: TestClient) -> None:
        body = _post_chat(client, "watch PYPL")
        assert body["message"] == "Added PYPL to your watchlist."
        assert len(body["executed_watchlist_changes"]) == 1
        change = body["executed_watchlist_changes"][0]
        assert change == {
            "ticker": "PYPL",
            "action": "add",
            "status": "executed",
            "error": None,
        }
        wl = client.get("/api/watchlist").json()
        assert any(t["ticker"] == "PYPL" for t in wl["tickers"])

    def test_unwatch_removes_ticker(self, client: TestClient) -> None:
        # AAPL is on the default watchlist already
        body = _post_chat(client, "unwatch AAPL")
        change = body["executed_watchlist_changes"][0]
        assert change["status"] == "executed"
        assert change["ticker"] == "AAPL"
        assert change["action"] == "remove"
        wl = client.get("/api/watchlist").json()
        assert not any(t["ticker"] == "AAPL" for t in wl["tickers"])

    def test_remove_keyword(self, client: TestClient) -> None:
        # "remove" is the alternative form per PLAN.md §9
        body = _post_chat(client, "remove GOOGL")
        change = body["executed_watchlist_changes"][0]
        assert change["status"] == "executed"
        assert change["action"] == "remove"

    def test_watch_unsupported_ticker_rejected(self, client: TestClient) -> None:
        body = _post_chat(client, "watch ZZZZZ")
        change = body["executed_watchlist_changes"][0]
        assert change["status"] == "rejected"
        assert change["error"] == "ticker_unsupported"


# --------------------------------------------------------------------------
# Persistence — chat_messages table
# --------------------------------------------------------------------------


class TestChatPersistence:
    def test_user_and_assistant_persisted(self, client: TestClient) -> None:
        _post_chat(client, "hi")
        with connect() as conn:
            rows = recent_chat_messages(conn)
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

    def test_actions_shape_for_trade(self, client: TestClient, seed_price) -> None:
        seed_price("AAPL", 100.0)
        _post_chat(client, "buy 1 AAPL")
        with connect() as conn:
            rows = recent_chat_messages(conn)
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

    def test_history_carries_into_subsequent_call(self, client: TestClient) -> None:
        _post_chat(client, "first")
        _post_chat(client, "second")
        with connect() as conn:
            rows = recent_chat_messages(conn)
        # 4 messages total; oldest-first.
        assert len(rows) == 4
        assert rows[0]["content"] == "first"
        assert rows[2]["content"] == "second"


# --------------------------------------------------------------------------
# Fallback path on LLM failure
# --------------------------------------------------------------------------


class TestLLMFallback:
    def test_llm_call_failure_returns_error_envelope(
        self, client: TestClient, monkeypatch
    ) -> None:
        # Disable mock mode and patch real_llm to always blow up.
        monkeypatch.setenv("LLM_MOCK", "false")

        def boom(*_args, **_kwargs):
            from app.llm.client import LLMCallError

            raise LLMCallError("simulated network failure")

        # Patch where chat.py looks it up.
        monkeypatch.setattr("app.llm.chat.call_llm", boom)

        resp = client.post("/api/chat", json={"message": "hello"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["error"] == "llm_call_failed"
        assert body["executed_trades"] == []
        assert body["executed_watchlist_changes"] == []
        assert "couldn" in body["message"].lower() or "sorry" in body["message"].lower()

        # User + fallback-assistant still persisted so the chat log is consistent.
        with connect() as conn:
            rows = recent_chat_messages(conn)
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
