# FinAlly — AI Trading Workstation

A visually stunning AI-powered trading workstation that streams live market data, simulates portfolio trading, and integrates an LLM chat assistant that can analyze positions and execute trades via natural language.

Built entirely by coding agents as a capstone project for an agentic AI coding course.

## Features

- **Live price streaming** via SSE with green/red flash animations and 15s heartbeats
- **Simulated portfolio** — $10k virtual cash, market orders, instant fills, fractional shares
- **Portfolio visualizations** — weight-sorted holdings list, live positions table, P&L chart with 1h/1d/1w/1m/all ranges
- **AI chat assistant** — analyzes holdings, suggests and auto-executes trades via natural language
- **Watchlist management** — 25-ticker cap, add/remove via UI or AI
- **Dark terminal aesthetic** — Bloomberg-inspired, data-dense layout
- **Connection-aware** — live status indicator, market-closed badge, SSE auto-reconnect

## Architecture

Single Docker container serving everything on port 8000:

- **Frontend**: Next.js (static export) with TypeScript and Tailwind CSS
- **Backend**: FastAPI (Python/uv) with SSE streaming
- **Database**: SQLite with lazy initialization
- **AI**: LiteLLM → Anthropic (Claude Haiku 4.5) with structured outputs
- **Market data**: Built-in GBM simulator (default) or Massive API (optional)

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
| `MASSIVE_API_KEY` | No | Massive (Polygon.io) key for real market data; omit to use simulator |
| `LLM_MOCK` | No | Set `true` for deterministic mock LLM responses (testing) |

## Project Status

**All components complete.** Built end-to-end by a coordinated agent team (database, backend, LLM, frontend, devops, integration tester).

| Component | Status |
|---|---|
| Project specification (`planning/PLAN.md`) | Complete |
| Market data subsystem (simulator + Massive client + cache) | Complete (see `planning/MARKET_DATA_SUMMARY.md`) |
| SSE streaming with `market_status` + 15s heartbeats | Complete |
| Database layer (SQLite, lifespan init, repositories, snapshot writer) | Complete |
| Portfolio API (trade/positions/history) with idempotent trades | Complete |
| Watchlist API with auto-add on trade | Complete |
| LLM chat (`/api/chat`) with auto-execution + deterministic mock mode | Complete |
| Frontend (Next.js trading terminal UI) | Complete |
| Dockerfile (multi-stage) + start/stop scripts (mac + Windows) | Complete |
| E2E test suite (Playwright) — 16 scenarios | Complete |

### Test totals

- Backend: 294/294 unit tests passing (DB, market, API, LLM)
- Frontend: 66/66 component tests passing
- E2E: 16/16 scenarios passing in ~60s on a clean container, no flake on three consecutive clean runs

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
├── frontend/    # Next.js static export
├── backend/     # FastAPI uv project
├── planning/    # Project documentation and agent contracts
├── test/        # Playwright E2E tests
├── db/          # SQLite volume mount (runtime)
├── scripts/     # Start/stop helpers
└── .claude/
    └── agents/  # Six role-specific agent definitions
```

## How this was built

FinAlly was implemented by a six-member coordinated agent team rather than
a single coding session. Each role was a separate Claude Code subagent
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

## License

See [LICENSE](LICENSE).
