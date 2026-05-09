"""Tests for market data source factory."""

import os
from unittest.mock import AsyncMock, patch

import pytest

from app.market import finnhub_client as finnhub_module
from app.market.cache import PriceCache
from app.market.factory import create_and_start, create_market_data_source
from app.market.finnhub_client import FinnhubDataSource
from app.market.interface import MarketDataAuthError
from app.market.massive_client import MassiveDataSource
from app.market.simulator import SimulatorDataSource


class TestFactory:
    """Tests for create_market_data_source factory."""

    def test_creates_simulator_when_no_api_key(self):
        """Simulator when neither real-data key is set."""
        cache = PriceCache()

        with patch.dict(os.environ, {}, clear=True):  # no real-data keys
            source = create_market_data_source(cache)

        assert isinstance(source, SimulatorDataSource)

    def test_creates_simulator_when_api_key_empty(self):
        """Simulator when MASSIVE_API_KEY is empty (and no Finnhub key)."""
        cache = PriceCache()

        with patch.dict(os.environ, {"MASSIVE_API_KEY": ""}, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, SimulatorDataSource)

    def test_creates_simulator_when_api_key_whitespace(self):
        """Simulator when MASSIVE_API_KEY is whitespace (and no Finnhub key)."""
        cache = PriceCache()

        with patch.dict(os.environ, {"MASSIVE_API_KEY": "   "}, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, SimulatorDataSource)

    def test_creates_massive_when_api_key_set(self):
        """Test that Massive client is created when MASSIVE_API_KEY is set."""
        cache = PriceCache()

        with patch.dict(os.environ, {"MASSIVE_API_KEY": "test-key"}, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, MassiveDataSource)

    def test_massive_receives_api_key(self):
        """Test that Massive client receives the API key."""
        cache = PriceCache()

        with patch.dict(os.environ, {"MASSIVE_API_KEY": "test-key-123"}, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, MassiveDataSource)
        assert source._api_key == "test-key-123"

    def test_simulator_receives_cache(self):
        """Test that simulator receives the cache reference."""
        cache = PriceCache()

        with patch.dict(os.environ, {}, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, SimulatorDataSource)
        assert source._cache is cache

    def test_massive_receives_cache(self):
        """Test that Massive client receives the cache reference."""
        cache = PriceCache()

        with patch.dict(os.environ, {"MASSIVE_API_KEY": "test-key"}, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, MassiveDataSource)
        assert source._cache is cache

    def test_finnhub_takes_precedence_over_massive(self):
        """Finnhub key wins when both Finnhub and Massive are configured."""
        cache = PriceCache()
        env = {"FINNHUB_API_KEY": "fh-key", "MASSIVE_API_KEY": "mv-key"}

        with patch.dict(os.environ, env, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, FinnhubDataSource)
        assert source._api_key == "fh-key"

    def test_finnhub_chosen_when_only_finnhub_set(self):
        cache = PriceCache()

        with patch.dict(os.environ, {"FINNHUB_API_KEY": "fh-key"}, clear=True):
            source = create_market_data_source(cache)

        assert isinstance(source, FinnhubDataSource)


@pytest.mark.asyncio
class TestCreateAndStart:
    """Tests for the create_and_start helper used by lifespan."""

    async def test_finnhub_auth_failure_falls_back_to_simulator(self):
        cache = PriceCache()
        with patch.dict(os.environ, {"FINNHUB_API_KEY": "bad"}, clear=True):
            with patch.object(
                FinnhubDataSource,
                "start",
                AsyncMock(side_effect=MarketDataAuthError("bad token")),
            ):
                with patch.object(FinnhubDataSource, "stop", AsyncMock()):
                    with patch.object(SimulatorDataSource, "start", AsyncMock()):
                        source = await create_and_start(cache, ["AAPL"])
        assert isinstance(source, SimulatorDataSource)

    async def test_create_and_start_without_finnhub_returns_started_simulator(self):
        cache = PriceCache()
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(SimulatorDataSource, "start", AsyncMock()) as start_mock:
                source = await create_and_start(cache, ["AAPL"])
        assert isinstance(source, SimulatorDataSource)
        start_mock.assert_awaited_once_with(["AAPL"])

    async def test_create_and_start_finnhub_success(self):
        cache = PriceCache()
        with patch.dict(os.environ, {"FINNHUB_API_KEY": "good"}, clear=True):
            with patch.object(
                FinnhubDataSource, "start", AsyncMock()
            ) as start_mock:
                source = await create_and_start(cache, ["AAPL", "MSFT"])
        assert isinstance(source, FinnhubDataSource)
        start_mock.assert_awaited_once_with(["AAPL", "MSFT"])
        assert finnhub_module.FINNHUB_WS_URL_TEMPLATE.startswith("wss://")
