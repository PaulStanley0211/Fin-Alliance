"""Fixtures for DB tests — each test gets a fresh on-disk SQLite file.

We use an on-disk file (rather than `:memory:`) because some code paths
(`SnapshotWriter`, `write_snapshot_now`) open their own connection via
`app.db.connect()`, and `:memory:` databases are not shared across
connections.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.db import connect, init_db


@pytest.fixture
def db_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Provide an isolated SQLite path via FINALLY_DB_PATH."""
    target = tmp_path / "finally-test.db"
    monkeypatch.setenv("FINALLY_DB_PATH", str(target))
    return target


@pytest.fixture
def initialized_db(db_file: Path) -> Path:
    """A database that has had `init_db()` run against it."""
    init_db()
    return db_file


@pytest.fixture
def conn(initialized_db: Path):
    """An open connection to the initialized DB. Closes after the test."""
    c = connect()
    try:
        yield c
    finally:
        c.close()
