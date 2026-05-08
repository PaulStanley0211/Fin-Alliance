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
    """TestClient that runs the lifespan."""
    with TestClient(app) as c:
        yield c
