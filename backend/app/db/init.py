"""Database initialization: schema creation and default seeding.

Call `init_db()` from FastAPI's `lifespan` startup. Idempotent: safe to run
on every boot. Creates tables if missing and inserts default data only when
the relevant table is empty for the default user.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .connection import connect, db_path

DEFAULT_USER_ID = "default"
DEFAULT_CASH_BALANCE = 10_000.0

DEFAULT_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "db" / "schema.sql"


def _schema_path() -> Path:
    """Resolved path to schema.sql.

    Honors `FINALLY_SCHEMA_PATH` so a Docker image can keep the schema
    outside the bind-mounted `/app/db/` directory. Without the override,
    the bind mount would shadow whatever the image bakes into `/app/db/`.
    Default behavior (no env var) is unchanged.
    """
    raw = os.environ.get("FINALLY_SCHEMA_PATH")
    return Path(raw) if raw else DEFAULT_SCHEMA_PATH


# Back-compat alias. Resolved at import time, so it captures the env var
# only if it was set before the module was loaded — prefer `_schema_path()`
# for runtime lookups.
SCHEMA_PATH = _schema_path()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_schema() -> str:
    return _schema_path().read_text(encoding="utf-8")


def init_db(path: Path | str | None = None) -> Path:
    """Create the schema and seed default data if missing.

    Returns the resolved DB path. Safe to call multiple times.
    """
    resolved = Path(path) if path is not None else db_path()
    with connect(resolved) as conn:
        conn.executescript(_load_schema())
        _seed_defaults(conn)
        conn.commit()
    return resolved


def _seed_defaults(conn: sqlite3.Connection) -> None:
    _seed_user(conn)
    _seed_anchor_snapshot(conn)


def _seed_user(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT id FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    ).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
            (DEFAULT_USER_ID, DEFAULT_CASH_BALANCE, _now_iso()),
        )


def _seed_anchor_snapshot(conn: sqlite3.Connection) -> None:
    """Write a single anchor snapshot at $10k if the snapshot table is empty
    for the default user. Gives the P&L chart a starting point on first launch.
    """
    count = conn.execute(
        "SELECT COUNT(*) AS n FROM portfolio_snapshots WHERE user_id = ?",
        (DEFAULT_USER_ID,),
    ).fetchone()["n"]
    if count > 0:
        return
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, DEFAULT_CASH_BALANCE, _now_iso()),
    )
