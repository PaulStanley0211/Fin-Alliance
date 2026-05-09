"""Users repository — CRUD on the ``users`` table plus portfolio seeding.

A new account gets:
- a row in ``users`` (id=UUID, username, password_hash, created_at)
- a row in ``users_profile`` (id=user_id, cash_balance=10000, created_at)
- an anchor row in ``portfolio_snapshots`` so the P&L chart isn't blank
  on first login.

These three writes happen inside a single connection so signup is
all-or-nothing. The caller (``/api/auth/signup``) commits as part of
``create_user``.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

DEFAULT_CASH_BALANCE = 10_000.0


class UsernameTakenError(Exception):
    """Raised by ``create_user`` when the username is already registered."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def get_user_by_username(
    conn: sqlite3.Connection, username: str
) -> dict[str, Any] | None:
    """Return the user row for ``username`` (case-sensitive), or None."""
    row = conn.execute(
        "SELECT id, username, password_hash, created_at FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    return _row_to_dict(row)


def get_user_by_id(conn: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
    """Return the user row for ``user_id``, or None."""
    row = conn.execute(
        "SELECT id, username, password_hash, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return _row_to_dict(row)


def create_user(
    conn: sqlite3.Connection,
    username: str,
    password_hash: str,
    *,
    starting_cash: float = DEFAULT_CASH_BALANCE,
) -> dict[str, Any]:
    """Insert a new user, seed their portfolio, return the user row.

    Raises ``UsernameTakenError`` if the username already exists. Commits on
    success so the three writes (users, users_profile, anchor snapshot)
    land together.
    """
    if get_user_by_username(conn, username) is not None:
        raise UsernameTakenError(username)

    user_id = str(uuid.uuid4())
    now = _now_iso()

    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (user_id, username, password_hash, now),
    )
    conn.execute(
        "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (user_id, starting_cash, now),
    )
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, starting_cash, now),
    )
    conn.commit()

    return {
        "id": user_id,
        "username": username,
        "password_hash": password_hash,
        "created_at": now,
    }


__all__ = [
    "DEFAULT_CASH_BALANCE",
    "UsernameTakenError",
    "create_user",
    "get_user_by_id",
    "get_user_by_username",
]
