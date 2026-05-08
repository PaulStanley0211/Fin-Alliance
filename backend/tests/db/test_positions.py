"""Tests for positions repository and cost-basis math."""

from __future__ import annotations

import sqlite3

import pytest

from app.db import (
    InsufficientSharesError,
    apply_buy,
    apply_sell,
    delete_position,
    get_position,
    list_positions,
    upsert_position,
)


def test_get_position_returns_none_when_missing(conn: sqlite3.Connection) -> None:
    assert get_position(conn, "AAPL") is None


def test_apply_buy_creates_new_position(conn: sqlite3.Connection) -> None:
    result = apply_buy(conn, "AAPL", 10, 100.0)
    assert result.new_quantity == 10
    assert result.new_avg_cost == 100.0
    assert result.cost_basis == 100.0
    assert result.position_deleted is False
    pos = get_position(conn, "AAPL")
    assert pos is not None
    assert pos["quantity"] == 10
    assert pos["avg_cost"] == 100.0


def test_apply_buy_weights_avg_when_position_exists(conn: sqlite3.Connection) -> None:
    apply_buy(conn, "AAPL", 10, 100.0)
    result = apply_buy(conn, "AAPL", 10, 200.0)
    # Weighted: (10*100 + 10*200) / 20 = 150
    assert result.new_quantity == 20
    assert result.new_avg_cost == pytest.approx(150.0)
    assert result.cost_basis == pytest.approx(150.0)
    pos = get_position(conn, "AAPL")
    assert pos["quantity"] == 20
    assert pos["avg_cost"] == pytest.approx(150.0)


def test_apply_buy_uneven_weights(conn: sqlite3.Connection) -> None:
    apply_buy(conn, "AAPL", 5, 100.0)
    result = apply_buy(conn, "AAPL", 15, 200.0)
    # (5*100 + 15*200) / 20 = (500 + 3000) / 20 = 175
    assert result.new_avg_cost == pytest.approx(175.0)


def test_apply_sell_partial_keeps_avg_cost(conn: sqlite3.Connection) -> None:
    apply_buy(conn, "AAPL", 10, 100.0)
    result = apply_sell(conn, "AAPL", 4, 250.0)
    assert result.new_quantity == 6
    assert result.new_avg_cost == 100.0  # unchanged on sell
    assert result.cost_basis == 100.0
    assert result.position_deleted is False
    pos = get_position(conn, "AAPL")
    assert pos["quantity"] == 6
    assert pos["avg_cost"] == 100.0


def test_apply_sell_to_zero_deletes_row(conn: sqlite3.Connection) -> None:
    apply_buy(conn, "AAPL", 10, 100.0)
    result = apply_sell(conn, "AAPL", 10, 250.0)
    assert result.position_deleted is True
    assert result.new_quantity == 0.0
    assert result.cost_basis == 100.0
    assert get_position(conn, "AAPL") is None


def test_apply_sell_within_epsilon_deletes_row(conn: sqlite3.Connection) -> None:
    """Floating-point fractional sells within 1e-9 of zero should delete."""
    apply_buy(conn, "AAPL", 1.0, 100.0)
    result = apply_sell(conn, "AAPL", 1.0 - 1e-12, 250.0)
    assert result.position_deleted is True
    assert get_position(conn, "AAPL") is None


def test_apply_sell_oversell_raises(conn: sqlite3.Connection) -> None:
    apply_buy(conn, "AAPL", 5, 100.0)
    with pytest.raises(InsufficientSharesError):
        apply_sell(conn, "AAPL", 10, 250.0)


def test_apply_sell_no_position_raises(conn: sqlite3.Connection) -> None:
    with pytest.raises(InsufficientSharesError):
        apply_sell(conn, "GOOGL", 1, 100.0)


def test_list_positions_returns_alphabetical(conn: sqlite3.Connection) -> None:
    apply_buy(conn, "GOOGL", 1, 175.0)
    apply_buy(conn, "AAPL", 1, 100.0)
    apply_buy(conn, "MSFT", 1, 420.0)
    rows = list_positions(conn)
    assert [r["ticker"] for r in rows] == ["AAPL", "GOOGL", "MSFT"]


def test_upsert_position_replaces_existing(conn: sqlite3.Connection) -> None:
    upsert_position(conn, "AAPL", 5, 100.0)
    upsert_position(conn, "AAPL", 10, 150.0)
    pos = get_position(conn, "AAPL")
    assert pos["quantity"] == 10
    assert pos["avg_cost"] == 150.0


def test_delete_position_when_present(conn: sqlite3.Connection) -> None:
    upsert_position(conn, "AAPL", 5, 100.0)
    assert delete_position(conn, "AAPL") is True
    assert get_position(conn, "AAPL") is None


def test_delete_position_when_absent(conn: sqlite3.Connection) -> None:
    assert delete_position(conn, "NEVER") is False
