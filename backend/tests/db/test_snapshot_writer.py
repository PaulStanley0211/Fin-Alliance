"""Tests for the snapshot writer (sync + background)."""

from __future__ import annotations

import asyncio

import pytest

from app.db import (
    SnapshotWriter,
    apply_buy,
    compute_total_value,
    connect,
    list_snapshots,
    update_cash_balance,
    write_snapshot_now,
)


class FakeCache:
    """Minimal stand-in for app.market.PriceCache used by snapshot writer."""

    def __init__(self, prices: dict[str, float] | None = None) -> None:
        self._prices = prices or {}

    def get_price(self, ticker: str) -> float | None:
        return self._prices.get(ticker)

    def set(self, ticker: str, price: float) -> None:
        self._prices[ticker] = price


def test_compute_total_value_cash_only(conn) -> None:
    cache = FakeCache()
    assert compute_total_value(conn, cache) == 10_000.0


def test_compute_total_value_with_positions_and_prices(conn) -> None:
    update_cash_balance(conn, 9_000.0)
    apply_buy(conn, "AAPL", 10, 100.0)  # 1000 cost
    apply_buy(conn, "GOOGL", 2, 200.0)  # 400 cost (but used for cash side externally)
    cache = FakeCache({"AAPL": 110.0, "GOOGL": 250.0})
    # value = 9000 + 10*110 + 2*250 = 9000 + 1100 + 500 = 10600
    assert compute_total_value(conn, cache) == pytest.approx(10_600.0)


def test_compute_total_value_falls_back_to_avg_cost_when_price_missing(conn) -> None:
    update_cash_balance(conn, 9_000.0)
    apply_buy(conn, "AAPL", 10, 100.0)
    cache = FakeCache()  # no prices yet
    # value = 9000 + 10*100 (avg_cost fallback) = 10000
    assert compute_total_value(conn, cache) == pytest.approx(10_000.0)


def test_write_snapshot_now_persists(initialized_db) -> None:
    cache = FakeCache()
    snap = write_snapshot_now(cache)
    assert snap["total_value"] == 10_000.0
    with connect() as c:
        rows = list_snapshots(c, "all")
    # anchor + the one we just wrote
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_snapshot_writer_periodic(initialized_db) -> None:
    cache = FakeCache()
    writer = SnapshotWriter(cache, interval_seconds=0.05)
    await writer.start()
    try:
        await asyncio.sleep(0.18)  # ~3 ticks
    finally:
        await writer.stop()
    with connect() as c:
        rows = list_snapshots(c, "all")
    # anchor + at least 2 ticks
    assert len(rows) >= 3


@pytest.mark.asyncio
async def test_snapshot_writer_stop_is_idempotent(initialized_db) -> None:
    cache = FakeCache()
    writer = SnapshotWriter(cache, interval_seconds=0.05)
    await writer.start()
    await writer.stop()
    await writer.stop()  # should not raise


@pytest.mark.asyncio
async def test_snapshot_writer_double_start_is_noop(initialized_db) -> None:
    cache = FakeCache()
    writer = SnapshotWriter(cache, interval_seconds=0.05)
    await writer.start()
    first_task = writer._task
    await writer.start()  # should not replace
    assert writer._task is first_task
    await writer.stop()
