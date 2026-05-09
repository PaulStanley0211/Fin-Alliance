# FinAlly — the Finance Ally

Multi-user AI trading workstation: real-time prices, simulated portfolios,
streaming LLM chat. Single Docker container, served on `:8000`.

## Status

**Shipped end-to-end.** Three iterations are all done; do not assume
anything is "still to be developed":

1. **v1.0** — original single-user spec, [`planning/PLAN.md`](planning/PLAN.md). Built by a six-agent team (see [`README.md`](README.md) → "How this was built").
2. **v1.1** — sector taxonomy + Finnhub real-time + heatmap + light/dark theme, [`docs/superpowers/specs/2026-05-09-finally-redesign-design.md`](docs/superpowers/specs/2026-05-09-finally-redesign-design.md). Supersedes §10 of PLAN.md (the layout section); the rest of PLAN.md is still authoritative.
3. **v1.2 (current)** — token-streaming chat (SSE `delta`/`done`/`error` events) + username/password auth + per-user portfolio isolation. Documented in commit messages on `main`; no separate spec doc.

Tests: 363 backend unit, 99 frontend component, 23 Playwright E2E.

## When you start work

Read [`README.md`](README.md) first — it covers the architecture in one
page and is kept current. Then consult these only when the task touches
the relevant area:

- [`planning/PLAN.md`](planning/PLAN.md) — original spec; load only for
  authoritative details on the SQLite schema, error envelopes, or §9 LLM
  contract that v1.1/v1.2 didn't change.
- [`docs/superpowers/specs/2026-05-09-finally-redesign-design.md`](docs/superpowers/specs/2026-05-09-finally-redesign-design.md) — v1.1 design rationale, including why the sector list is 5×10=50 (Finnhub free-tier WebSocket cap).
- [`planning/MARKET_DATA_SUMMARY.md`](planning/MARKET_DATA_SUMMARY.md) — market-data subsystem deep dive.

## Common commands

Run from the directory that owns the test runner — `pytest` from `backend/`,
`vitest` / `tsc` from `frontend/`, `playwright` from `test/`.

```bash
# Backend
cd backend
uv sync --extra dev                              # install
uv run --extra dev pytest -q                     # 363 tests, ~25s
uv run --extra dev ruff check app/ tests/        # lint

# Frontend
cd frontend
npx vitest run                                   # 99 tests, ~5s
npx tsc --noEmit                                 # type-check

# E2E (requires the test container on :8001)
cd /c/Users/pauls/Projects/finally
docker compose -f test/docker-compose.test.yml up --build -d
cd test && npx playwright test --reporter=list   # 23 specs, ~1m30s
docker compose -f test/docker-compose.test.yml down -v

# Container (dev)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_windows.ps1 -Build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop_windows.ps1
# macOS/Linux equivalents in scripts/start_mac.sh, scripts/stop_mac.sh
```

## Project conventions and gotchas

- **`frontend/lib/` was historically `.gitignored`** by the root
  `lib/` Python venv pattern. The fix in commit `85c4f7e` anchored it
  to `/lib/`. If you ever see new files in `frontend/lib/` not showing
  up in `git status`, that pattern has crept back in.
- **bcrypt direct, not passlib.** `passlib==1.7.4` doesn't support
  `bcrypt>=5`. Direct bcrypt is four lines in `app/auth/passwords.py`
  with UTF-8-safe 72-byte truncation.
- **Tests need the right cwd.** `pytest` from `backend/` (uses
  `pyproject.toml` rootdir); running from project root collects 11
  errors. `playwright` runs from `test/` against
  `FINALLY_BASE_URL=http://localhost:8001` (overridable).
- **Default `client` test fixture is pre-authenticated.** `tests/api/conftest.py`
  and `tests/llm/conftest.py` sign up `"testuser"` before yielding.
  Tests that need a fresh, unauthed session use `unauthed_client`.
- **Playwright fixtures only run when destructured.** Adding `testUsername: _`
  to a test signature is the difference between "lands on workstation"
  and "stuck on login form" — see `test/tests/auth.spec.ts`.
- **LLM responses use a tagged format**, not structured outputs:
  `<reply>…</reply><actions>{json}</actions>`. The parser tolerates the
  model omitting `<reply>` (Haiku does this in practice).
- **Per-user state is keyed by UUID `user_id`.** Repository functions
  default to `DEFAULT_USER_ID = "default"` for backwards compat with
  legacy seeded data, but every request-path call site should pass the
  resolved user id from `current_user`.
- **Market data is global; chat / portfolio are per-user.** `/api/sectors`,
  `/api/health`, and the SSE price stream are public; everything else
  is gated by the `current_user` dependency.
- **CRLF on Windows.** `.env` parsing breaks silently on CRLF; the
  start scripts validate this. Test files written here may show
  `LF will be replaced by CRLF` warnings on `git add` — harmless.

## Required environment variables

`ANTHROPIC_API_KEY` is required for chat. `SESSION_SECRET_KEY` should be
set for any persistent deployment (otherwise sessions invalidate every
restart). `FINNHUB_API_KEY` enables real-time data; without it, the
GBM simulator runs. See [`.env.example`](.env.example) for the canonical
list.
