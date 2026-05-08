# FinAlly — AI Trading Workstation

A visually stunning AI-powered trading workstation that streams live market data, simulates portfolio trading, and integrates an LLM chat assistant that can analyze positions and execute trades via natural language.

Built entirely by coding agents as a capstone project for an agentic AI coding course.

## Features

- **Live price streaming** via SSE with green/red flash animations
- **Simulated portfolio** — $10k virtual cash, market orders, instant fills
- **Portfolio visualizations** — heatmap (treemap), P&L chart, positions table
- **AI chat assistant** — analyzes holdings, suggests and auto-executes trades
- **Watchlist management** — track tickers manually or via AI
- **Dark terminal aesthetic** — Bloomberg-inspired, data-dense layout

## Architecture

Single Docker container serving everything on port 8000:

- **Frontend**: Next.js (static export) with TypeScript and Tailwind CSS
- **Backend**: FastAPI (Python/uv) with SSE streaming
- **Database**: SQLite with lazy initialization
- **AI**: LiteLLM → Anthropic (Claude Haiku 4.5) with structured outputs
- **Market data**: Built-in GBM simulator (default) or Massive API (optional)

## Quick Start

```bash
# Clone and configure
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env

# Run with Docker (macOS/Linux)
docker build -t finally .
docker run -v "$(pwd)/db:/app/db" -p 8000:8000 --env-file .env finally

# Windows PowerShell
docker run -v "${PWD}/db:/app/db" -p 8000:8000 --env-file .env finally

# Open http://localhost:8000
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude-powered AI chat |
| `MASSIVE_API_KEY` | No | Massive (Polygon.io) key for real market data; omit to use simulator |
| `LLM_MOCK` | No | Set `true` for deterministic mock LLM responses (testing) |

## Project Status

| Component | Status |
|---|---|
| Project specification (`planning/PLAN.md`) | Complete — all open questions resolved |
| Market data subsystem (simulator + Massive client + cache) | Complete (see `planning/MARKET_DATA_SUMMARY.md`) |
| SSE streaming (`/api/stream/prices`) | Pending |
| Portfolio API (trade/positions/history) | Pending |
| Watchlist API | Pending |
| LLM chat (`/api/chat`) with auto-execution | Pending |
| Frontend (Next.js trading terminal UI) | Pending |
| Dockerfile + start/stop scripts | Pending |
| E2E test suite (Playwright) | Pending |

## Project Structure

```
finally/
├── frontend/    # Next.js static export
├── backend/     # FastAPI uv project
├── planning/    # Project documentation and agent contracts
├── test/        # Playwright E2E tests
├── db/          # SQLite volume mount (runtime)
└── scripts/     # Start/stop helpers
```

## License

See [LICENSE](LICENSE).
