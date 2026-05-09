"""Tests for GET /api/health."""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.state import get_state


def test_health_returns_ok_with_warming(client: TestClient) -> None:
    """At very fresh start the market data may still be warming; that's healthy."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["db"] == "ready"
    assert data["market_data"] in {"running", "warming", "closed"}


def test_health_running_after_tick(client: TestClient) -> None:
    """Once a tick has landed, market_data flips to running."""
    state = get_state()
    state.last_tick_monotonic = time.monotonic()
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["market_data"] == "running"


def test_health_503_when_tick_stale_and_market_open(client: TestClient) -> None:
    """A tick older than 60s flips overall status to error -> 503 (market open)."""
    state = get_state()
    state.last_tick_monotonic = time.monotonic() - 120.0
    with patch("app.api.health.current_market_status", return_value="open"):
        resp = client.get("/api/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "error"
    assert body["db"] == "ready"
    assert body["market_data"] == "error"


def test_health_ok_when_tick_stale_but_market_closed(client: TestClient) -> None:
    """Stale cache during market-closed hours is expected, not a fault."""
    state = get_state()
    state.last_tick_monotonic = time.monotonic() - 120.0
    with patch("app.api.health.current_market_status", return_value="closed"):
        resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] == "ready"
    assert body["market_data"] == "closed"


def test_health_no_tick_yet_market_closed_reports_closed(client: TestClient) -> None:
    """Boot during market-closed hours: no tick + closed -> closed (not warming)."""
    state = get_state()
    state.last_tick_monotonic = 0.0
    with patch("app.api.health.current_market_status", return_value="closed"):
        resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["market_data"] == "closed"


def test_health_no_tick_yet_market_open_reports_warming(client: TestClient) -> None:
    """Boot during market-open hours with no tick yet -> warming."""
    state = get_state()
    state.last_tick_monotonic = 0.0
    with patch("app.api.health.current_market_status", return_value="open"):
        resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["market_data"] == "warming"


@pytest.fixture(autouse=True)
def _reset_tick_state():
    yield
    state = get_state()
    state.last_tick_monotonic = 0.0
