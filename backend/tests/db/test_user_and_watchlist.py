"""Tests for the users_profile repository.

The watchlist concept was removed in the redesign (see
`docs/superpowers/specs/2026-05-09-finally-redesign-design.md` §6); the
sector taxonomy in `app/market/sectors.py` is now the source of streamed
tickers. This file kept its name to preserve git history; only user-profile
tests remain.
"""

from __future__ import annotations

import sqlite3

from app.db import (
    DEFAULT_USER_ID,
    get_user,
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
