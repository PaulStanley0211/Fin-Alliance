"""Tests for chat_messages and portfolio_snapshots repositories."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from app.db import (
    append_chat_message,
    list_snapshots,
    recent_chat_messages,
    record_snapshot,
)


def test_append_and_recent_chat_round_trip(conn: sqlite3.Connection) -> None:
    append_chat_message(conn, "user", "hello")
    actions = {
        "trades": [
            {"ticker": "AAPL", "side": "buy", "quantity": 1, "status": "executed",
             "price": 100.0, "error": None}
        ],
        "watchlist_changes": [],
    }
    append_chat_message(conn, "assistant", "Bought 1 AAPL.", actions=actions)
    msgs = recent_chat_messages(conn)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "hello"
    assert msgs[0]["actions"] is None
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["actions"] == actions


def test_recent_chat_messages_limit(conn: sqlite3.Connection) -> None:
    for i in range(25):
        append_chat_message(conn, "user", f"msg-{i}")
    msgs = recent_chat_messages(conn, limit=20)
    assert len(msgs) == 20
    # Oldest-first: msg-5 ... msg-24
    assert msgs[0]["content"] == "msg-5"
    assert msgs[-1]["content"] == "msg-24"


def test_recent_chat_messages_default_limit_is_20(conn: sqlite3.Connection) -> None:
    for i in range(30):
        append_chat_message(conn, "user", f"m-{i}")
    msgs = recent_chat_messages(conn)
    assert len(msgs) == 20


def test_record_snapshot_appends_row(conn: sqlite3.Connection) -> None:
    snap = record_snapshot(conn, 12_345.67)
    assert snap["total_value"] == 12_345.67
    assert "id" in snap and snap["id"]


def test_list_snapshots_default_range_filters_by_time(conn: sqlite3.Connection) -> None:
    """list_snapshots('1d') excludes rows older than 24 h."""
    now = datetime.now(timezone.utc)
    # The seeded anchor row was just written, so it's within 1d.
    # Insert an old row directly (bypass record_snapshot's "now" timestamp).
    old_ts = (now - timedelta(days=2)).isoformat()
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, 'default', ?, ?)",
        ("old-id", 9_000.0, old_ts),
    )
    conn.commit()
    rows_1d = list_snapshots(conn, "1d", now=now)
    rows_all = list_snapshots(conn, "all", now=now)
    assert len(rows_all) == 2
    assert len(rows_1d) == 1
    assert rows_1d[0]["total_value"] == 10_000.0  # the anchor


def test_list_snapshots_ranges(conn: sqlite3.Connection) -> None:
    now = datetime.now(timezone.utc)
    points = [
        ("p-30m", now - timedelta(minutes=30), 1.0),
        ("p-3h", now - timedelta(hours=3), 2.0),
        ("p-3d", now - timedelta(days=3), 3.0),
        ("p-2w", now - timedelta(weeks=2), 4.0),
        ("p-2mo", now - timedelta(days=60), 5.0),
    ]
    for pid, ts, val in points:
        conn.execute(
            "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
            "VALUES (?, 'default', ?, ?)",
            (pid, val, ts.isoformat()),
        )
    conn.commit()

    by_range = {
        "1h": list_snapshots(conn, "1h", now=now),
        "1d": list_snapshots(conn, "1d", now=now),
        "1w": list_snapshots(conn, "1w", now=now),
        "1m": list_snapshots(conn, "1m", now=now),
        "all": list_snapshots(conn, "all", now=now),
    }
    # Anchor counts in every bucket because it was just written.
    assert len(by_range["1h"]) == 2  # anchor + 30m
    assert len(by_range["1d"]) == 3  # anchor + 30m + 3h
    assert len(by_range["1w"]) == 4  # anchor + 30m + 3h + 3d
    assert len(by_range["1m"]) == 5  # anchor + 30m + 3h + 3d + 2w
    assert len(by_range["all"]) == 6  # everything
