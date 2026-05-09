"""Fixtures for API/HTTP tests.

Each test gets a fresh on-disk SQLite (via FINALLY_DB_PATH) and a TestClient
backed by a freshly-built FastAPI app. The lifespan runs end-to-end so the
market data source, snapshot writer, and SSE router are all live during the
test — exactly matching production wiring.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import main as main_module
from app.state import reset_state_for_tests


@pytest.fixture(autouse=True)
def isolate_real_data_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests run on the simulator path — strip real-data API keys."""
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)


@pytest.fixture
def db_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated SQLite path via FINALLY_DB_PATH."""
    target = tmp_path / "finally-test.db"
    monkeypatch.setenv("FINALLY_DB_PATH", str(target))
    return target


@pytest.fixture
def static_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Empty static dir so the StaticFiles mount succeeds in tests."""
    d = tmp_path / "static"
    d.mkdir()
    (d / "index.html").write_text("<!doctype html><html><body>FinAlly</body></html>")
    monkeypatch.setattr(main_module, "STATIC_DIR", d)
    return d


@pytest.fixture
def app(db_file: Path, static_dir: Path) -> FastAPI:  # noqa: ARG001
    """Fresh FastAPI app with reset global state."""
    reset_state_for_tests()
    return main_module.create_app()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """TestClient that runs the lifespan AND signs up a default test user.

    Most tests want to exercise authenticated endpoints; making the default
    fixture pre-authenticated keeps test bodies focused on behavior rather
    than auth setup. Tests that need to assert 401 responses can use
    ``unauthed_client`` instead.
    """
    with TestClient(app) as c:
        resp = c.post(
            "/api/auth/signup",
            json={"username": "testuser", "password": "testpass123"},
        )
        assert resp.status_code == 201, f"test signup failed: {resp.text}"
        yield c


@pytest.fixture
def unauthed_client(app: FastAPI) -> Iterator[TestClient]:
    """TestClient with the lifespan running but no session cookie set.

    Use when asserting that protected routes return 401 without auth.
    """
    with TestClient(app) as c:
        yield c
