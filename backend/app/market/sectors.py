"""Sector taxonomy: 5 sectors x 10 tickers = 50 stocks.

Frozen taxonomy. The frontend renders a `SectorWatchlist` grouped by these
sectors and the lifespan starts the market data source against
`ALL_SECTOR_TICKERS` so every sector ticker streams live from boot.

Per the redesign spec (`docs/superpowers/specs/2026-05-09-finally-redesign-design.md` §4):
- 50 tickers, no duplicates across sectors. (Was 60 in v1.0; the
  Materials sector was dropped in v1.1 to fit Finnhub's free-tier
  50-symbol WebSocket cap — see task #14.)
- `SECTORS_VERSION` is bumped on any change so the frontend can detect a stale cache.
- The simulator's seed prices and per-ticker GBM params (in `seed_prices.py`)
  must cover every ticker listed here.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Sector:
    """A named group of tickers shown together in the watchlist.

    `id` is the stable machine-readable key (used by the frontend to keep
    open/closed state in localStorage). `label` is the human-readable
    display name. `tickers` is an ordered list — the frontend preserves
    that order in the UI.
    """

    id: str
    label: str
    tickers: tuple[str, ...]


SECTORS_VERSION = "1.1"


SECTORS: tuple[Sector, ...] = (
    Sector(
        id="technology",
        label="Technology",
        tickers=(
            "AAPL", "MSFT", "GOOGL", "AMZN", "META",
            "NVDA", "AVGO", "ORCL", "CRM", "ADBE",
        ),
    ),
    Sector(
        id="healthcare",
        label="Healthcare",
        tickers=(
            "UNH", "JNJ", "LLY", "PFE", "ABBV",
            "MRK", "TMO", "ABT", "DHR", "BMY",
        ),
    ),
    Sector(
        id="financial",
        label="Financial",
        tickers=(
            "JPM", "BAC", "WFC", "GS", "MS",
            "C", "BLK", "AXP", "V", "MA",
        ),
    ),
    Sector(
        id="consumer",
        label="Consumer",
        tickers=(
            "WMT", "COST", "HD", "MCD", "NKE",
            "SBUX", "TGT", "LOW", "DIS", "PG",
        ),
    ),
    Sector(
        id="energy",
        label="Energy",
        tickers=(
            "XOM", "CVX", "COP", "SLB", "EOG",
            "PSX", "MPC", "OXY", "VLO", "WMB",
        ),
    ),
)


def all_tickers() -> list[str]:
    """Flat list of every ticker across all sectors, in declaration order."""
    return [t for s in SECTORS for t in s.tickers]


def sector_for_ticker(ticker: str) -> Sector | None:
    """Return the sector containing `ticker`, or None if it isn't in the taxonomy."""
    upper = ticker.upper().strip()
    for sector in SECTORS:
        if upper in sector.tickers:
            return sector
    return None


# Public, eagerly-computed convenience constants.
ALL_SECTOR_TICKERS: tuple[str, ...] = tuple(all_tickers())
SECTOR_TICKER_SET: frozenset[str] = frozenset(ALL_SECTOR_TICKERS)


__all__ = [
    "Sector",
    "SECTORS",
    "SECTORS_VERSION",
    "ALL_SECTOR_TICKERS",
    "SECTOR_TICKER_SET",
    "all_tickers",
    "sector_for_ticker",
]
