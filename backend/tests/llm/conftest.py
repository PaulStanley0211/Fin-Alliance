"""Fixtures shared by /api/chat, executor, and context tests.

Each test gets a fresh on-disk SQLite + a freshly-built FastAPI app whose
lifespan runs end-to-end (DB init, market simulator, snapshot writer, SSE
router). Tests run with `LLM_MOCK=true` by default so the chat path stays
deterministic.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import main as main_module
from app.state import get_state, reset_state_for_tests


@pytest.fixture(autouse=True)
def llm_mock_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force LLM_MOCK=true and isolate from real-data env keys for chat tests."""
    monkeypatch.setenv("LLM_MOCK", "true")
    # Tests run on the simulator path — keep real-data keys out of the env
    # so trade-validation routes hit the sector-allowlist branch.
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)


@pytest.fixture
def db_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated SQLite path per test."""
    target = tmp_path / "finally-test.db"
    monkeypatch.setenv("FINALLY_DB_PATH", str(target))
    return target


@pytest.fixture
def static_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Empty static dir so the StaticFiles mount succeeds."""
    d = tmp_path / "static"
    d.mkdir()
    (d / "index.html").write_text("<!doctype html><html><body>FinAlly</body></html>")
    monkeypatch.setattr(main_module, "STATIC_DIR", d)
    return d


@pytest.fixture
def app(db_file: Path, static_dir: Path) -> FastAPI:  # noqa: ARG001
    reset_state_for_tests()
    return main_module.create_app()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """TestClient that runs the lifespan AND signs up a default test user.

    Chat tests run as the authenticated test user so the chat endpoint's
    `current_user` dependency resolves and the per-user persistence /
    history queries scope to a known account.
    """
    with TestClient(app) as c:
        resp = c.post(
            "/api/auth/signup",
            json={"username": "testuser", "password": "testpass123"},
        )
        assert resp.status_code == 201, f"test signup failed: {resp.text}"
        yield c


@pytest.fixture
def authed_user_id(client: TestClient) -> str:
    """Resolve the test user's id from the session — useful when asserting
    against per-user repository rows in the DB."""
    me = client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    return me.json()["id"]


@pytest.fixture
def seed_price(client: TestClient):  # noqa: ARG001 — depends to ensure lifespan ran
    """Helper that seeds a price into the live cache so trades can fill."""

    def _seed(ticker: str, price: float) -> None:
        cache = get_state().price_cache
        assert cache is not None, "price cache should be live during the test"
        cache.update(ticker=ticker, price=price)

    return _seed
