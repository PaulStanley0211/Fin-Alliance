"""Tests for users_profile and watchlist repositories."""

from __future__ import annotations

import sqlite3

from app.db import (
    DEFAULT_USER_ID,
    add_to_watchlist,
    get_user,
    list_watchlist,
    remove_from_watchlist,
    update_cash_balance,
)


def test_get_user_returns_seed(conn: sqlite3.Connection) -> None:
    user = get_user(conn)
    assert user is not None
    assert user["id"] == DEFAULT_USER_ID
    assert user["cash_balance"] == 10_000.0


def test_get_user_missing_returns_none(conn: sqlite3.Connection) -> None:
    assert get_user(conn, user_id="nobody") is None


def test_update_cash_balance(conn: sqlite3.Connection) -> None:
    update_cash_balance(conn, 7_500.0)
    assert get_user(conn)["cash_balance"] == 7_500.0


def test_list_watchlist_returns_seeded(conn: sqlite3.Connection) -> None:
    tickers = list_watchlist(conn)
    assert "AAPL" in tickers
    assert len(tickers) == 10


def test_add_to_watchlist_returns_true_when_new(conn: sqlite3.Connection) -> None:
    assert add_to_watchlist(conn, "PYPL") is True
    assert "PYPL" in list_watchlist(conn)


def test_add_to_watchlist_returns_false_on_duplicate(conn: sqlite3.Connection) -> None:
    assert add_to_watchlist(conn, "AAPL") is False  # already seeded


def test_remove_from_watchlist(conn: sqlite3.Connection) -> None:
    assert remove_from_watchlist(conn, "AAPL") is True
    assert "AAPL" not in list_watchlist(conn)


def test_remove_unknown_ticker_returns_false(conn: sqlite3.Connection) -> None:
    assert remove_from_watchlist(conn, "NEVER") is False
