# FinAlly — AI Trading Workstation

## Project Specification

## 1. Vision

FinAlly (Finance Ally) is a visually stunning AI-powered trading workstation that streams live market data, lets users trade a simulated portfolio, and integrates an LLM chat assistant that can analyze positions and execute trades on the user's behalf. It looks and feels like a modern Bloomberg terminal with an AI copilot.

This is the capstone project for an agentic AI coding course. It is built entirely by Coding Agents demonstrating how orchestrated AI agents can produce a production-quality full-stack application. Agents interact through files in `planning/`.

## 2. User Experience

### First Launch

The user runs a single Docker command (or a provided start script). A browser opens to `http://localhost:8000`. No login, no signup. They immediately see:

- A watchlist of 10 default tickers with live-updating prices in a grid
- $10,000 in virtual cash
- A dark, data-rich trading terminal aesthetic
- An AI chat panel ready to assist

### What the User Can Do

- **Watch prices stream** — prices flash green (uptick) or red (downtick) with subtle CSS animations that fade
- **View sparkline mini-charts** — price action beside each ticker in the watchlist, accumulated on the frontend from the SSE stream since page load (sparklines fill in progressively)
- **Click a ticker** to see a larger detailed chart in the main chart area
- **Buy and sell shares** — market orders only, instant fill at current price, no fees, no confirmation dialog
- **Monitor their portfolio** — a heatmap (treemap) showing positions sized by weight and colored by P&L, plus a P&L chart tracking total portfolio value over time
- **View a positions table** — ticker, quantity, average cost, current price, unrealized P&L, % change
- **Chat with the AI assistant** — ask about their portfolio, get analysis, and have the AI execute trades and manage the watchlist through natural language
- **Manage the watchlist** — add/remove tickers manually or via the AI chat

### Visual Design

- **Dark theme**: backgrounds around `#0d1117` or `#1a1a2e`, muted gray borders, no pure black
- **Price flash animations**: brief green/red background highlight on price change, fading over ~500ms via CSS transitions
- **Connection status indicator**: a small colored dot (green = connected, yellow = reconnecting, red = disconnected) visible in the header
- **Professional, data-dense layout**: inspired by Bloomberg/trading terminals — every pixel earns its place
- **Responsive but desktop-first**: optimized for wide screens, functional on tablet

### Color Scheme
- Accent Yellow: `#ecad0a`
- Blue Primary: `#209dd7`
- Purple Secondary: `#753991` (submit buttons)

## 3. Architecture Overview

### Single Container, Single Port

```
┌─────────────────────────────────────────────────┐
│  Docker Container (port 8000)                   │
│                                                 │
│  FastAPI (Python/uv)                            │
│  ├── /api/*          REST endpoints             │
│  ├── /api/stream/*   SSE streaming              │
│  └── /*              Static file serving         │
│                      (Next.js export)            │
│                                                 │
│  SQLite database (volume-mounted)               │
│  Background task: market data polling/sim        │
└─────────────────────────────────────────────────┘
```

- **Frontend**: Next.js with TypeScript, built as a static export (`output: 'export'`), served by FastAPI as static files
- **Backend**: FastAPI (Python), managed as a `uv` project
- **Database**: SQLite, single file at `db/finally.db`, volume-mounted for persistence
- **Real-time data**: Server-Sent Events (SSE) — simpler than WebSockets, one-way server→client push, works everywhere
- **AI integration**: LiteLLM → Anthropic (Claude Haiku 4.5 by default), with structured outputs for trade execution
- **Market data**: Environment-variable driven — simulator by default, real data via Massive API if key provided

### Why These Choices

| Decision | Rationale |
|---|---|
| SSE over WebSockets | One-way push is all we need; simpler, no bidirectional complexity, universal browser support |
| Static Next.js export | Single origin, no CORS issues, one port, one container, simple deployment |
| SQLite over Postgres | No auth = no multi-user = no need for a database server; self-contained, zero config |
| Single Docker container | Students run one command; no docker-compose for production, no service orchestration |
| uv for Python | Fast, modern Python project management; reproducible lockfile; what students should learn |
| Market orders only | Eliminates order book, limit order logic, partial fills — dramatically simpler portfolio math |

---

## 4. Directory Structure

```
finally/
├── frontend/                 # Next.js TypeScript project (static export)
├── backend/                  # FastAPI uv project (Python)
│   └── db/                   # Schema definitions, seed data, migration logic
├── planning/                 # Project-wide documentation for agents
│   ├── PLAN.md               # This document — the shared contract
│   ├── MARKET_DATA_SUMMARY.md # Summary of the completed market data subsystem
│   └── archive/              # Superseded planning docs kept for history
├── scripts/
│   ├── start_mac.sh          # Launch Docker container (macOS/Linux)
│   ├── stop_mac.sh           # Stop Docker container (macOS/Linux)
│   ├── start_windows.ps1     # Launch Docker container (Windows PowerShell)
│   └── stop_windows.ps1      # Stop Docker container (Windows PowerShell)
├── test/                     # Playwright E2E tests + docker-compose.test.yml
├── db/                       # Bind-mount target (SQLite file lives here at runtime)
│   └── .gitkeep              # Directory exists in repo; finally.db is gitignored
├── Dockerfile                # Multi-stage build (Node → Python)
├── docker-compose.yml        # Optional convenience wrapper
├── .env                      # Environment variables (gitignored)
├── .env.example              # Committed template matching §5
└── .gitignore
```

### Key Boundaries

- **`frontend/`** is a self-contained Next.js project. It knows nothing about Python. It talks to the backend via `/api/*` endpoints and `/api/stream/*` SSE endpoints. Internal structure is up to the Frontend Engineer agent.
- **`backend/`** is a self-contained uv project with its own `pyproject.toml`. It owns all server logic including database initialization, schema, seed data, API routes, SSE streaming, market data, and LLM integration. Internal structure is up to the Backend/Market Data agents.
- **`backend/db/`** contains schema SQL definitions and seed logic. The backend lazily initializes the database on first request — creating tables and seeding default data if the SQLite file doesn't exist or is empty.
- **`db/`** at the top level is the runtime bind-mount target. The SQLite file (`db/finally.db`) is created here by the backend and persists across container restarts via the host bind mount described in §11.
- **`planning/`** contains project-wide documentation, including this plan. All agents reference files here as the shared contract.
- **`test/`** contains Playwright E2E tests and supporting infrastructure (e.g., `docker-compose.test.yml`). Unit tests live within `frontend/` and `backend/` respectively, following each framework's conventions.
- **`scripts/`** contains start/stop scripts that wrap Docker commands.

---

## 5. Environment Variables

```bash
# Required: Anthropic API key for LLM chat functionality
ANTHROPIC_API_KEY=your-anthropic-api-key-here

# Optional: Massive (Polygon.io) API key for real market data
# If not set, the built-in market simulator is used (recommended for most users)
MASSIVE_API_KEY=

# Optional: Set to "true" for deterministic mock LLM responses (testing)
LLM_MOCK=false
```

### Behavior

- If `MASSIVE_API_KEY` is set and non-empty → backend uses Massive REST API for market data
- If `MASSIVE_API_KEY` is absent or empty → backend uses the built-in market simulator
- If `LLM_MOCK=true` → backend returns deterministic mock LLM responses (for E2E tests)
- The backend reads `.env` from the project root (mounted into the container or read via docker `--env-file`)

---

## 6. Market Data

### Two Implementations, One Interface

Both the simulator and the Massive client implement the same abstract interface. The backend selects which to use based on the environment variable. All downstream code (SSE streaming, price cache, frontend) is agnostic to the source.

### Simulator (Default)

- Generates prices using geometric Brownian motion (GBM) with configurable drift and volatility per ticker
- Updates at ~500ms intervals
- Correlated moves across tickers (e.g., tech stocks move together)
- Occasional random "events" — sudden 2-5% moves on a ticker for drama
- Starts from realistic seed prices (e.g., AAPL ~$190, GOOGL ~$175, etc.)
- Runs as an in-process background task — no external dependencies

### Massive API (Optional)

- REST API polling (not WebSocket) — simpler, works on all tiers
- Polls for the union of all watched tickers on a configurable interval
- Free tier (5 calls/min): poll every 15 seconds
- Paid tiers: poll every 2-15 seconds depending on tier
- Parses REST response into the same format as the simulator

### Shared Price Cache

- A single background task (simulator or Massive poller) writes to an in-memory price cache
- The cache holds the latest price, previous price, and timestamp for each ticker
- SSE streams read from this cache and push updates to connected clients
- This architecture supports future multi-user scenarios without changes to the data layer

### SSE Streaming

- Endpoint: `GET /api/stream/prices`
- Long-lived SSE connection; client uses native `EventSource` API
- Server pushes price updates for all tickers known to the system at a regular cadence (~500ms) — in the single-user model this is equivalent to the user's watchlist
- Cadence is bounded by the underlying source: the simulator updates every ~500ms, but on the Massive free tier the cache only refreshes every 15s, so the SSE stream will repeat the last value (or skip emission via the cache's version counter) until the next poll lands
- Each SSE event contains `ticker`, `price`, `previous_price`, `timestamp`, `direction` (`"up" | "down" | "flat"`), and `market_status` (see "Market Status" below)
- **Warm-up**: on connection, the server immediately emits one event per ticker currently in the price cache. If the cache is empty (fresh container, no first tick yet), no events are sent until the data source produces them. The connection-status dot stays yellow until the first event arrives.
- **Heartbeat**: every 15s the server emits an SSE comment line (`: ping\n\n`) so middleboxes (App Runner, CDNs) don't sever an "idle" connection during quiet periods or outside market hours
- Client handles reconnection automatically (EventSource has built-in retry)

### Market Status

Each price update carries a `market_status` field with one of:

- `"open"` — prices are actively moving (simulator: always; Massive: weekday 09:30–16:00 America/New_York)
- `"closed"` — prices are static; the cache returns the most recent close. The frontend should suppress flash animations and show a "Market Closed" badge in the header.
- `"warming"` — connection is up but no data has arrived yet (only seen briefly on first launch)

Holiday calendars are out of scope: only weekday + time-of-day is checked. The simulator never reports `closed`.

### Watchlist Wiring

- The market data source exposes `add_ticker` / `remove_ticker` (see `MARKET_DATA_SUMMARY.md`)
- `POST /api/watchlist` and `POST /api/portfolio/trade` are the only paths that grow the active ticker set; `DELETE /api/watchlist/{ticker}` shrinks it
- After a successful database mutation the API calls `add_ticker` / `remove_ticker` so the new ticker starts streaming immediately or stops being polled
- The simulator seeds new tickers with a default seed price; Massive picks them up on the next poll cycle

### Ticker Validation

The two data sources have different opinions on what counts as a valid ticker, so validation lives at the data source:

- **Simulator path** — supports a fixed allowlist of ~50 well-known US large/mid-cap tickers with realistic seed prices and per-ticker GBM params. Tickers outside the allowlist are rejected by `add_ticker` with `UnsupportedTickerError`, surfaced as `HTTP 400` to the API caller with body `{"error": "ticker_unsupported", "message": "Set MASSIVE_API_KEY for full coverage."}`. The seed list (§7) is a subset of this allowlist.
- **Massive path** — defers to the upstream API. `add_ticker("XYZ")` triggers a single price probe; on a successful response the ticker is accepted, on `404` it is rejected with the same `ticker_unsupported` error shape so frontend code is source-agnostic.
- **Watchlist size cap** — hard cap of 25 tickers regardless of source. Beyond that, `POST /api/watchlist` returns `HTTP 400` with `{"error": "watchlist_full"}`. The cap keeps the Massive free-tier 5-calls/min budget viable and the SSE payload small enough to transmit at 500 ms cadence.

---

## 7. Database

### SQLite Initialization

Schema creation and seeding run inside FastAPI's `lifespan` startup, before the app accepts any traffic and before the price-cache, market-data poller, and 30 s snapshot writer are started. If the SQLite file is missing or the tables don't exist yet, the schema is created and default data (§7 "Default Seed Data" plus an initial `portfolio_snapshots` row anchoring the P&L chart at the starting cash balance) is inserted. This means:

- No separate migration step
- No manual database setup
- Fresh Docker volumes start with a clean, seeded database automatically
- Background tasks (snapshot writer, market-data poller) never race against an unseeded DB or an in-flight schema create — they only start after `lifespan` startup has completed

### Schema

All tables include a `user_id` column defaulting to `"default"`. This is hardcoded for now (single-user) but enables future multi-user support without schema migration.

**users_profile** — User state (cash balance)
- `id` TEXT PRIMARY KEY (default: `"default"`)
- `cash_balance` REAL (default: `10000.0`)
- `created_at` TEXT (ISO timestamp)

**watchlist** — Tickers the user is watching
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `ticker` TEXT
- `added_at` TEXT (ISO timestamp)
- UNIQUE constraint on `(user_id, ticker)`

**positions** — Current holdings (one row per ticker per user)
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `ticker` TEXT
- `quantity` REAL (fractional shares supported)
- `avg_cost` REAL
- `updated_at` TEXT (ISO timestamp)
- UNIQUE constraint on `(user_id, ticker)`

Cost-basis rules:
- **Buy adding to existing position**: `new_avg_cost = (old_qty × old_avg_cost + buy_qty × buy_price) / (old_qty + buy_qty)`; `quantity` increases by `buy_qty`.
- **Buy creating new position**: insert a row with `avg_cost = buy_price`, `quantity = buy_qty`.
- **Sell (any quantity)**: `avg_cost` is *unchanged*; `quantity` decreases by `sell_qty`. If the resulting `quantity` is zero (or within a 1e-9 epsilon for fractional-share rounding), the row is **deleted** so the positions table only contains live holdings.

**trades** — Trade history (append-only log)
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `ticker` TEXT
- `side` TEXT (`"buy"` or `"sell"`)
- `quantity` REAL (fractional shares supported)
- `price` REAL
- `cost_basis` REAL — the position's `avg_cost` *at the moment this trade executed*. Captured for both sides; for sells this is the basis used for realized P&L; for buys it equals the new `avg_cost` after this buy is applied (useful for audit / replay). Nullable only on rows written before this column existed.
- `executed_at` TEXT (ISO timestamp)

Realized P&L for a single sell trade is `(price - cost_basis) × quantity`. The `/api/portfolio` endpoint surfaces the running total (sum across all sell trades) — see §8.

**portfolio_snapshots** — Portfolio value over time (for P&L chart). Recorded every 30 seconds by a background task, immediately after each trade execution, and **once at `lifespan` startup** if the table is empty for the user (anchor point so the chart has at least one data point on first launch). Snapshots are written unconditionally (no dedupe even when value is unchanged) — at ~2,880 rows/day (~1 MB/year) this is intentionally simple and not worth optimizing.
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `total_value` REAL
- `recorded_at` TEXT (ISO timestamp)

**chat_messages** — Conversation history with LLM
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `role` TEXT (`"user"` or `"assistant"`)
- `content` TEXT
- `actions` TEXT (JSON; null for user messages and for assistant messages with no side-effects)
- `created_at` TEXT (ISO timestamp)

`actions` JSON shape (assistant messages only):

```json
{
  "trades": [
    {"ticker": "AAPL", "side": "buy", "quantity": 10, "status": "executed", "price": 190.50, "error": null}
  ],
  "watchlist_changes": [
    {"ticker": "PYPL", "action": "add", "status": "executed", "error": null}
  ]
}
```

`status` is `"executed"` or `"rejected"`; `error` is a short reason string (`"insufficient_cash"`, `"insufficient_shares"`, `"ticker_unsupported"`, `"watchlist_full"`, …) or `null`. The shape mirrors the `/api/chat` response (§9) so the frontend can render replayed history identically to a live response.

### Default Seed Data

- One user profile: `id="default"`, `cash_balance=10000.0`
- Ten watchlist entries: AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM, V, NFLX

---

## 8. API Endpoints

### Market Data
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stream/prices` | SSE stream of live price updates |

### Portfolio
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/portfolio` | Current positions, cash balance, total value, unrealized P&L, **realized P&L total** (sum of `(price − cost_basis) × quantity` across all sell trades) |
| POST | `/api/portfolio/trade` | Execute a trade: `{ticker, quantity, side, request_id?}`. If the ticker is not on the watchlist it is auto-added (subject to the same validation as `POST /api/watchlist`); rejected tickers fail the trade with the same `ticker_unsupported` error. This means "buy 10 PYPL" works as a single user gesture (or a single LLM action) without a separate watchlist step. **Idempotency**: an optional `request_id` (UUID) dedupes within a single `user_id`. If a trade with the same `(user_id, request_id)` already exists, the original trade record is returned (200 OK) without re-executing. The frontend should also disable Buy/Sell while a request is in flight. LLM-initiated trades skip `request_id` (each chat turn is its own one-shot loop). |
| GET | `/api/portfolio/history` | Portfolio value snapshots over time (for P&L chart). Accepts an optional `range` query param (`1h`, `1d`, `1w`, `1m`, `all`); default is `1d`. |

### Watchlist
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/watchlist` | Current watchlist tickers with latest prices |
| POST | `/api/watchlist` | Add a ticker: `{ticker}` |
| DELETE | `/api/watchlist/{ticker}` | Remove a ticker |

### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send a message, receive complete JSON response (message + executed actions) |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Combined liveness + readiness check. Returns `200` with `{"status": "ok", "db": "ready", "market_data": "running" \| "warming"}` once the database is initialized and the market-data background task is producing ticks. Returns `503` with the same shape (substituting `"error"` for the failing component) if DB init failed, the data source crashed, or no tick has landed within the last 60 s. Container orchestrators should treat 200 as "route traffic". |

---

## 9. LLM Integration

When writing code to make calls to LLMs, use the `claude-llm` skill to call Claude (Anthropic) via LiteLLM, with Structured Outputs to interpret the results. Default to `claude-haiku-4-5` for low latency on the chat path; switch to `claude-sonnet-4-6` if a heavier reasoning step is required.

There is an `ANTHROPIC_API_KEY` in the `.env` file in the project root. LiteLLM picks it up automatically when calling Anthropic models.

### How It Works

When the user sends a chat message, the backend:

1. Loads the user's current portfolio context (cash, positions with P&L, watchlist with live prices, total portfolio value)
2. Loads the most recent conversation history from the `chat_messages` table — capped at the last 20 messages (10 user + 10 assistant turns) to keep the context window bounded
3. Constructs a prompt with a system message, portfolio context, conversation history, and the user's new message
4. Calls Claude via LiteLLM with structured output, using the `claude-llm` skill
5. Parses the complete structured JSON response
6. Auto-executes any trades or watchlist changes specified in the response
7. Stores the message and executed actions in `chat_messages`
8. Returns the complete JSON response to the frontend (no token-by-token streaming — Haiku-class latency keeps a single loading indicator acceptable)

### Structured Output Schema

The LLM is instructed to respond with JSON matching this schema:

```json
{
  "message": "Your conversational response to the user",
  "trades": [
    {"ticker": "AAPL", "side": "buy", "quantity": 10}
  ],
  "watchlist_changes": [
    {"ticker": "PYPL", "action": "add"}
  ]
}
```

- `message` (required): The conversational text shown to the user
- `trades` (optional): Array of trades to auto-execute. Each trade goes through the same validation as manual trades (sufficient cash for buys, sufficient shares for sells)
- `watchlist_changes` (optional): Array of watchlist modifications

### `/api/chat` Response Wire Format

The HTTP response is the LLM's `message` plus the *outcome* of every action attempted, so the frontend can render success/rejection inline and the same shape can be persisted into `chat_messages.actions`:

```json
{
  "message": "Bought 10 AAPL at $190.50.",
  "executed_trades": [
    {
      "ticker": "AAPL",
      "side": "buy",
      "quantity": 10,
      "status": "executed",
      "price": 190.50,
      "error": null
    }
  ],
  "executed_watchlist_changes": [
    {"ticker": "PYPL", "action": "add", "status": "executed", "error": null}
  ],
  "error": null
}
```

- `executed_trades[].status` is `"executed"` or `"rejected"`; on rejection `error` is one of `"insufficient_cash"`, `"insufficient_shares"`, `"ticker_unsupported"`, `"watchlist_full"` and `price` is `null`
- `executed_watchlist_changes[].status` and `error` follow the same convention
- Top-level `error` is non-null only if the LLM call itself failed (network error, structured-output parse failure, etc.); in that case `message` may be a fallback string and the action arrays are empty
- The same envelope (minus the top-level `error`) is what gets stored in `chat_messages.actions` (§7) for the assistant message

### Auto-Execution

Trades specified by the LLM execute automatically — no confirmation dialog. This is a deliberate design choice:
- It's a simulated environment with fake money, so the stakes are zero
- It creates an impressive, fluid demo experience
- It demonstrates agentic AI capabilities — the core theme of the course

If a trade fails validation (e.g., insufficient cash), the error is included in the chat response so the LLM can inform the user.

There is no separate per-trade size cap beyond the existing balance/share-count validation. With $10,000 of fake cash and standard buy/sell math, a hallucinated 100-share order on a $500 ticker simply rejects as "insufficient cash" — the same path a manual user would hit. We accept this in exchange for keeping the validation surface single-pathed.

### System Prompt Guidance

The LLM should be prompted as "FinAlly, an AI trading assistant" with instructions to:
- Analyze portfolio composition, risk concentration, and P&L
- Suggest trades with reasoning, but **only emit a `trades` entry when the user has explicitly stated an intent to buy/sell (with ticker and quantity) or has explicitly agreed to a specific suggestion in this turn**. Casual questions ("is my portfolio risky?", "what do you think of NVDA?") return analysis only — empty `trades` array.
- Manage the watchlist proactively (add/remove suggestions are lower-stakes than trades and may be made in response to clear contextual signals like "I'm curious about X")
- Be concise and data-driven in responses
- Always respond with valid structured JSON

The "explicit intent" rule lives in the prompt rather than in code: validation already prevents impossible trades, but this rule prevents *correct-but-undesired* trades (e.g. an LLM enthusiastically rebalancing because it misread a question).

### LLM Mock Mode

When `LLM_MOCK=true`, the backend returns deterministic mock responses instead of calling Anthropic. This enables:
- Fast, free, reproducible E2E tests
- Development without an API key
- CI/CD pipelines

The mock follows a small, case-insensitive dispatch table keyed on the user message. Each branch returns the same `{message, trades, watchlist_changes}` envelope as the real LLM, so the rest of the pipeline (auto-execution, `chat_messages` write, frontend rendering) is exercised identically:

| Pattern (regex on user content) | Response |
|---|---|
| `^\s*$` (empty) or `^(hi\|hello\|hey)\b` | `{message: "Hi, I'm FinAlly. Ask me about your portfolio.", trades: [], watchlist_changes: []}` |
| `\bbuy\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})\b` | `{message: "Buying {qty} {ticker}.", trades: [{ticker, side: "buy", quantity: qty}], watchlist_changes: []}` |
| `\bsell\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})\b` | `{message: "Selling {qty} {ticker}.", trades: [{ticker, side: "sell", quantity: qty}], watchlist_changes: []}` |
| `\bwatch\s+([A-Z]{1,5})\b` | `{message: "Added {ticker} to your watchlist.", trades: [], watchlist_changes: [{ticker, action: "add"}]}` |
| `\b(unwatch\|remove)\s+([A-Z]{1,5})\b` | `{message: "Removed {ticker} from your watchlist.", trades: [], watchlist_changes: [{ticker, action: "remove"}]}` |
| anything else | `{message: "Mock response: I received '{user_message}'.", trades: [], watchlist_changes: []}` |

Patterns are evaluated in order; the first match wins. E2E tests can rely on this contract verbatim — changing it is a breaking change to the test suite.

---

## 10. Frontend Design

### Layout

The frontend is a single-page application with a dense, terminal-inspired layout. The specific component architecture and layout system is up to the Frontend Engineer, but the UI should include these elements:

- **Watchlist panel** — grid/table of watched tickers with: ticker symbol, current price (flashing green/red on change), daily change %, and a sparkline mini-chart (accumulated from SSE since page load)
- **Main chart area** — larger chart for the currently selected ticker, with at minimum price over time. Clicking a ticker in the watchlist selects it here.
- **Portfolio heatmap** — treemap visualization where each rectangle is a position, sized by portfolio weight, colored by P&L (green = profit, red = loss)
- **P&L chart** — line chart showing total portfolio value over time, using data from `portfolio_snapshots`. Default range is **last 24 hours**, with a small range selector (`1h / 1d / 1w / 1m / All`). A fresh user starts on `1d` and sees the line build out from a single point as snapshots accumulate; experienced users can zoom out to `All`. While no trades have been recorded yet, overlay a soft empty-state hint ("*Make your first trade to start tracking P&L*") so the flat $10,000 line doesn't read as broken.
- **Positions table** — tabular view of all positions: ticker, quantity, avg cost, current price, unrealized P&L, % change
- **Trade bar** — simple input area: ticker field, quantity field, buy button, sell button. Market orders, instant fill.
- **AI chat panel** — docked/collapsible sidebar. Message input, scrolling conversation history, loading indicator while waiting for LLM response. Trade executions and watchlist changes shown inline as confirmations.
- **Header** — portfolio total value, connection status indicator, cash balance. The total value updates live: it is computed client-side as `cash_balance + Σ(position.quantity × latest_streamed_price)`, refreshing on every SSE tick. The 30-second `portfolio_snapshots` rows feed the P&L chart, not the header.

### Technical Notes

- Use `EventSource` for SSE connection to `/api/stream/prices`
- Charting library: **Lightweight Charts** (TradingView's open-source canvas library). It is purpose-built for streaming financial time-series, handles a dense sparkline grid + main chart at 500 ms tick cadence without re-layout thrash, and matches the Bloomberg-terminal aesthetic out of the box. Recharts is a reasonable fallback if a specific component (e.g. the treemap heatmap) is awkward in Lightweight Charts — mix is acceptable, but the price/P&L charts must use Lightweight Charts.
- Price flash effect: on receiving a new price, briefly apply a CSS class with background color transition, then remove it
- All API calls go to the same origin (`/api/*`) — no CORS configuration needed
- Tailwind CSS for styling with a custom dark theme

### Connection Status Indicator

The header dot reflects the SSE connection health, derived from `EventSource.readyState` plus the timestamp of the last received event (or heartbeat comment):

| Color | Condition |
|---|---|
| **Green** | `readyState === OPEN` AND last event/heartbeat ≤ 10 s ago |
| **Yellow** | `readyState === CONNECTING`, OR `OPEN` but last event/heartbeat 10–30 s ago, OR initial warm-up before the first event arrives |
| **Red** | `readyState === CLOSED`, OR `OPEN` but last event/heartbeat > 30 s ago |

Heartbeats are the `: ping` SSE comment lines emitted by the server every 15 s (§6). Outside market hours the price stream goes quiet, but heartbeats keep the dot green.

---

## 11. Docker & Deployment

### Multi-Stage Dockerfile

```
Stage 1: Node 20 slim
  - Copy frontend/
  - npm install && npm run build (produces static export)

Stage 2: Python 3.12 slim
  - Install uv
  - Copy backend/
  - uv sync (install Python dependencies from lockfile)
  - Copy frontend build output into a static/ directory
  - Expose port 8000
  - CMD: uvicorn serving FastAPI app
```

FastAPI serves the static frontend files and all API routes on port 8000.

### Docker Volume

The SQLite database persists via a host bind mount: the project's `db/` directory is mounted into the container at `/app/db`, and the backend writes `finally.db` there. This makes the SQLite file directly inspectable on the host and survives container removal.

```bash
# macOS/Linux
docker run -v "$(pwd)/db:/app/db" -p 8000:8000 --env-file .env finally
```

```powershell
# Windows PowerShell
docker run -v "${PWD}/db:/app/db" -p 8000:8000 --env-file .env finally
```

A named Docker volume (e.g. `-v finally-data:/app/db`) is an acceptable substitute on hosts where bind mounts are awkward, but the start scripts default to the bind mount so `db/finally.db` shows up next to the project tree.

### Start/Stop Scripts

**`scripts/start_mac.sh`** (macOS/Linux):
- Builds the Docker image if not already built (or if `--build` flag passed)
- Runs the container with the volume mount, port mapping, and `.env` file
- Prints the URL to access the app
- Optionally opens the browser

**`scripts/stop_mac.sh`** (macOS/Linux):
- Stops and removes the running container
- Does NOT remove the volume (data persists)

**`scripts/start_windows.ps1`** / **`scripts/stop_windows.ps1`**: PowerShell equivalents for Windows.

All scripts should be idempotent — safe to run multiple times.

### Optional Cloud Deployment

The container is designed to deploy to AWS App Runner, Render, or any container platform. A Terraform configuration for App Runner may be provided in a `deploy/` directory as a stretch goal, but is not part of the core build.

> ⚠️ **Public-deployment warning** — FinAlly has no authentication: the chat endpoint forwards user input to Anthropic on the deployer's API key, and the trade endpoint mutates the deployer's portfolio. Deploying to a public URL means anyone who finds the URL can rack up Anthropic spend and corrupt the demo state. If you put this on the open internet, put it behind platform-level auth (App Runner private URL, Render auth proxy, Cloudflare Access, basic-auth at a reverse proxy, etc.). Local-only use (`http://localhost:8000`) is the supported default.

---

## 12. Testing Strategy

### Unit Tests (within `frontend/` and `backend/`)

**Backend (pytest)**:
- Market data: simulator generates valid prices, GBM math is correct, Massive API response parsing works, both implementations conform to the abstract interface
- Portfolio: trade execution logic, P&L calculations, edge cases (selling more than owned, buying with insufficient cash, selling at a loss)
- LLM: structured output parsing handles all valid schemas, graceful handling of malformed responses, trade validation within chat flow
- API routes: correct status codes, response shapes, error handling

**Frontend (React Testing Library or similar)**:
- Component rendering with mock data
- Price flash animation triggers correctly on price changes
- Watchlist CRUD operations
- Portfolio display calculations
- Chat message rendering and loading state

### E2E Tests (in `test/`)

**Infrastructure**: A separate `docker-compose.test.yml` in `test/` that spins up the app container plus a Playwright container. This keeps browser dependencies out of the production image.

**Environment**: Tests run with `LLM_MOCK=true` by default for speed and determinism.

**Key Scenarios**:
- Fresh start: default watchlist appears, $10k balance shown, prices are streaming
- Add and remove a ticker from the watchlist
- Buy shares: cash decreases, position appears, portfolio updates
- Sell shares: cash increases, position updates or disappears
- Portfolio visualization: heatmap renders with correct colors, P&L chart has data points
- AI chat (mocked): send a message, receive a response, trade execution appears inline
- SSE resilience: disconnect and verify reconnection

---

## 13. Review Notes — Open Questions, Clarifications, Feedback

This section is a working list of items the spec does not yet resolve. Each is something a downstream agent (Backend, Frontend, LLM, Test) will likely have to ask about or invent on the fly. Prefer answering these in the relevant earlier section once decided, then leaving a one-line "resolved in §X" pointer here.

### A. Doc cleanups (small, fix in place)

1. ~~§9 LLM Mock Mode still references OpenRouter.~~ **Resolved** — §9 now says "instead of calling Anthropic".
2. ~~§4 directory tree vs §11 bind mount.~~ **Resolved** — §4 tree and prose now both say "bind-mount target".
3. ~~`.env.example` is referenced in §4's tree comment but never specified.~~ **Resolved** — committed at the project root, mirrors §5.

### B. Open questions for the user (decisions needed before build)

4. ~~Ticker validation policy.~~ **Resolved** — §6 "Ticker Validation": simulator uses a ~50-ticker allowlist; Massive defers to upstream; both reject with `ticker_unsupported`. Watchlist hard-capped at 25 tickers.
5. ~~Trades on tickers not in the watchlist.~~ **Resolved** — §8 `POST /api/portfolio/trade` auto-adds the ticker to the watchlist on a successful trade, subject to the same validation.
6. ~~P&L chart time range.~~ **Resolved** — §10: default last 24 h, with `1h / 1d / 1w / 1m / All` selector.
7. ~~Charting library.~~ **Resolved** — §10: Lightweight Charts for price/P&L; Recharts acceptable as a fallback for non-streaming components (e.g. treemap).
8. ~~Mock-mode contract.~~ **Resolved** — §9 LLM Mock Mode now specifies a 6-row regex dispatch table the E2E suite can rely on.

### C. Specification gaps agents will hit

9. ~~Avg-cost accounting.~~ **Resolved** — §7 `positions` table now spells out the buy-weights-average / sell-leaves-avg-cost-alone / zero-quantity-deletes-row rules.
10. ~~Realized P&L.~~ **Resolved** — §7 `trades` table gains a `cost_basis` column captured at execution; §8 `/api/portfolio` returns the running realized P&L total.
11. ~~`/api/chat` wire format.~~ **Resolved** — §9 "`/api/chat` Response Wire Format" specifies `{message, executed_trades[], executed_watchlist_changes[], error}` with per-action `status` and `error`.
12. ~~`chat_messages.actions` JSON shape.~~ **Resolved** — §7 `chat_messages` shows the JSON shape, mirroring the §9 response envelope.
13. ~~Market-hours behavior with Massive.~~ **Resolved** — §6 "Market Status" defines `open` / `closed` / `warming` on every SSE event; UI suppresses flash animations and shows a "Market Closed" badge.
14. ~~SSE warm-up state.~~ **Resolved** — §6 SSE Streaming "Warm-up" bullet: snapshot of cache on connect; nothing emitted if cache is empty; status dot stays yellow until first event.
15. ~~Watchlist size cap.~~ **Resolved** — §6 Ticker Validation: hard cap 25 tickers, returns `watchlist_full` error.
16. ~~Health check semantics.~~ **Resolved** — §8 `/api/health` row: combined liveness + readiness, `200` once DB ready and a tick has landed in the last 60 s, `503` otherwise.
17. ~~Connection-status state machine.~~ **Resolved** — §10 "Connection Status Indicator" table: green / yellow / red bound to `EventSource.readyState` + 10 s / 30 s thresholds against the heartbeat-augmented event clock.
18. ~~Trade idempotency.~~ **Resolved** — §8 `POST /api/portfolio/trade` accepts optional `request_id` (UUID) for dedupe; frontend disables Buy/Sell while in flight; LLM-initiated trades skip the `request_id`.

### D. Risks & tradeoffs worth flagging

19. ~~Lazy init on first request race.~~ **Resolved** — §7 "SQLite Initialization": schema/seed runs in FastAPI `lifespan` startup, before traffic and before background tasks start.
20. ~~Auto-execution + LLM hallucination.~~ **Resolved** — §9 System Prompt Guidance: the LLM may only emit a `trades` entry when the user has explicitly stated intent or agreed to a specific suggestion in this turn.
21. ~~`portfolio_snapshots` for fresh users.~~ **Resolved** — §7: an initial anchor snapshot is written at `lifespan` startup if the table is empty; §10 P&L chart shows a "*Make your first trade to start tracking P&L*" empty-state until trades exist.
22. ~~SSE keep-alive over proxies.~~ **Resolved** — §6 SSE Streaming: server emits a `: ping` SSE comment every 15 s.
23. ~~No-auth deployment posture.~~ **Resolved** — §11 "Optional Cloud Deployment": explicit warning that public deployment requires platform-level auth; local-only is the supported default.
