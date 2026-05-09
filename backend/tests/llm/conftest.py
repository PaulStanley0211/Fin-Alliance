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
    with TestClient(app) as c:
        yield c


@pytest.fixture
def seed_price(client: TestClient):  # noqa: ARG001 — depends to ensure lifespan ran
    """Helper that seeds a price into the live cache so trades can fill."""

    def _seed(ticker: str, price: float) -> None:
        cache = get_state().price_cache
        assert cache is not None, "price cache should be live during the test"
        cache.update(ticker=ticker, price=price)

    return _seed
