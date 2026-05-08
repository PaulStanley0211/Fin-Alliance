"""Tests for market_status calculation.

PLAN.md §6 contract:
- Simulator (no MASSIVE_API_KEY) → always "open".
- Massive (MASSIVE_API_KEY set) → "open" only on weekdays 09:30–16:00 NY.
- "warming" is a stream-level concern, not returned here.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.market.market_status import (
    NY_TZ,
    current_market_status,
    is_massive_path,
    market_open_at,
)


@pytest.fixture
def simulator_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)


@pytest.fixture
def massive_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key-123")


# --------------------------------------------------------------------------
# is_massive_path
# --------------------------------------------------------------------------


def test_is_massive_false_when_unset(simulator_env: None) -> None:
    assert is_massive_path() is False


def test_is_massive_true_when_set(massive_env: None) -> None:
    assert is_massive_path() is True


def test_is_massive_false_when_empty_string(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MASSIVE_API_KEY", "   ")
    assert is_massive_path() is False


# --------------------------------------------------------------------------
# market_open_at
# --------------------------------------------------------------------------


def test_market_open_weekday_midday() -> None:
    # Tuesday 12:00 NY
    dt = datetime(2026, 5, 5, 12, 0, tzinfo=NY_TZ)
    assert market_open_at(dt) is True


def test_market_open_at_open_bell() -> None:
    dt = datetime(2026, 5, 5, 9, 30, tzinfo=NY_TZ)
    assert market_open_at(dt) is True


def test_market_closed_at_close_bell() -> None:
    """16:00 is exclusive — the bell rings, market is closed."""
    dt = datetime(2026, 5, 5, 16, 0, tzinfo=NY_TZ)
    assert market_open_at(dt) is False


def test_market_closed_before_open() -> None:
    dt = datetime(2026, 5, 5, 9, 29, tzinfo=NY_TZ)
    assert market_open_at(dt) is False


def test_market_closed_on_saturday() -> None:
    dt = datetime(2026, 5, 9, 12, 0, tzinfo=NY_TZ)  # Saturday
    assert market_open_at(dt) is False


def test_market_closed_on_sunday() -> None:
    dt = datetime(2026, 5, 10, 12, 0, tzinfo=NY_TZ)  # Sunday
    assert market_open_at(dt) is False


def test_market_open_handles_other_timezone() -> None:
    """A datetime in UTC is converted to NY time before checking."""
    # 2026-05-05 16:00 UTC == 12:00 NY (DST) → open
    dt = datetime(2026, 5, 5, 16, 0, tzinfo=ZoneInfo("UTC"))
    assert market_open_at(dt) is True


# --------------------------------------------------------------------------
# current_market_status
# --------------------------------------------------------------------------


def test_status_simulator_always_open(simulator_env: None) -> None:
    # Even if the actual time is a weekend, simulator says "open"
    assert current_market_status() == "open"


def test_status_massive_open_during_session(massive_env: None) -> None:
    dt = datetime(2026, 5, 5, 12, 0, tzinfo=NY_TZ)
    assert current_market_status(now=dt) == "open"


def test_status_massive_closed_outside_session(massive_env: None) -> None:
    dt = datetime(2026, 5, 5, 20, 0, tzinfo=NY_TZ)
    assert current_market_status(now=dt) == "closed"


def test_status_massive_closed_on_weekend(massive_env: None) -> None:
    dt = datetime(2026, 5, 9, 12, 0, tzinfo=NY_TZ)
    assert current_market_status(now=dt) == "closed"
