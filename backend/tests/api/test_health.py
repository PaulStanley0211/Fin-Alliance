"""Tests for GET /api/health."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.state import get_state


def test_health_returns_ok_with_warming(client: TestClient) -> None:
    """At very fresh start the market data may still be warming; that's healthy."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["db"] == "ready"
    assert data["market_data"] in {"running", "warming"}


def test_health_running_after_tick(client: TestClient) -> None:
    """Once a tick has landed, market_data flips to running."""
    state = get_state()
    state.last_tick_monotonic = time.monotonic()
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["market_data"] == "running"


def test_health_503_when_tick_stale(client: TestClient) -> None:
    """A tick older than 60s flips overall status to error → 503."""
    state = get_state()
    state.last_tick_monotonic = time.monotonic() - 120.0
    resp = client.get("/api/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "error"
    assert body["db"] == "ready"
    assert body["market_data"] == "error"
