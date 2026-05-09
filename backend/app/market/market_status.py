"""Market-status calculation for SSE events.

Contract (PLAN.md §6 + 2026-05-09 redesign §5):
- Simulator: always `"open"` (the simulator never reports closed).
- Real-data sources (Finnhub, Massive): weekday 09:30–16:00 America/New_York
  -> `"open"`, else `"closed"`.
- `"warming"` is briefly seen on first launch before the first tick lands;
  the stream serializer decides this based on cache contents.

Holiday calendars are explicitly out of scope (PLAN.md §6).
"""

from __future__ import annotations

import os
from datetime import datetime, time
from typing import Literal
from zoneinfo import ZoneInfo

MarketStatus = Literal["open", "closed", "warming"]

NY_TZ = ZoneInfo("America/New_York")
MARKET_OPEN = time(9, 30)
MARKET_CLOSE = time(16, 0)


def is_real_data_path() -> bool:
    """True if a real-data provider is configured (Finnhub or Massive)."""
    if os.environ.get("FINNHUB_API_KEY", "").strip():
        return True
    if os.environ.get("MASSIVE_API_KEY", "").strip():
        return True
    return False


def is_massive_path() -> bool:
    """True if MASSIVE_API_KEY is set and non-empty.

    Kept for backwards compatibility with existing tests / call sites.
    Prefer `is_real_data_path` for new code.
    """
    return bool(os.environ.get("MASSIVE_API_KEY", "").strip())


def market_open_at(now: datetime) -> bool:
    """True if `now` (any timezone-aware datetime) lies in the NYSE session.

    Weekday 09:30–16:00 inclusive of open, exclusive of close — matches the
    convention most market-hours utilities use. `now` is converted to NY time.
    """
    ny = now.astimezone(NY_TZ)
    if ny.weekday() >= 5:  # Sat=5, Sun=6
        return False
    t = ny.time()
    return MARKET_OPEN <= t < MARKET_CLOSE


def current_market_status(now: datetime | None = None) -> MarketStatus:
    """Return `"open"` or `"closed"` based on the active data source and time.

    The `"warming"` state is *not* returned here — it's a stream-level concern
    that the SSE serializer adds when the price cache is still empty.
    """
    if not is_real_data_path():
        return "open"
    if now is None:
        now = datetime.now(tz=NY_TZ)
    return "open" if market_open_at(now) else "closed"
