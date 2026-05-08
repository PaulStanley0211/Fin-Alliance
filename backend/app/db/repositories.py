"""Repository functions — thin sync helpers over `sqlite3`.

Each function takes an open `sqlite3.Connection` and operates on it. Callers
own the connection (and therefore commit/rollback semantics). The connection
is expected to come from `app.db.connect()`.

All public mutators auto-commit by calling `conn.commit()` on success so
callers don't have to remember; reads do not commit. This keeps the API
ergonomic while still allowing callers to wrap several writes in a single
transaction by passing the same connection through.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

DEFAULT_USER_ID = "default"
QUANTITY_EPSILON = 1e-9

TradeSide = Literal["buy", "sell"]
SnapshotRange = Literal["1h", "1d", "1w", "1m", "all"]


class InsufficientSharesError(Exception):
    """Raised when a sell is attempted for more shares than the user owns."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


# --------------------------------------------------------------------------
# users_profile
# --------------------------------------------------------------------------


def get_user(conn: sqlite3.Connection, user_id: str = DEFAULT_USER_ID) -> dict[str, Any] | None:
    """Return the user profile row as a dict, or None if missing."""
    row = conn.execute(
        "SELECT id, cash_balance, created_at FROM users_profile WHERE id = ?", (user_id,)
    ).fetchone()
    return _row_to_dict(row)


def update_cash_balance(
    conn: sqlite3.Connection, new_balance: float, user_id: str = DEFAULT_USER_ID
) -> None:
    """Set the user's cash balance to `new_balance`."""
    conn.execute(
        "UPDATE users_profile SET cash_balance = ? WHERE id = ?", (new_balance, user_id)
    )
    conn.commit()


# --------------------------------------------------------------------------
# watchlist
# --------------------------------------------------------------------------


def list_watchlist(conn: sqlite3.Connection, user_id: str = DEFAULT_USER_ID) -> list[str]:
    """Return tickers on the user's watchlist, alphabetical."""
    rows = conn.execute(
        "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY ticker", (user_id,)
    ).fetchall()
    return [r["ticker"] for r in rows]


def add_to_watchlist(
    conn: sqlite3.Connection, ticker: str, user_id: str = DEFAULT_USER_ID
) -> bool:
    """Add a ticker to the watchlist. Returns True if added, False if already present."""
    try:
        conn.execute(
            "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), user_id, ticker, _now_iso()),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def remove_from_watchlist(
    conn: sqlite3.Connection, ticker: str, user_id: str = DEFAULT_USER_ID
) -> bool:
    """Remove a ticker from the watchlist. Returns True if a row was deleted."""
    cur = conn.execute(
        "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (user_id, ticker)
    )
    conn.commit()
    return cur.rowcount > 0


# --------------------------------------------------------------------------
# positions
# --------------------------------------------------------------------------


def get_position(
    conn: sqlite3.Connection, ticker: str, user_id: str = DEFAULT_USER_ID
) -> dict[str, Any] | None:
    """Return the position row for a ticker, or None."""
    row = conn.execute(
        "SELECT id, user_id, ticker, quantity, avg_cost, updated_at "
        "FROM positions WHERE user_id = ? AND ticker = ?",
        (user_id, ticker),
    ).fetchone()
    return _row_to_dict(row)


def list_positions(
    conn: sqlite3.Connection, user_id: str = DEFAULT_USER_ID
) -> list[dict[str, Any]]:
    """Return all positions for a user, alphabetical."""
    rows = conn.execute(
        "SELECT id, user_id, ticker, quantity, avg_cost, updated_at "
        "FROM positions WHERE user_id = ? ORDER BY ticker",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def upsert_position(
    conn: sqlite3.Connection,
    ticker: str,
    quantity: float,
    avg_cost: float,
    user_id: str = DEFAULT_USER_ID,
) -> None:
    """Insert or replace a position with the given (quantity, avg_cost).

    This is a low-level setter; prefer `apply_buy` / `apply_sell` for trade
    execution because they enforce cost-basis math.
    """
    existing = get_position(conn, ticker, user_id)
    now = _now_iso()
    if existing is None:
        conn.execute(
            "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), user_id, ticker, quantity, avg_cost, now),
        )
    else:
        conn.execute(
            "UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = ? "
            "WHERE id = ?",
            (quantity, avg_cost, now, existing["id"]),
        )
    conn.commit()


def delete_position(
    conn: sqlite3.Connection, ticker: str, user_id: str = DEFAULT_USER_ID
) -> bool:
    """Delete a position row. Returns True if deleted."""
    cur = conn.execute(
        "DELETE FROM positions WHERE user_id = ? AND ticker = ?", (user_id, ticker)
    )
    conn.commit()
    return cur.rowcount > 0


@dataclass(frozen=True)
class TradeApplication:
    """Result of applying a buy/sell to the positions table.

    `cost_basis` is the value to record on the trade row:
    - for buys: the new `avg_cost` after this buy is applied (per §7).
    - for sells: the position's `avg_cost` at the moment the sell executed.
    `position_deleted` is True iff a sell zeroed the position out.
    """

    new_quantity: float
    new_avg_cost: float
    cost_basis: float
    position_deleted: bool


def apply_buy(
    conn: sqlite3.Connection,
    ticker: str,
    quantity: float,
    price: float,
    user_id: str = DEFAULT_USER_ID,
) -> TradeApplication:
    """Apply a buy to the positions table, returning the resulting state.

    Cost-basis math:
    - New position: avg_cost = price.
    - Existing position: weighted average over (old_qty, old_avg) and (qty, price).
    """
    existing = get_position(conn, ticker, user_id)
    if existing is None:
        new_qty = quantity
        new_avg = price
    else:
        old_qty = existing["quantity"]
        old_avg = existing["avg_cost"]
        new_qty = old_qty + quantity
        new_avg = (old_qty * old_avg + quantity * price) / new_qty
    upsert_position(conn, ticker, new_qty, new_avg, user_id)
    return TradeApplication(
        new_quantity=new_qty,
        new_avg_cost=new_avg,
        cost_basis=new_avg,
        position_deleted=False,
    )


def apply_sell(
    conn: sqlite3.Connection,
    ticker: str,
    quantity: float,
    price: float,  # noqa: ARG001 — kept for symmetry with apply_buy
    user_id: str = DEFAULT_USER_ID,
) -> TradeApplication:
    """Apply a sell to the positions table.

    avg_cost is unchanged; quantity decreases. If the resulting quantity is
    within `QUANTITY_EPSILON` of zero, the row is deleted. Raises
    `InsufficientSharesError` if the user does not hold enough shares.
    """
    existing = get_position(conn, ticker, user_id)
    if existing is None or existing["quantity"] + QUANTITY_EPSILON < quantity:
        raise InsufficientSharesError(
            f"Cannot sell {quantity} {ticker}: only "
            f"{existing['quantity'] if existing else 0} owned."
        )
    cost_basis = existing["avg_cost"]
    new_qty = existing["quantity"] - quantity
    if abs(new_qty) <= QUANTITY_EPSILON:
        delete_position(conn, ticker, user_id)
        return TradeApplication(
            new_quantity=0.0,
            new_avg_cost=cost_basis,
            cost_basis=cost_basis,
            position_deleted=True,
        )
    upsert_position(conn, ticker, new_qty, cost_basis, user_id)
    return TradeApplication(
        new_quantity=new_qty,
        new_avg_cost=cost_basis,
        cost_basis=cost_basis,
        position_deleted=False,
    )


# --------------------------------------------------------------------------
# trades
# --------------------------------------------------------------------------


def record_trade(
    conn: sqlite3.Connection,
    ticker: str,
    side: TradeSide,
    quantity: float,
    price: float,
    cost_basis: float | None,
    request_id: str | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> dict[str, Any]:
    """Append a trade row and return it as a dict."""
    trade_id = str(uuid.uuid4())
    executed_at = _now_iso()
    conn.execute(
        "INSERT INTO trades (id, user_id, ticker, side, quantity, price, "
        "cost_basis, request_id, executed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (trade_id, user_id, ticker, side, quantity, price, cost_basis, request_id, executed_at),
    )
    conn.commit()
    return {
        "id": trade_id,
        "user_id": user_id,
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": price,
        "cost_basis": cost_basis,
        "request_id": request_id,
        "executed_at": executed_at,
    }


def find_trade_by_request_id(
    conn: sqlite3.Connection, request_id: str, user_id: str = DEFAULT_USER_ID
) -> dict[str, Any] | None:
    """Look up a trade by `(user_id, request_id)` for idempotency dedupe."""
    row = conn.execute(
        "SELECT id, user_id, ticker, side, quantity, price, cost_basis, "
        "request_id, executed_at FROM trades "
        "WHERE user_id = ? AND request_id = ?",
        (user_id, request_id),
    ).fetchone()
    return _row_to_dict(row)


def list_trades(
    conn: sqlite3.Connection,
    user_id: str = DEFAULT_USER_ID,
    side: TradeSide | None = None,
) -> list[dict[str, Any]]:
    """Return trades for a user, oldest first. Optionally filter by side."""
    if side is None:
        rows = conn.execute(
            "SELECT id, user_id, ticker, side, quantity, price, cost_basis, "
            "request_id, executed_at FROM trades WHERE user_id = ? "
            "ORDER BY executed_at",
            (user_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, user_id, ticker, side, quantity, price, cost_basis, "
            "request_id, executed_at FROM trades WHERE user_id = ? AND side = ? "
            "ORDER BY executed_at",
            (user_id, side),
        ).fetchall()
    return [dict(r) for r in rows]


def realized_pnl(conn: sqlite3.Connection, user_id: str = DEFAULT_USER_ID) -> float:
    """Sum of `(price - cost_basis) * quantity` across all sell trades."""
    row = conn.execute(
        "SELECT COALESCE(SUM((price - cost_basis) * quantity), 0.0) AS pnl "
        "FROM trades WHERE user_id = ? AND side = 'sell' AND cost_basis IS NOT NULL",
        (user_id,),
    ).fetchone()
    return float(row["pnl"])


# --------------------------------------------------------------------------
# portfolio_snapshots
# --------------------------------------------------------------------------


def record_snapshot(
    conn: sqlite3.Connection, total_value: float, user_id: str = DEFAULT_USER_ID
) -> dict[str, Any]:
    """Append a portfolio_snapshots row and return it."""
    snap_id = str(uuid.uuid4())
    recorded_at = _now_iso()
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (snap_id, user_id, total_value, recorded_at),
    )
    conn.commit()
    return {
        "id": snap_id,
        "user_id": user_id,
        "total_value": total_value,
        "recorded_at": recorded_at,
    }


def list_snapshots(
    conn: sqlite3.Connection,
    range_: SnapshotRange = "1d",
    user_id: str = DEFAULT_USER_ID,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """List portfolio_snapshots for a user.

    `range_` is one of `1h`, `1d`, `1w`, `1m`, `all`. The cutoff is computed
    relative to `now` (defaults to UTC now). Returned oldest-first.
    """
    current = now or datetime.now(timezone.utc)
    cutoff = _range_cutoff(range_, current)
    if cutoff is None:
        rows = conn.execute(
            "SELECT id, user_id, total_value, recorded_at FROM portfolio_snapshots "
            "WHERE user_id = ? ORDER BY recorded_at",
            (user_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, user_id, total_value, recorded_at FROM portfolio_snapshots "
            "WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at",
            (user_id, cutoff.isoformat()),
        ).fetchall()
    return [dict(r) for r in rows]


def _range_cutoff(range_: SnapshotRange, now: datetime) -> datetime | None:
    from datetime import timedelta

    if range_ == "all":
        return None
    if range_ == "1h":
        return now - timedelta(hours=1)
    if range_ == "1d":
        return now - timedelta(days=1)
    if range_ == "1w":
        return now - timedelta(weeks=1)
    if range_ == "1m":
        return now - timedelta(days=30)
    raise ValueError(f"Unknown snapshot range: {range_}")


# --------------------------------------------------------------------------
# chat_messages
# --------------------------------------------------------------------------


def append_chat_message(
    conn: sqlite3.Connection,
    role: Literal["user", "assistant"],
    content: str,
    actions: dict[str, Any] | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> dict[str, Any]:
    """Append a chat message and return it as a dict (with parsed actions)."""
    msg_id = str(uuid.uuid4())
    created_at = _now_iso()
    actions_json = json.dumps(actions) if actions is not None else None
    conn.execute(
        "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (msg_id, user_id, role, content, actions_json, created_at),
    )
    conn.commit()
    return {
        "id": msg_id,
        "user_id": user_id,
        "role": role,
        "content": content,
        "actions": actions,
        "created_at": created_at,
    }


def recent_chat_messages(
    conn: sqlite3.Connection, limit: int = 20, user_id: str = DEFAULT_USER_ID
) -> list[dict[str, Any]]:
    """Return the most recent `limit` chat messages, oldest-first.

    `actions` is parsed back to a dict (or None). Default `limit=20` matches
    the LLM context-window cap from §9.
    """
    rows = conn.execute(
        "SELECT id, user_id, role, content, actions, created_at FROM chat_messages "
        "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in reversed(rows):
        d = dict(r)
        d["actions"] = json.loads(d["actions"]) if d["actions"] is not None else None
        out.append(d)
    return out
