"""SQLite connection management.

Honors `FINALLY_DB_PATH` env var; defaults to `db/finally.db` relative to the
repo root (the directory two levels above this file: backend/app/db -> backend
-> repo root).
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = "db/finally.db"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def db_path() -> Path:
    """Resolve the on-disk path of the SQLite file.

    `FINALLY_DB_PATH` may be absolute or repo-relative. The `:memory:` value
    is passed through verbatim for in-memory databases (used in tests).
    """
    raw = os.environ.get("FINALLY_DB_PATH", DEFAULT_DB_PATH)
    if raw == ":memory:":
        return Path(raw)
    p = Path(raw)
    if not p.is_absolute():
        p = _repo_root() / p
    return p


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Open a SQLite connection with foreign keys ON and Row factory.

    Callers own the connection lifecycle. Use `with connect() as conn:` to
    get an automatic commit on success / rollback on exception.
    """
    target = Path(path) if path is not None else db_path()
    if str(target) != ":memory:":
        target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
