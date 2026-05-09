"""Background snapshot writer.

Every `interval_seconds` (default 30) computes the current portfolio total
value from `cash + Σ(qty × cache.get_price(ticker))` and writes a row into
`portfolio_snapshots`. Position rows whose ticker has no price yet contribute
their `avg_cost` so the total never misreports cash-only on warm-up.

`write_snapshot_now()` is the synchronous variant the API layer (and trade
endpoint) calls after a trade so the chart updates immediately.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from collections.abc import Callable
from typing import Protocol

from .connection import connect
from .repositories import (
    DEFAULT_USER_ID,
    get_user,
    list_positions,
    record_snapshot,
)

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 30.0


class _PriceLookup(Protocol):
    def get_price(self, ticker: str) -> float | None: ...


def compute_total_value(
    conn: sqlite3.Connection,
    cache: _PriceLookup,
    user_id: str = DEFAULT_USER_ID,
) -> float:
    """Compute the user's portfolio total value at this moment.

    Falls back to `avg_cost` for positions with no cached price (e.g. before
    the first market-data tick lands), so a freshly-seeded user with cash
    only still reports $10k rather than the cash row alone.
    """
    user = get_user(conn, user_id)
    cash = user["cash_balance"] if user is not None else 0.0
    positions_value = 0.0
    for pos in list_positions(conn, user_id):
        cached = cache.get_price(pos["ticker"])
        price = cached if cached is not None else pos["avg_cost"]
        positions_value += pos["quantity"] * price
    return cash + positions_value


def write_snapshot_now(
    cache: _PriceLookup,
    user_id: str = DEFAULT_USER_ID,
    conn_factory: Callable[[], sqlite3.Connection] = connect,
) -> dict:
    """Write a snapshot synchronously. Safe to call from request handlers."""
    with conn_factory() as conn:
        total = compute_total_value(conn, cache, user_id)
        return record_snapshot(conn, total, user_id)


class SnapshotWriter:
    """Async background task that periodically writes portfolio snapshots."""

    def __init__(
        self,
        cache: _PriceLookup,
        user_id: str = DEFAULT_USER_ID,
        interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
        conn_factory: Callable[[], sqlite3.Connection] = connect,
    ) -> None:
        self._cache = cache
        self._user_id = user_id
        self._interval = interval_seconds
        self._conn_factory = conn_factory
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        """Begin recording snapshots in the background."""
        if self._task is not None:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="snapshot-writer")

    async def stop(self) -> None:
        """Stop the background task. Safe to call multiple times."""
        if self._task is None:
            return
        self._stop.set()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                self._tick()
                continue
            break

    def _tick(self) -> None:
        """Write one snapshot per active user_profile row.

        Iterating over `users_profile` (rather than `users`) covers both
        the legacy ``default`` user and every authed account, since every
        signup seeds a `users_profile` row. New users that show up between
        ticks are picked up automatically — no writer restart needed.
        """
        try:
            with self._conn_factory() as conn:
                rows = conn.execute(
                    "SELECT id FROM users_profile"
                ).fetchall()
                user_ids = [r["id"] for r in rows]
                # Defensive fallback: if the profiles table is empty (fresh
                # migration), keep writing the configured user_id so the
                # writer still produces *something*.
                if not user_ids:
                    user_ids = [self._user_id]
                for uid in user_ids:
                    total = compute_total_value(conn, self._cache, uid)
                    record_snapshot(conn, total, uid)
        except Exception:  # noqa: BLE001 — background loop must not die
            logger.exception("Snapshot writer tick failed")
