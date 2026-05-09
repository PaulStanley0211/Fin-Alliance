"""Tests for the auth endpoints and session enforcement.

Note: the conftest's default ``client`` fixture pre-signs-up a "testuser".
These tests need to assert behavior on a *fresh* unauthenticated session
(signup conflict, login, 401 enforcement), so they use the
``unauthed_client`` fixture instead.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

# --------------------------------------------------------------------------
# Signup
# --------------------------------------------------------------------------


class TestSignup:
    def test_signup_creates_user_and_session(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.post(
            "/api/auth/signup", json={"username": "alice", "password": "supersecret"}
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["username"] == "alice"
        assert isinstance(body["id"], str) and body["id"]
        # Cookie was set so a follow-up call to /me succeeds.
        me = unauthed_client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["username"] == "alice"

    def test_signup_seeds_portfolio_with_10k(
        self, unauthed_client: TestClient
    ) -> None:
        unauthed_client.post(
            "/api/auth/signup", json={"username": "bob", "password": "supersecret"}
        )
        portfolio = unauthed_client.get("/api/portfolio")
        assert portfolio.status_code == 200
        body = portfolio.json()
        assert body["cash_balance"] == 10_000.0
        assert body["positions"] == []
        assert body["total_value"] == 10_000.0

    def test_signup_seeds_anchor_snapshot(self, unauthed_client: TestClient) -> None:
        unauthed_client.post(
            "/api/auth/signup", json={"username": "carol", "password": "supersecret"}
        )
        history = unauthed_client.get("/api/portfolio/history?range=all")
        assert history.status_code == 200
        # Initial anchor snapshot ($10k) should be present so the chart isn't blank.
        snapshots = history.json()["snapshots"]
        assert len(snapshots) >= 1
        assert snapshots[0]["total_value"] == 10_000.0

    def test_username_taken_returns_409(self, unauthed_client: TestClient) -> None:
        first = unauthed_client.post(
            "/api/auth/signup", json={"username": "dup", "password": "supersecret"}
        )
        assert first.status_code == 201
        # Drop session so the second call doesn't piggyback on the first.
        unauthed_client.cookies.clear()
        second = unauthed_client.post(
            "/api/auth/signup", json={"username": "dup", "password": "different1"}
        )
        assert second.status_code == 409
        assert second.json()["error"] == "username_taken"

    def test_invalid_username_chars_rejected(
        self, unauthed_client: TestClient
    ) -> None:
        resp = unauthed_client.post(
            "/api/auth/signup",
            json={"username": "has spaces", "password": "supersecret"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_request"

    def test_short_password_rejected(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.post(
            "/api/auth/signup", json={"username": "shortpw", "password": "abc"}
        )
        assert resp.status_code == 400


# --------------------------------------------------------------------------
# Login / logout / me
# --------------------------------------------------------------------------


class TestLogin:
    def test_login_with_correct_password_succeeds(
        self, unauthed_client: TestClient
    ) -> None:
        unauthed_client.post(
            "/api/auth/signup", json={"username": "eve", "password": "supersecret"}
        )
        unauthed_client.cookies.clear()
        resp = unauthed_client.post(
            "/api/auth/login", json={"username": "eve", "password": "supersecret"}
        )
        assert resp.status_code == 200
        assert resp.json()["username"] == "eve"
        # Session is set on the client now.
        me = unauthed_client.get("/api/auth/me")
        assert me.status_code == 200

    def test_wrong_password_returns_invalid_credentials(
        self, unauthed_client: TestClient
    ) -> None:
        unauthed_client.post(
            "/api/auth/signup", json={"username": "frank", "password": "supersecret"}
        )
        unauthed_client.cookies.clear()
        resp = unauthed_client.post(
            "/api/auth/login",
            json={"username": "frank", "password": "wrongguess"},
        )
        assert resp.status_code == 401
        assert resp.json()["error"] == "invalid_credentials"

    def test_unknown_user_returns_invalid_credentials(
        self, unauthed_client: TestClient
    ) -> None:
        # Same response shape as wrong-password so we don't leak existence.
        resp = unauthed_client.post(
            "/api/auth/login",
            json={"username": "ghost", "password": "doesntmatter"},
        )
        assert resp.status_code == 401
        assert resp.json()["error"] == "invalid_credentials"


class TestLogout:
    def test_logout_clears_session(self, unauthed_client: TestClient) -> None:
        unauthed_client.post(
            "/api/auth/signup", json={"username": "harry", "password": "supersecret"}
        )
        # Authenticated.
        assert unauthed_client.get("/api/auth/me").status_code == 200
        # Log out.
        out = unauthed_client.post("/api/auth/logout")
        assert out.status_code == 204
        # Session gone.
        assert unauthed_client.get("/api/auth/me").status_code == 401

    def test_logout_when_not_logged_in_is_noop(
        self, unauthed_client: TestClient
    ) -> None:
        # Logout should be idempotent — no error when there's no session.
        resp = unauthed_client.post("/api/auth/logout")
        assert resp.status_code == 204


class TestMe:
    def test_me_returns_401_when_unauthenticated(
        self, unauthed_client: TestClient
    ) -> None:
        resp = unauthed_client.get("/api/auth/me")
        assert resp.status_code == 401
        assert resp.json()["error"] == "not_authenticated"


# --------------------------------------------------------------------------
# Protected endpoint enforcement
# --------------------------------------------------------------------------


class TestProtectedEndpoints:
    """Every endpoint that touches per-user state must 401 without a session."""

    def test_get_portfolio_requires_auth(
        self, unauthed_client: TestClient
    ) -> None:
        resp = unauthed_client.get("/api/portfolio")
        assert resp.status_code == 401

    def test_post_trade_requires_auth(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.post(
            "/api/portfolio/trade",
            json={"ticker": "AAPL", "quantity": 1, "side": "buy"},
        )
        assert resp.status_code == 401

    def test_history_requires_auth(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get("/api/portfolio/history")
        assert resp.status_code == 401

    def test_chat_requires_auth(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.post("/api/chat", json={"message": "hi"})
        assert resp.status_code == 401


class TestPublicEndpoints:
    """Health, sectors, and the SSE price stream stay public."""

    def test_health_no_auth(self, unauthed_client: TestClient) -> None:
        assert unauthed_client.get("/api/health").status_code == 200

    def test_sectors_no_auth(self, unauthed_client: TestClient) -> None:
        assert unauthed_client.get("/api/sectors").status_code == 200


# --------------------------------------------------------------------------
# Per-user isolation — two accounts can't see each other's data
# --------------------------------------------------------------------------


class TestPerUserIsolation:
    def test_two_users_have_independent_portfolios(
        self, unauthed_client: TestClient, app
    ) -> None:
        from app.state import get_state

        # User A signs up + buys 5 AAPL.
        unauthed_client.post(
            "/api/auth/signup",
            json={"username": "alpha", "password": "supersecret"},
        )
        # Seed a price so the trade can fill.
        cache = get_state().price_cache
        assert cache is not None
        cache.update("AAPL", 100.0)
        a_trade = unauthed_client.post(
            "/api/portfolio/trade",
            json={"ticker": "AAPL", "quantity": 5, "side": "buy"},
        )
        assert a_trade.status_code == 200, a_trade.text
        a_portfolio = unauthed_client.get("/api/portfolio").json()
        assert a_portfolio["cash_balance"] == 9500.0
        assert any(p["ticker"] == "AAPL" for p in a_portfolio["positions"])

        # User B signs up in a separate TestClient (separate cookie jar).
        with TestClient(app) as client_b:
            client_b.post(
                "/api/auth/signup",
                json={"username": "beta", "password": "supersecret"},
            )
            b_portfolio = client_b.get("/api/portfolio").json()
            # Beta sees a fresh $10k portfolio with no positions.
            assert b_portfolio["cash_balance"] == 10_000.0
            assert b_portfolio["positions"] == []
