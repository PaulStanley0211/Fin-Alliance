"""Abstract interface for market data sources."""

from __future__ import annotations

from abc import ABC, abstractmethod


class UnsupportedTickerError(ValueError):
    """Raised by `add_ticker` when the data source rejects the ticker.

    The simulator allowlists 60 sector tickers; Finnhub rejects symbols it
    does not recognize. The API layer translates this into HTTP 400 with
    error code `ticker_unsupported`.
    """

    def __init__(self, ticker: str, reason: str = "ticker_unsupported") -> None:
        super().__init__(f"{reason}: {ticker}")
        self.ticker = ticker
        self.reason = reason


class MarketDataAuthError(RuntimeError):
    """Raised by `start` when the data source's API key is rejected.

    The factory uses this to decide whether to fall back to the simulator
    when a primary source can't authenticate at boot.
    """


class MarketDataSource(ABC):
    """Contract for market data providers.

    Implementations push price updates into a shared PriceCache on their own
    schedule. Downstream code never calls the data source directly for prices —
    it reads from the cache.

    Lifecycle:
        source = create_market_data_source(cache)
        await source.start(["AAPL", "GOOGL", ...])
        # ... app runs ...
        await source.add_ticker("TSLA")
        await source.remove_ticker("GOOGL")
        # ... app shutting down ...
        await source.stop()
    """

    @abstractmethod
    async def start(self, tickers: list[str]) -> None:
        """Begin producing price updates for the given tickers.

        Starts a background task that periodically writes to the PriceCache.
        Must be called exactly once. Calling start() twice is undefined behavior.
        """

    @abstractmethod
    async def stop(self) -> None:
        """Stop the background task and release resources.

        Safe to call multiple times. After stop(), the source will not write
        to the cache again.
        """

    @abstractmethod
    async def add_ticker(self, ticker: str) -> None:
        """Add a ticker to the active set. No-op if already present.

        The next update cycle will include this ticker.
        """

    @abstractmethod
    async def remove_ticker(self, ticker: str) -> None:
        """Remove a ticker from the active set. No-op if not present.

        Also removes the ticker from the PriceCache.
        """

    @abstractmethod
    def get_tickers(self) -> list[str]:
        """Return the current list of actively tracked tickers."""
