"""Tests for /api/watchlist endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_watchlist_returns_seeded_tickers(client: TestClient) -> None:
    resp = client.get("/api/watchlist")
    assert resp.status_code == 200
    data = resp.json()
    tickers = [e["ticker"] for e in data["tickers"]]
    assert sorted(tickers) == sorted(
        ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"]
    )


def test_post_watchlist_adds_supported_ticker(client: TestClient) -> None:
    resp = client.post("/api/watchlist", json={"ticker": "PYPL"})
    assert resp.status_code == 200
    assert resp.json()["ticker"] == "PYPL"

    listed = [e["ticker"] for e in client.get("/api/watchlist").json()["tickers"]]
    assert "PYPL" in listed


def test_post_watchlist_uppercases(client: TestClient) -> None:
    resp = client.post("/api/watchlist", json={"ticker": "pypl"})
    assert resp.status_code == 200
    assert resp.json()["ticker"] == "PYPL"


def test_post_watchlist_unsupported_ticker_rejected(client: TestClient) -> None:
    resp = client.post("/api/watchlist", json={"ticker": "XYZQ"})
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "ticker_unsupported"


def test_post_watchlist_full_returns_watchlist_full(client: TestClient) -> None:
    """Adding past 25 tickers fails with watchlist_full code."""
    # Default list has 10. Add 15 more known-good ones.
    extras = [
        "PYPL", "ORCL", "CRM", "ADBE", "INTC", "AMD", "CSCO", "IBM", "QCOM", "AVGO",
        "TXN", "SHOP", "UBER", "ABNB", "SNAP",
    ]
    for t in extras:
        r = client.post("/api/watchlist", json={"ticker": t})
        assert r.status_code == 200, t
    # 26th attempt should fail.
    r = client.post("/api/watchlist", json={"ticker": "DOCU"})
    assert r.status_code == 400
    assert r.json()["error"] == "watchlist_full"


def test_post_watchlist_duplicate_is_idempotent(client: TestClient) -> None:
    """Re-adding an existing ticker should succeed without error."""
    r1 = client.post("/api/watchlist", json={"ticker": "AAPL"})
    assert r1.status_code == 200
    r2 = client.post("/api/watchlist", json={"ticker": "AAPL"})
    assert r2.status_code == 200


def test_delete_watchlist_removes_ticker(client: TestClient) -> None:
    resp = client.delete("/api/watchlist/AAPL")
    assert resp.status_code == 204

    listed = [e["ticker"] for e in client.get("/api/watchlist").json()["tickers"]]
    assert "AAPL" not in listed


def test_delete_watchlist_missing_is_204(client: TestClient) -> None:
    """DELETE is idempotent — 204 even if the ticker wasn't there."""
    resp = client.delete("/api/watchlist/ZZZZZ")
    assert resp.status_code == 204
