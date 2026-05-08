"""Schema creation and seeding tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.db import connect, init_db
from app.db.init import DEFAULT_TICKERS, DEFAULT_USER_ID


def test_init_creates_all_tables(db_file: Path) -> None:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    names = {r["name"] for r in rows}
    assert {
        "users_profile",
        "watchlist",
        "positions",
        "trades",
        "portfolio_snapshots",
        "chat_messages",
    } <= names


def test_init_seeds_default_user_with_10k(db_file: Path) -> None:
    init_db()
    with connect() as conn:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        ).fetchone()
    assert row is not None
    assert row["cash_balance"] == 10_000.0


def test_init_seeds_default_watchlist(db_file: Path) -> None:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY ticker",
            (DEFAULT_USER_ID,),
        ).fetchall()
    tickers = [r["ticker"] for r in rows]
    assert sorted(tickers) == sorted(DEFAULT_TICKERS)


def test_init_writes_anchor_snapshot(db_file: Path) -> None:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            "SELECT total_value FROM portfolio_snapshots WHERE user_id = ?",
            (DEFAULT_USER_ID,),
        ).fetchall()
    assert len(rows) == 1
    assert rows[0]["total_value"] == 10_000.0


def test_init_is_idempotent(db_file: Path) -> None:
    init_db()
    init_db()
    init_db()
    with connect() as conn:
        users = conn.execute("SELECT COUNT(*) AS n FROM users_profile").fetchone()["n"]
        wl = conn.execute(
            "SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?", (DEFAULT_USER_ID,)
        ).fetchone()["n"]
        snaps = conn.execute(
            "SELECT COUNT(*) AS n FROM portfolio_snapshots WHERE user_id = ?",
            (DEFAULT_USER_ID,),
        ).fetchone()["n"]
    assert users == 1
    assert wl == len(DEFAULT_TICKERS)
    assert snaps == 1


def test_init_skips_seed_when_user_exists(db_file: Path) -> None:
    init_db()
    with connect() as conn:
        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (5_000.0, DEFAULT_USER_ID),
        )
        conn.commit()
    init_db()
    with connect() as conn:
        balance = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        ).fetchone()["cash_balance"]
    assert balance == 5_000.0


def test_foreign_keys_pragma_on(db_file: Path) -> None:
    init_db()
    with connect() as conn:
        fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    assert fk == 1


def test_db_path_env_var_respected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "custom.db"
    monkeypatch.setenv("FINALLY_DB_PATH", str(target))
    init_db()
    assert target.exists()


def test_schema_path_env_var_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`FINALLY_SCHEMA_PATH` redirects schema reads off the bind-mount path.

    Docker scenario: the runtime bind mount on `/app/db/` would shadow any
    schema file baked into that directory at build time. The override lets
    the image keep its schema.sql somewhere else (e.g. `/app/db_schema/`)
    so the bind mount can't hide it.
    """
    # Read the canonical schema once, then write it to a different location.
    from app.db.init import DEFAULT_SCHEMA_PATH

    custom_schema = tmp_path / "custom_schema.sql"
    custom_schema.write_text(
        DEFAULT_SCHEMA_PATH.read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    db_target = tmp_path / "via-override.db"
    monkeypatch.setenv("FINALLY_SCHEMA_PATH", str(custom_schema))
    monkeypatch.setenv("FINALLY_DB_PATH", str(db_target))

    init_db()
    assert db_target.exists()
    with connect() as conn:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        ).fetchone()
    assert row is not None
    assert row["cash_balance"] == 10_000.0


def test_schema_path_env_var_default_when_unset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With FINALLY_SCHEMA_PATH unset, schema is read from the default location."""
    from app.db.init import DEFAULT_SCHEMA_PATH, _schema_path

    monkeypatch.delenv("FINALLY_SCHEMA_PATH", raising=False)
    assert _schema_path() == DEFAULT_SCHEMA_PATH


def test_schema_path_missing_file_raises(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bogus `FINALLY_SCHEMA_PATH` should fail loud, not silent."""
    monkeypatch.setenv("FINALLY_SCHEMA_PATH", str(tmp_path / "does_not_exist.sql"))
    monkeypatch.setenv("FINALLY_DB_PATH", str(tmp_path / "x.db"))
    with pytest.raises(FileNotFoundError):
        init_db()
