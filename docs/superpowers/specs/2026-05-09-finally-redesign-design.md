# FinAlly UI Redesign + Real-Time Market Data — Design Spec

**Date:** 2026-05-09
**Status:** Approved by user (sector list confirmed, Finnhub-only for now, all 60 tickers visible on dashboard).
**Supersedes:** Layout sections of `planning/PLAN.md` (§10). Other sections of PLAN.md remain authoritative.

## 1. Goal

Reshape the FinAlly workstation around two ideas:

1. **Sectors as the organizing principle of the watchlist** — replace the dynamic, user-managed watchlist (current 25-cap) with a fixed taxonomy of 6 sectors × 10 tickers = 60 stocks streaming live at all times.
2. **Real, real-time market data** — switch the default streaming source from the GBM simulator to Finnhub's WebSocket API. Simulator stays as the no-key fallback.

Plus three smaller asks: portfolio heatmap returns (with subtler red/green than v1); Trade Bar gets a +/- stepper and pins below the chat; the app supports both dark and light themes.

## 2. Scope

**In:**
- New 6-sector × 10-ticker taxonomy (defined in backend, exposed via API).
- New Finnhub WebSocket client implementing the existing `MarketDataSource` interface.
- New `/api/sectors` endpoint.
- Removal of `/api/watchlist*` endpoints and the `watchlist` SQLite table.
- Frontend: new `SectorWatchlist` component, restored `PortfolioHeatmap` (replacing the v1 `PositionsList`), restyled `TradeBar` with +/- stepper, theme toggle in header.
- Light theme tokens (CSS-variable inversion of the existing dark theme).
- Backend tests for the new client + endpoint; frontend tests for the new components; E2E suite updated for the new layout.

**Out (deferred to follow-ups):**
- User-customizable sector definitions (taxonomy is hardcoded in the backend).
- Multiple-account support.
- Price alerts.
- Order types beyond market orders.
- Polygon/Massive client improvements (the existing code stays as-is; no debug pass on the user's old key).

## 3. Architecture overview

Single FastAPI container as before. Key changes:

```
┌─ Container (port 8000) ─────────────────────────────────────────────┐
│                                                                     │
│  FastAPI (lifespan)                                                 │
│   ├─ init_db() — schema + seed (no `watchlist` table)               │
│   ├─ build sector taxonomy (60 tickers from backend/sectors.py)     │
│   ├─ create_market_data_source(cache, tickers=all_60)               │
│   │     ├─ FinnhubDataSource (WebSocket, default when key set)      │
│   │     ├─ MassiveDataSource (Polygon REST, when MASSIVE_API_KEY)   │
│   │     └─ SimulatorDataSource (GBM, fallback)                      │
│   ├─ start snapshot writer                                          │
│   └─ mount routers: /api/{stream,portfolio,sectors,chat,health}     │
│                                                                     │
│  All 60 tickers stream from start; no add/remove API.               │
└─────────────────────────────────────────────────────────────────────┘
```

Provider selection precedence: `FINNHUB_API_KEY` > `MASSIVE_API_KEY` > simulator. Documented in `.env.example`.

## 4. Sector taxonomy

Defined in a new `backend/app/market/sectors.py`. Frozen list, version-tagged so the frontend can detect change:

```python
SECTORS_VERSION = "1.0"

SECTORS = [
    Sector("technology", "Technology", [
        "AAPL", "MSFT", "GOOGL", "AMZN", "META",
        "NVDA", "AVGO", "ORCL", "CRM", "ADBE",
    ]),
    Sector("healthcare", "Healthcare", [
        "UNH", "JNJ", "LLY", "PFE", "ABBV",
        "MRK", "TMO", "ABT", "DHR", "BMY",
    ]),
    Sector("financial", "Financial", [
        "JPM", "BAC", "WFC", "GS", "MS",
        "C", "BLK", "AXP", "V", "MA",
    ]),
    Sector("consumer", "Consumer", [
        "WMT", "COST", "HD", "MCD", "NKE",
        "SBUX", "TGT", "LOW", "DIS", "PG",
    ]),
    Sector("materials", "Materials", [
        "LIN", "SHW", "APD", "ECL", "FCX",
        "NEM", "NUE", "DOW", "DD", "PPG",
    ]),
    Sector("energy", "Energy", [
        "XOM", "CVX", "COP", "SLB", "EOG",
        "PSX", "MPC", "OXY", "VLO", "WMB",
    ]),
]
```

Total: 60 tickers, no duplicates across sectors. The simulator's seed-price + GBM-param table extends to cover all 60 (currently covers ~10).

## 5. Real-time market data: Finnhub client

`backend/app/market/finnhub_client.py` — implements `MarketDataSource`. Connection model: WebSocket (`wss://ws.finnhub.io?token=...`).

**Lifecycle:**
- `start(tickers)` — open WS, send one `{"type":"subscribe","symbol":<T>}` frame per ticker, hold connection open. Auto-reconnect with exponential backoff (1s → 30s cap).
- `add_ticker(t)` / `remove_ticker(t)` — send subscribe/unsubscribe frames over the existing connection.
  - Trade endpoint still calls `add_ticker` for any traded ticker not currently subscribed (defensive; with all 60 sector tickers pre-subscribed this is rarely hit). Tickers Finnhub doesn't recognize raise `UnsupportedTickerError` and the trade is rejected with `ticker_unsupported`, same as today.
  - Tickers added via `add_ticker` are NOT persisted; they live only in the active subscription set for the lifetime of the process. This is acceptable now that the watchlist concept is gone.
- `stop()` — close WS, cancel reconnect.

**Message handling:** Finnhub pushes `{type:"trade", data:[{p, s, t, v}]}`. For each entry, write `cache.update(symbol, price, timestamp)`. Cache versioning + SSE delta detection (already built) handles fan-out to clients unchanged.

**Market status:** Finnhub WS only delivers ticks during market hours. Reuse the existing `current_market_status()` (weekday 09:30–16:00 America/New_York → `open`, else `closed`) — the SSE serializer already injects this into every event. Heartbeat (15s `: ping`) already in place.

**Failure modes:**
- WS disconnect → reconnect with backoff, log warnings, eventually surface as `market_data: warming` in `/api/health`.
- Auth failure (401) → log error, fall through to simulator (graceful degrade rather than crash). Documented as a startup-only check.
- Rate-limit / backpressure → if Finnhub closes the connection citing the WS rate cap, fall back to the simulator and surface the reason via `/api/health`. 60 large-cap stocks should sit well under the documented limits.

**Health endpoint adjustment.** Today `/api/health` returns 503 if no tick has landed in the last 60s. With Finnhub the market is silent overnight and on weekends — that's *expected*, not an error. Update the readiness rule: if `current_market_status() == "closed"`, a stale cache is OK and health returns 200. If status is `"open"` and no tick in 60s, that's still 503. The simulator path is unaffected (it always reports `"open"` and always streams).

**Tests:** mock the Finnhub `websockets` client. Cover: subscribe-on-start, message → cache.update, reconnect on disconnect, graceful start failure → fallback to simulator. Target ~15 tests.

## 6. API changes

### Added
- `GET /api/sectors` — returns `{version, sectors: [{id, label, tickers: [...]}, ...]}`. Cached on the frontend; refetched only on version mismatch.

### Removed (breaking — frontend updated in same PR)
- `GET /api/watchlist`
- `POST /api/watchlist`
- `DELETE /api/watchlist/{ticker}`

### Updated (existing endpoints, behavior tweaks)
- `POST /api/chat` — body / wire envelope unchanged. Behavior tweak: the LLM **executor** short-circuits any `watchlist_changes` actions emitted by the model with `{status: "rejected", error: "watchlist_disabled"}`. The LLM **system prompt** is updated to stop suggesting watchlist actions in the first place. Both layers belt-and-braces; tested independently.
- `GET /api/health` — readiness rule extended for market-closed silence (see §5).

### Unchanged
- `GET /api/portfolio`, `POST /api/portfolio/trade`, `GET /api/portfolio/history`
- `GET /api/stream/prices` (still SSE; now streams the 60 sector tickers + any tickers added via `add_ticker` since startup)

### Schema
- Stop creating the `watchlist` table in new databases: remove its `CREATE TABLE` from `backend/db/schema.sql` and the seed-default-watchlist call from `init_db()`.
- Do **not** issue a `DROP TABLE` against existing v1 databases — they keep the orphan table harmlessly. The repository code that read it is removed in the same change.
- The `column-vs-table check` already implemented in `init_db()` tolerates the orphan table on existing DBs (it asserts required tables exist; doesn't reject extras).

## 7. UI layout

Three columns under a single header, per the agreed mockup:

```
┌────────── Header (cash, total, day P&L, status dot, market badge, theme toggle) ──────────┐
│                                                                                            │
│  SectorWatchlist  │              MainChart (selected ticker)                │  ChatPanel   │
│  ▾ Technology     │                                                          │              │
│    AAPL  $293.32  │                                                          │  conversation│
│    MSFT  $413.27  │                                                          │              │
│    ...            │                                                          │              │
│  ▾ Healthcare     │  ┌──── Heatmap ────┬──── PnL Chart ────┐                │              │
│    UNH   ...      │  │ red/green by    │ total $ over time │                │              │
│    ...            │  │ position P&L    │ 1h/1d/1w/1m/all   │                │              │
│  ▾ Financial      │  └─────────────────┴───────────────────┘                │              │
│    ...            │  ┌────────────── Open Positions ───────────────┐         ├──────────────┤
│  ▾ Consumer       │  │ ticker │ qty │ avg │ last │ P&L │ P&L %      │         │  Trade Bar   │
│    ...            │  └─────────────────────────────────────────────┘         │  AAPL │$293  │
│  ▾ Materials      │                                                          │  Qty: − 5 +   │
│    ...            │                                                          │  [Buy] [Sell] │
│  ▾ Energy         │                                                          │              │
│    ...            │                                                          │              │
└────────────────────┴─────────────────────────────────────────────────────────┴──────────────┘
```

Grid: CSS grid, `grid-template-columns: 280px 1fr 360px` at desktop. At tablet width: chat panel collapses to a slide-out drawer; heatmap and PnL stack vertically. Mobile is out of scope (workstation is desktop-first).

**Sector groups:** each group is a collapsible disclosure. Default open. Per-row: ticker / price (flash) / sector-relative day change %. Click a row → updates `useSelectedTicker()` (drives MainChart). Sectors persist their open/closed state in `localStorage`.

**Initial selected ticker:** `AAPL` (first ticker of first sector) so the MainChart isn't empty on first paint. Saved across reload via the same selection store.

## 8. Components: kept / replaced / removed

| File / Component | Disposition |
|---|---|
| `components/layout/HeaderBar.tsx` | Updated — adds theme toggle |
| `components/watchlist/WatchlistPanel.tsx` | **Removed** |
| `components/watchlist/SectorWatchlist.tsx` | **New** — 6 collapsible groups, 60 rows |
| `components/charts/MainChart.tsx` | Kept |
| `components/charts/PortfolioHeatmap.tsx` | **Restored** with subtler treatment (see §9) |
| `components/positions/PositionsList.tsx` | **Removed** (heatmap takes its panel) |
| `components/positions/PositionsTable.tsx` | Kept — this is the "Open Positions" section |
| `components/charts/PnLChart.tsx` | Kept |
| `components/trade/TradeBar.tsx` | Restyled — +/- stepper, larger Buy/Sell buttons below qty |
| `components/chat/ChatPanel.tsx` | Kept; layout shifts so TradeBar docks below it in the right column |
| `lib/watchlist.ts` (frontend store) | **Removed** |
| `lib/sectors.ts` (frontend store) | **New** — fetches `/api/sectors` once, caches in memory |
| `lib/theme.ts` (frontend store) | **New** — toggles `data-theme="light\|dark"` on `<html>`, persists to localStorage |
| `components/chat/ChatPanel.tsx` action receipts | Updated — `watchlist-disabled` rejections render with a muted "watchlist actions are disabled" line rather than the trade-style error chip |

## 9. Heatmap design

The earlier heatmap was removed because the saturated green/red surface fills felt heavy. The new version keeps the treemap shape but pulls the color treatment back:

- Surface: very dark neutral panel (matches `bg-1` token), no per-cell color flood.
- P&L direction shown by a 2px **left-edge rail** (existing `up`/`down` accent variants — already used on PositionsList rows).
- P&L magnitude shown by a small inline numeric label (e.g. `+1.2%` / `−3.4%`) with subdued tinted text (the same low-saturation `up`/`down` ink colors).
- Rectangle area still encodes portfolio weight.
- Hover → soft surface lift + tooltip with full details.
- `data-testid`: `region-heatmap`, `heatmap-cell-{TICKER}`, `heatmap-cell-pnl-{TICKER}`, `heatmap-cell-rail-{TICKER}` (carries `data-direction="up|down|flat"`).

This matches the user feedback ("indicate red/green … but no green texture background"): the *signal* is red/green, the *surface* is not.

## 10. Light theme

CSS-variable approach in `app/globals.css`:

```css
:root[data-theme="dark"] { /* current tokens — bg-0 #0d1117, bg-1 #1a1a2e, ... */ }
:root[data-theme="light"] {
  --bg-0: #f4f1ea;       /* paper, warm-neutral */
  --bg-1: #ffffff;       /* panel surface */
  --bg-2: #f0ebe1;       /* tape strip */
  --line-soft: #d9d2c4;
  --line-firm: #c4bcab;
  --ink-0: #1a1a2e;       /* primary text — same hue as dark bg, inverted */
  --ink-1: #3d3d52;
  --ink-2: #6b6b7a;
  --ink-3: #9a9aa8;
  --accent: #c98e08;      /* same yellow, slightly desaturated */
  --primary: #1080b8;     /* same blue, slightly darker for contrast */
  --secondary: #5e2b75;   /* same purple, darker */
  --up: #1d7a3e;          /* green, less saturated than dark theme up */
  --down: #b04030;        /* red, less saturated */
}
```

All component styles already use the tokens. No per-component changes needed beyond the few places that use raw hex (audit in implementation).

Theme toggle: small icon button in the header, persists to `localStorage` under `finally:theme`. Default dark on first visit. Respects `prefers-color-scheme` only if no saved preference.

## 11. Testing

**Backend (target ~315 tests, +21 from current 294):**
- `tests/market/test_finnhub_client.py` — ~15 tests (subscribe, message handling, reconnect, fallback).
- `tests/market/test_sectors.py` — sector list integrity (60 unique tickers, all in seed prices).
- `tests/api/test_sectors.py` — endpoint shape, version field, sector ordering.
- Update `tests/api/test_watchlist.py` → delete (endpoint gone).
- Update existing tests where the watchlist table assumption leaks.

**Frontend (target ~78 tests, +12 from current 66):**
- `__tests__/sectorWatchlist.test.tsx` — 6 groups render, collapse persistence, click → selected ticker.
- `__tests__/portfolioHeatmap.test.tsx` — empty state, cell renders for each position, weight area calc, rail direction.
- `__tests__/themeToggle.test.tsx` — toggle changes `data-theme`, persists, hydrates from localStorage.
- `__tests__/tradeBarStepper.test.tsx` — − / + steps quantity, can't go below 1, Buy/Sell positioned below qty.

**E2E (target 18 scenarios, +2 from current 16):**
- Sector tabs / groups all visible on fresh load with their tickers.
- Theme toggle: click → page swaps to light, click → swaps back, persists across reload.

## 12. Migration & rollout

This is a single PR shipped end-to-end:
1. Backend lands first: sectors module, Finnhub client, `/api/sectors` endpoint, watchlist endpoints removed.
2. Frontend lands second: SectorWatchlist replaces WatchlistPanel, restored heatmap, themed components, restyled TradeBar.
3. Devops: bump `.env.example` with `FINNHUB_API_KEY` and the precedence note.
4. Integration tester runs the updated suite.

Existing user DBs survive (extra `watchlist` table is ignored). Existing portfolios and chat history persist. The 60-ticker default means anyone with a fresh DB sees the same starting state regardless of which provider is active.

## 13. Open questions / nits

None blocking. Items that can be decided during implementation:

- Sector group sort order: alphabetical vs by index weight vs by user-pinned. Default: as listed in §4 (Tech first — most familiar tickers).
- Heatmap minimum cell area: positions <0.5% portfolio weight may still need a visible cell. Render with min-width if so.
- Chat sidebar collapse on tablet: drawer vs side panel. Drawer is conventional; will pick during build.
