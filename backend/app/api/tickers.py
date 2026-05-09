"""Ticker validation policy for the API layer.

Validation diverges by data source per the redesign spec §5:

- **Simulator path**: only the 60 tickers in the sector taxonomy
  (`app.market.sectors.SECTOR_TICKER_SET`) are accepted. Anything else is
  rejected with `ticker_unsupported`.
- **Real-data paths (Finnhub, Massive)**: defer to upstream — `add_ticker`
  either succeeds or the upstream source surfaces the rejection. The API
  layer accepts any non-empty symbol.

There is no longer a watchlist concept; the sector list is fixed at boot
and only `add_ticker` for an off-list symbol can extend the active stream
(used as a defensive fallback when the LLM trades a non-sector ticker).
"""

from __future__ import annotations

import os

from app.market.sectors import SECTOR_TICKER_SET

# Backwards-compat: the sector taxonomy is now the simulator allowlist.
SUPPORTED_SIMULATOR_TICKERS: frozenset[str] = SECTOR_TICKER_SET


def is_real_data_path() -> bool:
    """True if a real-data provider is configured (Finnhub or Massive)."""
    if os.environ.get("FINNHUB_API_KEY", "").strip():
        return True
    if os.environ.get("MASSIVE_API_KEY", "").strip():
        return True
    return False


def is_massive_path() -> bool:
    """True if MASSIVE_API_KEY is set. Kept for backwards compat — prefer
    `is_real_data_path` for new code."""
    return bool(os.environ.get("MASSIVE_API_KEY", "").strip())


def validate_ticker_supported(ticker: str) -> None:
    """Raise `APIError(ticker_unsupported)` if the ticker isn't accepted.

    Simulator path: must be in the sector taxonomy.
    Real-data path: accept and let upstream validate.
    """
    from app.api.errors import ticker_unsupported

    if is_real_data_path():
        return
    if ticker.upper() not in SECTOR_TICKER_SET:
        raise ticker_unsupported(
            f"Ticker {ticker!r} is not in the sector taxonomy. "
            "Set FINNHUB_API_KEY for full coverage."
        )


