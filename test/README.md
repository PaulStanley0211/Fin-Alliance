# FinAlly E2E Tests

Playwright suite for `planning/PLAN.md` §12.

## Layout

```
test/
├── docker-compose.test.yml   # spins up the app with LLM_MOCK=true
├── package.json              # Playwright + TS deps (host-side)
├── playwright.config.ts
├── tsconfig.json
├── fixtures/                 # custom test fixtures
├── pages/                    # page-object stubs (one per UI region)
└── tests/                    # spec files
```

## Runner choice: host, not sidecar

Playwright runs **on the host** against the app container exposed on
`localhost:8000`. The alternative — a Playwright sidecar container — is
strictly more moving parts (browser image, nested networking, volume mounts
for the report), with no upside while the suite is single-machine.

DevOps (#14) reuses this compose file for the build smoke test, so keeping
it minimal pays off twice.

## First-time setup

```bash
cd test
npm install
npx playwright install --with-deps chromium
```

## Running tests

Spin up the app under test, then run Playwright:

```bash
# from repo root
docker compose -f test/docker-compose.test.yml up --build -d
cd test
npm test                 # full suite (headless)
npm run test:smoke       # only @smoke (the wiring check)
npm run test:headed      # debug a flake
docker compose -f test/docker-compose.test.yml down -v
```

Or the convenience scripts inside `test/`:

```bash
npm run compose:up
npm test
npm run compose:down
```

## Skipping when backend isn't ready

The smoke test honors `FINALLY_SKIP_IF_DOWN=1`. Set it during early
scaffolding work to make a missing backend a skip rather than a hard fail:

```bash
FINALLY_SKIP_IF_DOWN=1 npm run test:smoke
```

In CI / on a real test run, leave the flag unset so a down backend fails loudly.

## Selectors

All selectors target `data-testid` attributes added by frontend-engineer.
The full list is documented at the top of each page object in `pages/`.
If you need a new selector, message frontend-engineer and add the attribute
on their side rather than falling back to text matching.

## Adding a scenario

1. Add or extend a page-object in `pages/`.
2. Re-export new fixtures from `fixtures/app.ts` if they aren't already.
3. Add a `*.spec.ts` under `tests/` that uses the fixtures via:
   ```ts
   import { test, expect } from "../fixtures/app";
   ```
4. Tag the scenario with the relevant tag(s) — `@smoke`, `@portfolio`, `@chat`,
   `@sse`, etc. — so we can run subsets while iterating.

## Conventions

- No `page.waitForTimeout` in committed tests. Use Playwright auto-waiting
  (`expect(...).toHaveText`, `toBeVisible`, etc.) or web-first assertions.
- One scenario per concept; don't bundle assertions across unrelated flows.
- Tests run headless in CI, headed for local debugging (`npm run test:headed`).
- LLM_MOCK=true is mandatory — never spend on real Anthropic in tests.
