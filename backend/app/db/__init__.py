"""Persistence layer for FinAlly.

Public API (importable from `app.db`):

- `init_db()` — idempotent schema creation + seed; call from FastAPI lifespan.
- `connect()` — open a `sqlite3.Connection` with foreign keys + Row factory.
- `db_path()` — resolved on-disk path of the SQLite file.
- Repository functions: see `repositories.py`.
- `SnapshotWriter` — background task that records portfolio snapshots.
"""

from .connection import connect, db_path
from .init import init_db
from .repositories import (
    DEFAULT_USER_ID,
    InsufficientSharesError,
    append_chat_message,
    apply_buy,
    apply_sell,
    delete_position,
    get_position,
    get_user,
    list_positions,
    list_snapshots,
    list_trades,
    recent_chat_messages,
    record_snapshot,
    record_trade,
    update_cash_balance,
    upsert_position,
)
from .snapshot_writer import SnapshotWriter, compute_total_value, write_snapshot_now

__all__ = [
    "DEFAULT_USER_ID",
    "InsufficientSharesError",
    "SnapshotWriter",
    "append_chat_message",
    "apply_buy",
    "apply_sell",
    "compute_total_value",
    "connect",
    "db_path",
    "delete_position",
    "get_position",
    "get_user",
    "init_db",
    "list_positions",
    "list_snapshots",
    "list_trades",
    "recent_chat_messages",
    "record_snapshot",
    "record_trade",
    "update_cash_balance",
    "upsert_position",
    "write_snapshot_now",
]
