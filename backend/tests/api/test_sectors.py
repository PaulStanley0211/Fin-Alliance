"""Tests for GET /api/sectors."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_sectors_returns_full_taxonomy(client: TestClient) -> None:
    resp = client.get("/api/sectors")
    assert resp.status_code == 200
    data = resp.json()
    assert "version" in data
    assert "sectors" in data
    assert isinstance(data["sectors"], list)


def test_sectors_response_shape(client: TestClient) -> None:
    data = client.get("/api/sectors").json()
    assert data["version"] == "1.1"
    assert len(data["sectors"]) == 5
    for entry in data["sectors"]:
        assert set(entry.keys()) == {"id", "label", "tickers"}
        assert isinstance(entry["tickers"], list)
        assert len(entry["tickers"]) == 10


def test_sectors_total_50_unique_tickers(client: TestClient) -> None:
    data = client.get("/api/sectors").json()
    flat = [t for s in data["sectors"] for t in s["tickers"]]
    assert len(flat) == 50
    assert len(set(flat)) == 50


def test_sectors_ordering_is_stable(client: TestClient) -> None:
    data = client.get("/api/sectors").json()
    ids = [s["id"] for s in data["sectors"]]
    assert ids == [
        "technology",
        "healthcare",
        "financial",
        "consumer",
        "energy",
    ]


def test_materials_sector_dropped(client: TestClient) -> None:
    """Materials was removed in v1.1 to fit Finnhub's 50-symbol cap."""
    data = client.get("/api/sectors").json()
    ids = [s["id"] for s in data["sectors"]]
    assert "materials" not in ids


def test_sectors_first_sector_is_technology_with_aapl_first(client: TestClient) -> None:
    data = client.get("/api/sectors").json()
    assert data["sectors"][0]["id"] == "technology"
    assert data["sectors"][0]["tickers"][0] == "AAPL"


def test_sectors_endpoint_is_deterministic(client: TestClient) -> None:
    """Two consecutive GETs return identical bodies."""
    a = client.get("/api/sectors").json()
    b = client.get("/api/sectors").json()
    assert a == b
