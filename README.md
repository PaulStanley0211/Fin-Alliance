# FinAlly — AI Trading Workstation

A visually stunning AI-powered trading workstation that streams live market data, simulates portfolio trading, and integrates an LLM chat assistant that can analyze positions and execute trades via natural language.

Built entirely by coding agents as a capstone project for an agentic AI coding course.

## Features

- **Real-time market data** via Finnhub WebSocket (Massive REST and a built-in GBM simulator are also supported)
- **5 sectors × 10 tickers = 50 stocks** streaming live from boot, organized into collapsible sector groups
- **SSE price stream** with green/red flash animations, market-closed badge, and 15s heartbeats
- **Simulated portfolio** — $10k virtual cash, market orders, instant fills, fractional shares
- **Portfolio visualizations** — restrained P&L heatmap, positions table, P&L chart with 1h/1d/1w/1m/all ranges
- **AI chat assistant** — analyzes holdings, suggests and auto-executes trades via natural language
- **Light & dark themes** — header toggle, persisted to localStorage, respects `prefers-color-scheme` on first visit
- **Trade Bar with +/− stepper** — pinned below the chat panel for one-handed buy/sell
- **Connection-aware** — live status dot driven by SSE heartbeats, automatic reconnection

## Architecture

Single Docker container serving everything on port 8000:

- **Frontend**: Next.js (static export) with TypeScript, Tailwind CSS, and CSS-variable theme tokens
- **Backend**: FastAPI (Python/uv) with SSE streaming and a frozen sector taxonomy
- **Database**: SQLite with lifespan-driven schema/seed init
- **AI**: LiteLLM → Anthropic (Claude Haiku 4.5) with structured outputs
- **Market data**: provider precedence is `FINNHUB_API_KEY` (WebSocket) → `MASSIVE_API_KEY` (Polygon REST) → built-in GBM simulator. Finnhub auth failures degrade transparently to the simulator so the dashboard always streams.

## Quick Start

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2 on Linux).

```bash
# 1. Configure
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### macOS / Linux

```bash
./scripts/start_mac.sh           # builds image if needed, runs container
./scripts/start_mac.sh --build   # force rebuild after code changes
./scripts/start_mac.sh --logs    # follow logs after start
./scripts/stop_mac.sh            # stop + remove container (db preserved)
```

### Windows (PowerShell)

```powershell
.\scripts\start_windows.ps1            # builds image if needed, runs container
.\scripts\start_windows.ps1 -Build     # force rebuild after code changes
.\scripts\start_windows.ps1 -Logs      # follow logs after start
.\scripts\stop_windows.ps1             # stop + remove container (db preserved)
```

Then open http://localhost:8000.

### Or use docker compose directly

```bash
docker compose up --build -d
docker compose logs -f
docker compose down
```

### Persistence

The SQLite database lives at `db/finally.db` on the host (bind-mounted into the
container). Stopping the container preserves your portfolio; delete that file
for a clean slate.

### `.env` format gotchas

Docker's `--env-file` parser is unforgiving — the start scripts validate
your `.env` and bail with a precise fix message before docker even runs.
Three traps to know about:

- **No quotes** — write `ANTHROPIC_API_KEY=sk-ant-...`, not `="sk-ant-..."`. Docker keeps the literal quote chars in the value, which causes a `401 invalid x-api-key` from Anthropic.
- **No spaces around `=`** — `KEY=value`, not `KEY = value`. Docker rejects the file outright.
- **LF line endings only** — Windows CRLF endings put a trailing `\r` in every value, which silently breaks them. In VS Code, click `CRLF` in the bottom-right status bar and switch to `LF`. Or run `dos2unix .env` from Git Bash.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude-powered AI chat |
| `FINNHUB_API_KEY` | No | Finnhub key for real-time WebSocket trades (preferred). Free tier covers all 50 sector tickers. |
| `MASSIVE_API_KEY` | No | Massive (Polygon.io) key for real market data via REST polling (used only if `FINNHUB_API_KEY` is unset) |
| `LLM_MOCK` | No | Set `true` for deterministic mock LLM responses (testing) |

If neither market-data key is set, the app falls back to the GBM simulator — no external services required.

## Project Status

**All components complete**, including the v1.1 redesign that swapped the user-managed watchlist for a fixed sector taxonomy and added Finnhub real-time data, the portfolio heatmap, the +/− trade stepper, and the light/dark theme toggle. Design rationale: [`docs/superpowers/specs/2026-05-09-finally-redesign-design.md`](docs/superpowers/specs/2026-05-09-finally-redesign-design.md). Original spec: [`planning/PLAN.md`](planning/PLAN.md).

| Component | Status |
|---|---|
| Original spec (`planning/PLAN.md`) + v1.1 redesign spec (`docs/superpowers/specs/`) | Complete |
| Market data: Finnhub WebSocket + Massive REST + GBM simulator behind one interface | Complete |
| Sector taxonomy (5 sectors × 10 tickers, frozen, exposed via `/api/sectors`) | Complete |
| SSE streaming with `market_status` + 15s heartbeats + market-closed handling | Complete |
| Database layer (SQLite, lifespan init, repositories, 30s snapshot writer) | Complete |
| Portfolio API (trade/positions/history) with idempotent trades and auto-add on trade | Complete |
| LLM chat (`/api/chat`) with auto-execution, watchlist-disabled rejection, deterministic mock mode | Complete |
| Frontend: SectorWatchlist, MainChart, PortfolioHeatmap, PnLChart, PositionsTable, TradeBar, ChatPanel | Complete |
| Light/dark theme toggle (CSS-variable tokens, localStorage-persisted) | Complete |
| Dockerfile (multi-stage) + start/stop scripts (mac + Windows) | Complete |
| E2E test suite (Playwright) | Complete |

### Test totals

- Backend: 341 unit tests (DB, market, API, LLM, sectors, Finnhub client)
- Frontend: 91 component / store tests
- E2E: 19 Playwright scenarios across 9 spec files (smoke, fresh-start, sectors, theme, trading, chat, idempotency, portfolio charts, SSE resilience)

### Run locally

```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY (or set LLM_MOCK=true to skip)
./scripts/start_mac.sh      # or .\scripts\start_windows.ps1
# Open http://localhost:8000
```

## Project Structure

```
finally/
├── frontend/    # Next.js static export (TypeScript, Tailwind, CSS-variable themes)
├── backend/     # FastAPI uv project (sectors, market data, portfolio, LLM, SSE)
├── planning/    # Original project plan and market-data summary
├── docs/        # Design specs (v1.1 redesign — sectors + Finnhub + theme)
├── test/        # Playwright E2E tests + docker-compose.test.yml
├── db/          # SQLite bind-mount target (runtime)
├── scripts/     # Start/stop helpers (mac + Windows)
└── .claude/
    └── agents/  # Role-specific agent definitions used during the original build
```

## How this was built

FinAlly v1.0 was implemented by a six-member coordinated agent team rather
than a single coding session. Each role was a separate Claude Code subagent
defined under [`.claude/agents/`](.claude/agents/), spawned into a shared
team with a dependency-graphed task list:

| Agent | Scope |
|---|---|
| `database-engineer` | SQLite schema, lifespan init, repositories, snapshot writer |
| `backend-engineer` | FastAPI app, REST endpoints, SSE wiring, static-file serving |
| `llm-engineer` | LiteLLM/Anthropic client, mock mode, `/api/chat`, action executor |
| `frontend-engineer` | Next.js app, components, Tailwind theming, SSE store, charts |
| `devops-engineer` | Multi-stage Dockerfile, start/stop scripts, `.env` validation |
| `integration-tester` | Playwright E2E suite, defect routing, final readiness report |

Teammates worked in parallel where the dependency graph allowed and
coordinated peer-to-peer (e.g. backend ↔ devops on the schema-path bind
mount; frontend ↔ integration-tester on `data-testid` contracts). Defects
surfaced by the E2E suite were filed as bug tasks back to the suspected
owner and re-verified after the fix. The full project specification
(`planning/PLAN.md`) is the contract every agent reads.

The v1.1 redesign (sector taxonomy, Finnhub real-time data, restored
heatmap, +/− trade stepper, light/dark theme) was scoped in the design spec
under [`docs/superpowers/specs/`](docs/superpowers/specs/) and shipped end-to-end
through the same pattern.

## License

See [LICENSE](LICENSE).
