import { test as base } from "@playwright/test";
import {
  ChartsPage,
  ChatPage,
  HeaderPage,
  HeatmapPage,
  PositionsPage,
  SectorWatchlistPage,
  TradeBarPage,
} from "../pages";

type AppFixtures = {
  header: HeaderPage;
  sectors: SectorWatchlistPage;
  tradeBar: TradeBarPage;
  positions: PositionsPage;
  heatmap: HeatmapPage;
  chat: ChatPage;
  charts: ChartsPage;
  /** The username of the freshly-signed-up user for this test. */
  testUsername: string;
};

/**
 * Generate a unique-per-test username. Random suffix only — the test runner
 * can spawn workers in parallel and we need each to land on its own row in
 * the `users` table, but we don't want to fight the 32-char username cap.
 */
function uniqueUsername(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `e2e_${rand}`;
}

export const test = base.extend<AppFixtures>({
  /**
   * Sign up a fresh user before every test. Uses `page.request` so the
   * resulting session cookie is bound to the same browser context as
   * `page`, which means navigation and subsequent /api calls are
   * authenticated transparently.
   *
   * Each test runs in its own context (Playwright's default isolation),
   * so cookies don't leak between tests.
   */
  testUsername: async ({ page }, use) => {
    const username = uniqueUsername();
    const resp = await page.request.post("/api/auth/signup", {
      data: { username, password: "e2epass1234" },
    });
    if (!resp.ok()) {
      throw new Error(
        `e2e signup failed: HTTP ${resp.status()} ${await resp.text()}`,
      );
    }
    await use(username);
  },

  header: async ({ page, testUsername: _ }, use) => {
    await use(new HeaderPage(page));
  },
  sectors: async ({ page, testUsername: _ }, use) => {
    await use(new SectorWatchlistPage(page));
  },
  tradeBar: async ({ page, testUsername: _ }, use) => {
    await use(new TradeBarPage(page));
  },
  positions: async ({ page, testUsername: _ }, use) => {
    await use(new PositionsPage(page));
  },
  heatmap: async ({ page, testUsername: _ }, use) => {
    await use(new HeatmapPage(page));
  },
  chat: async ({ page, testUsername: _ }, use) => {
    await use(new ChatPage(page));
  },
  charts: async ({ page, testUsername: _ }, use) => {
    await use(new ChartsPage(page));
  },
});

export { expect } from "@playwright/test";
