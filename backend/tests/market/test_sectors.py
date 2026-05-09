"""Tests for the sector taxonomy.

The taxonomy is the contract between backend and frontend — these tests pin
the invariants that downstream code (lifespan, /api/sectors, simulator
seeds) relies on.
"""

from __future__ import annotations

import re

from app.market import sectors
from app.market.sectors import (
    ALL_SECTOR_TICKERS,
    SECTOR_TICKER_SET,
    SECTORS,
    SECTORS_VERSION,
    Sector,
    all_tickers,
    sector_for_ticker,
)
from app.market.seed_prices import SEED_PRICES, TICKER_PARAMS


class TestTaxonomyShape:
    def test_five_sectors(self):
        assert len(SECTORS) == 5

    def test_each_sector_has_ten_tickers(self):
        for sector in SECTORS:
            assert len(sector.tickers) == 10, sector.id

    def test_fifty_unique_tickers_total(self):
        flat = all_tickers()
        assert len(flat) == 50
        assert len(set(flat)) == 50  # no duplicates across sectors

    def test_all_sector_tickers_constant_matches(self):
        assert tuple(all_tickers()) == ALL_SECTOR_TICKERS
        assert SECTOR_TICKER_SET == frozenset(ALL_SECTOR_TICKERS)

    def test_expected_sector_ids(self):
        ids = [s.id for s in SECTORS]
        assert ids == [
            "technology",
            "healthcare",
            "financial",
            "consumer",
            "energy",
        ]

    def test_materials_sector_removed(self):
        """Materials was dropped in v1.1 to fit Finnhub's 50-symbol cap."""
        ids = [s.id for s in SECTORS]
        assert "materials" not in ids

    def test_sector_labels_are_human_readable(self):
        for sector in SECTORS:
            assert sector.label
            assert sector.label[0].isupper()


class TestVersion:
    def test_version_is_present(self):
        assert SECTORS_VERSION
        # semver-ish; either "1.0" / "1.0.0" / similar.
        assert re.match(r"^\d+\.\d+(\.\d+)?$", SECTORS_VERSION)


class TestSeedPriceCoverage:
    """All 50 sector tickers must have realistic seed prices and GBM params."""

    def test_every_ticker_has_seed_price(self):
        missing = [t for t in ALL_SECTOR_TICKERS if t not in SEED_PRICES]
        assert missing == [], f"Missing SEED_PRICES entries: {missing}"

    def test_every_ticker_has_gbm_params(self):
        missing = [t for t in ALL_SECTOR_TICKERS if t not in TICKER_PARAMS]
        assert missing == [], f"Missing TICKER_PARAMS entries: {missing}"

    def test_seed_prices_are_positive_and_reasonable(self):
        for ticker in ALL_SECTOR_TICKERS:
            price = SEED_PRICES[ticker]
            assert price > 0, ticker
            # Sanity bound — no $0 or absurd > $5000 prices in the seed list.
            assert 1.0 <= price <= 5000.0, f"{ticker} seed price {price}"

    def test_gbm_params_are_in_sane_ranges(self):
        for ticker in ALL_SECTOR_TICKERS:
            params = TICKER_PARAMS[ticker]
            assert 0.0 < params["sigma"] < 1.0, ticker
            assert -0.2 < params["mu"] < 0.5, ticker


class TestLookups:
    def test_sector_for_ticker_finds_each(self):
        for sector in SECTORS:
            for t in sector.tickers:
                found = sector_for_ticker(t)
                assert found is sector

    def test_sector_for_ticker_case_insensitive(self):
        assert sector_for_ticker("aapl") is SECTORS[0]
        assert sector_for_ticker(" AAPL ") is SECTORS[0]

    def test_sector_for_ticker_returns_none_for_unknown(self):
        assert sector_for_ticker("ZZZZZ") is None
        assert sector_for_ticker("TSLA") is None  # legacy seed, not in sectors


class TestSectorImmutable:
    def test_sector_is_frozen_dataclass(self):
        s = SECTORS[0]
        # Frozen dataclass: assigning fields must raise FrozenInstanceError.
        try:
            s.id = "other"  # type: ignore[misc]
        except Exception:
            return
        raise AssertionError("Sector should be frozen / immutable")

    def test_sector_tickers_is_tuple(self):
        for sector in SECTORS:
            assert isinstance(sector.tickers, tuple)


class TestPublicApi:
    """The module's exported names are part of the contract."""

    def test_module_exports(self):
        for name in [
            "Sector",
            "SECTORS",
            "SECTORS_VERSION",
            "ALL_SECTOR_TICKERS",
            "SECTOR_TICKER_SET",
            "all_tickers",
            "sector_for_ticker",
        ]:
            assert hasattr(sectors, name)

    def test_sector_dataclass_export(self):
        s = Sector(id="x", label="X", tickers=("AAA",))
        assert s.id == "x"
        assert s.tickers == ("AAA",)
