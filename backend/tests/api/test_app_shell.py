"""Smoke tests for the FastAPI app shell wiring.

Verifies:
- App starts and shuts down cleanly via the lifespan (DB init, market source,
  snapshot writer, tick watcher all run).
- The SSE endpoint is mounted at /api/stream/prices and is reachable.
- The static-files mount serves index.html at /.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.state import get_state


def test_lifespan_initializes_state(client: TestClient) -> None:
    state = get_state()
    assert state.db_ready is True
    assert state.price_cache is not None
    assert state.market_source is not None
    assert state.snapshot_writer is not None


def test_lifespan_persisted_watchlist_seeded(client: TestClient, db_file: Path) -> None:
    """init_db seeds 10 default tickers; market source should be tracking them."""
    state = get_state()
    assert state.market_source is not None
    tickers = state.market_source.get_tickers()
    assert len(tickers) == 10
    assert "AAPL" in tickers
    assert "NFLX" in tickers


def test_sse_endpoint_registered(app) -> None:
    """The SSE route is mounted at the expected path.

    We assert structurally rather than hitting the endpoint — TestClient's
    ASGI transport doesn't cleanly cancel a long-lived StreamingResponse,
    which causes hangs even when the route is correct. The market module
    has its own integration tests that exercise the generator.
    """
    paths = {route.path for route in app.routes}
    assert "/api/stream/prices" in paths


def test_static_files_mounted(client: TestClient) -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    assert "FinAlly" in resp.text


def test_api_path_takes_precedence_over_static(app) -> None:
    """A request to /api/* must never 404 into the SPA bundle.

    Verified structurally: the SSE route exists with a higher priority than
    the StaticFiles mount at "/" because we register routers before the mount.
    """
    routes_in_order = [getattr(r, "path", None) for r in app.routes]
    sse_index = routes_in_order.index("/api/stream/prices")
    # The static-files mount sits at "/" (or it's absent in dev).
    if "/" in routes_in_order:
        static_index = routes_in_order.index("/")
        assert sse_index < static_index


def test_unknown_api_returns_404(client: TestClient) -> None:
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404


def test_static_dir_missing_does_not_break_app(
    tmp_path: Path, monkeypatch, db_file: Path
) -> None:  # noqa: ARG001
    """If frontend/out/ isn't built, the app should still boot."""
    from app import main as main_module
    from app.state import reset_state_for_tests

    monkeypatch.setattr(main_module, "STATIC_DIR", tmp_path / "nope")
    reset_state_for_tests()
    app = main_module.create_app()
    with TestClient(app) as c:
        # / should 404 because no static catch-all is mounted.
        assert c.get("/").status_code == 404
