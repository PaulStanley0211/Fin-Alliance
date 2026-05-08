"""Tests for /api/portfolio endpoints (view, trade, history)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.state import get_state


def _seed_price(ticker: str, price: float) -> None:
    """Inject a price into the cache so the trade endpoint has something to fill at."""
    cache = get_state().price_cache
    assert cache is not None
    cache.update(ticker=ticker, price=price)


# --------------------------------------------------------------------------
# GET /api/portfolio
# --------------------------------------------------------------------------


def test_portfolio_initial_state(client: TestClient) -> None:
    resp = client.get("/api/portfolio")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cash_balance"] == 10000.0
    assert data["positions"] == []
    assert data["total_value"] == 10000.0
    assert data["realized_pnl"] == 0.0


# --------------------------------------------------------------------------
# POST /api/portfolio/trade
# --------------------------------------------------------------------------


def test_buy_succeeds_and_updates_state(client: TestClient) -> None:
    _seed_price("AAPL", 200.00)
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ticker"] == "AAPL"
    assert body["side"] == "buy"
    assert body["quantity"] == 10
    assert body["price"] == 200.00
    assert body["cash_balance"] == 8000.0
    assert body["position_quantity"] == 10

    portfolio = client.get("/api/portfolio").json()
    assert portfolio["cash_balance"] == 8000.0
    assert len(portfolio["positions"]) == 1
    p = portfolio["positions"][0]
    assert p["ticker"] == "AAPL"
    assert p["quantity"] == 10
    assert p["avg_cost"] == 200.00


def test_buy_insufficient_cash(client: TestClient) -> None:
    _seed_price("AAPL", 200.00)
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 100, "side": "buy"},  # 20k > 10k
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "insufficient_cash"


def test_sell_without_position_fails(client: TestClient) -> None:
    _seed_price("AAPL", 200.00)
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 1, "side": "sell"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "insufficient_shares"


def test_buy_then_sell(client: TestClient) -> None:
    _seed_price("AAPL", 200.00)
    client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    _seed_price("AAPL", 220.00)  # Price moved
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 5, "side": "sell"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["price"] == 220.00
    assert body["cost_basis"] == 200.00
    assert body["position_quantity"] == 5
    assert body["cash_balance"] == 8000.0 + 5 * 220.0  # 9100

    portfolio = client.get("/api/portfolio").json()
    # realized P&L for the 5 sold shares: (220 - 200) * 5 = 100
    assert portfolio["realized_pnl"] == 100.0


def test_sell_full_position_deletes_row(client: TestClient) -> None:
    _seed_price("AAPL", 200.00)
    client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "sell"},
    )
    assert resp.status_code == 200
    portfolio = client.get("/api/portfolio").json()
    assert portfolio["positions"] == []


def test_trade_idempotency(client: TestClient) -> None:
    """Same request_id → identical trade row, no double-execution."""
    _seed_price("AAPL", 200.00)
    payload = {
        "ticker": "AAPL",
        "quantity": 5,
        "side": "buy",
        "request_id": "abc-123",
    }
    r1 = client.post("/api/portfolio/trade", json=payload)
    assert r1.status_code == 200
    trade_id_1 = r1.json()["id"]

    # Replay
    _seed_price("AAPL", 250.00)  # price moved — replay should ignore this
    r2 = client.post("/api/portfolio/trade", json=payload)
    assert r2.status_code == 200
    body = r2.json()
    assert body["id"] == trade_id_1
    assert body["price"] == 200.00  # original price, not the replayed one

    # Cash should have decreased exactly once.
    portfolio = client.get("/api/portfolio").json()
    assert portfolio["cash_balance"] == 10000.0 - 5 * 200.0


def test_trade_auto_adds_to_watchlist(client: TestClient) -> None:
    """Buying a ticker that isn't on the watchlist should add it."""
    _seed_price("PYPL", 60.00)  # PYPL is not in default watchlist
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "PYPL", "quantity": 1, "side": "buy"},
    )
    assert resp.status_code == 200, resp.text
    listed = [e["ticker"] for e in client.get("/api/watchlist").json()["tickers"]]
    assert "PYPL" in listed


def test_trade_unsupported_ticker_rejected(client: TestClient) -> None:
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "XYZQ", "quantity": 1, "side": "buy"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "ticker_unsupported"


def test_trade_invalid_quantity_rejected(client: TestClient) -> None:
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 0, "side": "buy"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_request"


def test_trade_invalid_side_rejected(client: TestClient) -> None:
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 1, "side": "hold"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_request"


def test_buy_records_snapshot(client: TestClient) -> None:
    """A successful trade should produce a portfolio_snapshots row immediately."""
    initial = client.get("/api/portfolio/history?range=all").json()
    initial_count = len(initial["snapshots"])

    _seed_price("AAPL", 200.00)
    client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 5, "side": "buy"},
    )
    final = client.get("/api/portfolio/history?range=all").json()
    assert len(final["snapshots"]) == initial_count + 1


# --------------------------------------------------------------------------
# GET /api/portfolio/history
# --------------------------------------------------------------------------


def test_history_default_range(client: TestClient) -> None:
    resp = client.get("/api/portfolio/history")
    assert resp.status_code == 200
    data = resp.json()
    assert data["range"] == "1d"
    assert isinstance(data["snapshots"], list)


def test_history_invalid_range_rejected(client: TestClient) -> None:
    resp = client.get("/api/portfolio/history?range=foo")
    assert resp.status_code == 400


def test_history_all_includes_anchor(client: TestClient) -> None:
    """init_db writes an anchor snapshot, so range=all is non-empty even fresh."""
    resp = client.get("/api/portfolio/history?range=all")
    assert resp.status_code == 200
    snaps = resp.json()["snapshots"]
    assert len(snaps) >= 1
