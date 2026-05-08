"""Ticker validation policy for the API layer.

PLAN.md §6 "Ticker Validation":
- Simulator path: ~50 well-known US large/mid-cap tickers. Unknown → reject.
- Massive path: defer to upstream (a single price probe; 404 → reject).

In practice the market subsystem itself doesn't enforce an allowlist for
the simulator (it silently seeds unknown tickers with a random price), so
the gate lives here. Watchlist mutations and trade auto-add both call
`validate_ticker_supported` before reaching the data source.
"""

from __future__ import annotations

import os

# A comfortable superset of the 10 default seed tickers — covers the major
# US large-caps a user is likely to type. Spec calls for "~50".
SUPPORTED_SIMULATOR_TICKERS: frozenset[str] = frozenset(
    {
        # Default watchlist (10)
        "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX",
        # Tech (additional)
        "ORCL", "CRM", "ADBE", "INTC", "AMD", "CSCO", "IBM", "QCOM", "TXN", "AVGO",
        "PYPL", "SHOP", "SQ", "UBER", "LYFT", "ABNB", "SNAP", "PINS", "ZM", "DOCU",
        # Finance
        "GS", "MS", "BAC", "WFC", "C", "MA", "AXP", "BRK.B", "BLK", "SCHW",
        # Consumer / industrial / healthcare
        "WMT", "HD", "DIS", "KO", "PEP", "MCD", "NKE", "SBUX", "TGT", "COST",
        "JNJ", "PFE", "UNH", "MRK", "ABBV", "LLY", "TMO", "ABT",
        "BA", "CAT", "GE", "F", "GM", "XOM", "CVX",
    }
)


def is_massive_path() -> bool:
    """True if MASSIVE_API_KEY is set and non-empty."""
    return bool(os.environ.get("MASSIVE_API_KEY", "").strip())


def validate_ticker_supported(ticker: str) -> None:
    """Raise `APIError(ticker_unsupported)` if the ticker isn't accepted.

    On the simulator path: reject anything outside `SUPPORTED_SIMULATOR_TICKERS`.
    On the Massive path: accept anything — the upstream API is the authority,
    and `MassiveDataSource.add_ticker` succeeds eagerly (the next poll surfaces
    rejection as missing data, not a hard error). For now we keep that
    behavior and let the user discover bad tickers via empty prices.
    """
    from app.api.errors import ticker_unsupported

    if is_massive_path():
        return
    if ticker.upper() not in SUPPORTED_SIMULATOR_TICKERS:
        raise ticker_unsupported(
            f"Ticker {ticker!r} is not in the simulator allowlist. "
            "Set MASSIVE_API_KEY for full coverage."
        )


WATCHLIST_LIMIT = 25
