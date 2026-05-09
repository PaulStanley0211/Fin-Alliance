"""Factory for creating market data sources.

Provider precedence (highest first):

1. `FINNHUB_API_KEY` -> FinnhubDataSource (real-time WebSocket trades).
2. `MASSIVE_API_KEY` -> MassiveDataSource (Polygon REST polling).
3. otherwise -> SimulatorDataSource (GBM fallback).

Finnhub authentication failures at startup degrade gracefully to the
simulator so the dashboard always has streaming data, even if the user's
key is bad.
"""

from __future__ import annotations

import logging
import os

from .cache import PriceCache
from .finnhub_client import FinnhubDataSource
from .interface import MarketDataAuthError, MarketDataSource
from .massive_client import MassiveDataSource
from .simulator import SimulatorDataSource

logger = logging.getLogger(__name__)


def create_market_data_source(price_cache: PriceCache) -> MarketDataSource:
    """Pick a source per the precedence rules above.

    The returned source has not yet been started. Use `create_and_start`
    when you also want graceful Finnhub auth fallback to the simulator.
    """
    finnhub_key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if finnhub_key:
        logger.info("Market data source: Finnhub WebSocket (real-time)")
        return FinnhubDataSource(api_key=finnhub_key, price_cache=price_cache)

    massive_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if massive_key:
        logger.info("Market data source: Massive REST (Polygon)")
        return MassiveDataSource(api_key=massive_key, price_cache=price_cache)

    logger.info("Market data source: GBM Simulator")
    return SimulatorDataSource(price_cache=price_cache)


async def create_and_start(
    price_cache: PriceCache,
    tickers: list[str],
) -> MarketDataSource:
    """Create the configured source AND start it, falling back on auth errors.

    If Finnhub is configured but rejects the token, log a warning and
    transparently start a `SimulatorDataSource` instead so the app boots
    cleanly. Other failure types (network, timeout) are bubbled.
    """
    source = create_market_data_source(price_cache)
    try:
        await source.start(tickers)
        return source
    except MarketDataAuthError as e:
        if isinstance(source, FinnhubDataSource):
            logger.error(
                "Finnhub auth rejected (%s); falling back to simulator",
                e,
            )
            await source.stop()
            fallback = SimulatorDataSource(price_cache=price_cache)
            await fallback.start(tickers)
            return fallback
        raise
