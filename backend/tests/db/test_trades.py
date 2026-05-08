"""Tests for trades repository, idempotency, and realized P&L."""

from __future__ import annotations

import sqlite3

import pytest

from app.db.repositories import (
    find_trade_by_request_id,
    list_trades,
    realized_pnl,
    record_trade,
)


def test_record_trade_returns_full_row(conn: sqlite3.Connection) -> None:
    trade = record_trade(conn, "AAPL", "buy", 10, 100.0, cost_basis=100.0)
    assert trade["ticker"] == "AAPL"
    assert trade["side"] == "buy"
    assert trade["quantity"] == 10
    assert trade["price"] == 100.0
    assert trade["cost_basis"] == 100.0
    assert trade["request_id"] is None
    assert "id" in trade and trade["id"]
    assert "executed_at" in trade and trade["executed_at"]


def test_list_trades_oldest_first(conn: sqlite3.Connection) -> None:
    record_trade(conn, "AAPL", "buy", 1, 100.0, cost_basis=100.0)
    record_trade(conn, "AAPL", "sell", 1, 110.0, cost_basis=100.0)
    record_trade(conn, "GOOGL", "buy", 2, 175.0, cost_basis=175.0)
    rows = list_trades(conn)
    assert [(r["ticker"], r["side"]) for r in rows] == [
        ("AAPL", "buy"),
        ("AAPL", "sell"),
        ("GOOGL", "buy"),
    ]


def test_list_trades_filtered_by_side(conn: sqlite3.Connection) -> None:
    record_trade(conn, "AAPL", "buy", 1, 100.0, cost_basis=100.0)
    record_trade(conn, "AAPL", "sell", 1, 110.0, cost_basis=100.0)
    sells = list_trades(conn, side="sell")
    assert len(sells) == 1
    assert sells[0]["side"] == "sell"


def test_record_trade_with_request_id_dedupes(conn: sqlite3.Connection) -> None:
    record_trade(
        conn, "AAPL", "buy", 10, 100.0, cost_basis=100.0, request_id="abc-123"
    )
    with pytest.raises(sqlite3.IntegrityError):
        record_trade(
            conn, "AAPL", "buy", 10, 100.0, cost_basis=100.0, request_id="abc-123"
        )


def test_find_trade_by_request_id(conn: sqlite3.Connection) -> None:
    record_trade(
        conn, "AAPL", "buy", 10, 100.0, cost_basis=100.0, request_id="abc-123"
    )
    found = find_trade_by_request_id(conn, "abc-123")
    assert found is not None
    assert found["ticker"] == "AAPL"


def test_find_trade_by_request_id_missing(conn: sqlite3.Connection) -> None:
    assert find_trade_by_request_id(conn, "nope") is None


def test_realized_pnl_zero_initially(conn: sqlite3.Connection) -> None:
    assert realized_pnl(conn) == 0.0


def test_realized_pnl_only_counts_sells(conn: sqlite3.Connection) -> None:
    record_trade(conn, "AAPL", "buy", 10, 100.0, cost_basis=100.0)
    # buys do not contribute
    assert realized_pnl(conn) == 0.0
    # sell at +20 over cost basis: (110 - 100) * 5 = 50
    record_trade(conn, "AAPL", "sell", 5, 110.0, cost_basis=100.0)
    assert realized_pnl(conn) == pytest.approx(50.0)
    # another sell at -10 below cost basis: (90 - 100) * 5 = -50
    record_trade(conn, "AAPL", "sell", 5, 90.0, cost_basis=100.0)
    assert realized_pnl(conn) == pytest.approx(0.0)
