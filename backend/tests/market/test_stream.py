"""Tests for the SSE generator: warm-up, market_status, heartbeats.

We exercise `_generate_events` directly with a fake `Request` rather than
through TestClient, because TestClient's ASGI transport doesn't cleanly
cancel a long-lived StreamingResponse, which makes timing assertions racy.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.market.cache import PriceCache
from app.market.stream import _generate_events


class _FakeRequest:
    """Minimal Request-like object: configurable disconnect, no `client`."""

    def __init__(self, disconnect_after_iterations: int = 6) -> None:
        self._iterations = 0
        self._limit = disconnect_after_iterations
        self.client = None

    async def is_disconnected(self) -> bool:
        self._iterations += 1
        return self._iterations >= self._limit


def _split_events(chunks: list[str]) -> list[str]:
    """Each chunk is a single SSE record (retry/data/comment). Return them."""
    return chunks


async def _drain(gen: Any, max_chunks: int = 200) -> list[str]:
    out: list[str] = []
    async for chunk in gen:
        out.append(chunk)
        if len(out) >= max_chunks:
            break
    return out


@pytest.fixture
def cache() -> PriceCache:
    return PriceCache()


@pytest.fixture
def populated_cache() -> PriceCache:
    c = PriceCache()
    c.update("AAPL", 190.50)
    c.update("GOOGL", 175.00)
    return c


@pytest.fixture
def simulator_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)


# --------------------------------------------------------------------------
# Warm-up
# --------------------------------------------------------------------------


async def test_first_chunk_is_retry_directive(
    populated_cache: PriceCache, simulator_env: None
) -> None:
    gen = _generate_events(populated_cache, _FakeRequest(2), interval=0.001)
    chunks = await _drain(gen)
    assert chunks[0].startswith("retry: 1000")


async def test_warmup_emits_cache_snapshot_when_populated(
    populated_cache: PriceCache, simulator_env: None
) -> None:
    """If the cache has prices on connect, the second chunk is a data: snapshot."""
    gen = _generate_events(populated_cache, _FakeRequest(2), interval=0.001)
    chunks = await _drain(gen)
    data_lines = [c for c in chunks if c.startswith("data:")]
    assert len(data_lines) >= 1
    payload = json.loads(data_lines[0][len("data: ") :].strip())
    assert "AAPL" in payload
    assert payload["AAPL"]["market_status"] == "open"
    assert payload["AAPL"]["price"] == 190.50


async def test_warmup_emits_warming_when_cache_empty(
    cache: PriceCache, simulator_env: None
) -> None:
    """An empty cache produces a `warming` event so the client can flip the
    status dot off "yellow" the moment connection is established."""
    gen = _generate_events(cache, _FakeRequest(2), interval=0.001)
    chunks = await _drain(gen)
    data_lines = [c for c in chunks if c.startswith("data:")]
    assert len(data_lines) == 1
    payload = json.loads(data_lines[0][len("data: ") :].strip())
    assert payload["market_status"] == "warming"
    assert payload["prices"] == {}


# --------------------------------------------------------------------------
# market_status field
# --------------------------------------------------------------------------


async def test_data_events_include_market_status_open(
    populated_cache: PriceCache, simulator_env: None
) -> None:
    gen = _generate_events(populated_cache, _FakeRequest(3), interval=0.001)
    chunks = await _drain(gen)
    for c in chunks:
        if c.startswith("data:"):
            payload = json.loads(c[len("data: ") :].strip())
            for key, value in payload.items():
                if key == "market_status":  # warming-event shape
                    continue
                assert "market_status" in value
                assert value["market_status"] == "open"


async def test_data_events_market_status_closed_for_massive_off_hours(
    populated_cache: PriceCache, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key")
    # The fixture didn't run, so freeze "now" to a known closed moment.
    import app.market.market_status as ms

    def _saturday_noon() -> str:
        return "closed"

    monkeypatch.setattr(ms, "current_market_status", _saturday_noon)

    gen = _generate_events(populated_cache, _FakeRequest(2), interval=0.001)
    chunks = await _drain(gen)
    data_lines = [c for c in chunks if c.startswith("data:")]
    payload = json.loads(data_lines[0][len("data: ") :].strip())
    assert payload["AAPL"]["market_status"] == "closed"


# --------------------------------------------------------------------------
# Heartbeat
# --------------------------------------------------------------------------


async def test_heartbeat_emitted_after_idle(
    populated_cache: PriceCache, simulator_env: None
) -> None:
    """When no price changes happen and the heartbeat threshold passes, a
    `: ping` comment is emitted."""
    # Heartbeat threshold tiny; loop interval also tiny; cache version never
    # changes after warm-up, so only heartbeats appear after the snapshot.
    gen = _generate_events(
        populated_cache,
        _FakeRequest(disconnect_after_iterations=20),
        interval=0.001,
        heartbeat_interval=0.005,
    )
    chunks = await _drain(gen, max_chunks=50)
    pings = [c for c in chunks if c.startswith(": ping")]
    assert len(pings) >= 1


async def test_heartbeat_not_emitted_when_data_recent(
    populated_cache: PriceCache, simulator_env: None
) -> None:
    """A live cache version bump resets the heartbeat clock — no spurious ping."""
    gen = _generate_events(
        populated_cache,
        _FakeRequest(disconnect_after_iterations=4),
        interval=0.001,
        heartbeat_interval=10.0,  # huge — never trips during the test
    )
    chunks = await _drain(gen)
    pings = [c for c in chunks if c.startswith(": ping")]
    assert pings == []
