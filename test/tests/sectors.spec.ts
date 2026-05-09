import { test, expect } from "../fixtures/app";
import { SECTOR_IDS } from "../pages";

/**
 * Redesign spec §11 new scenario: all 5 sector groups visible on fresh
 * load (v1.1 taxonomy — Materials dropped per task #14), each with its
 * 10 tickers populated, and clicking a sector row drives the
 * `useSelectedTicker()` store. We verify selection through the TradeBar's
 * `trade-ticker` span (which mirrors the store) since the MainChart panel
 * doesn't expose the active ticker as a data-attribute.
 */
const SECTOR_SAMPLE: Record<(typeof SECTOR_IDS)[number], string[]> = {
  technology: ["AAPL", "MSFT", "GOOGL", "NVDA", "META"],
  healthcare: ["UNH", "JNJ", "LLY", "PFE", "MRK"],
  financial: ["JPM", "BAC", "GS", "MS", "V"],
  consumer: ["WMT", "COST", "MCD", "NKE", "DIS"],
  energy: ["XOM", "CVX", "COP", "SLB", "VLO"],
};

test.describe("@sectors sector watchlist", () => {
  test("all 5 sector groups visible with their tickers populated", async ({
    page,
    sectors,
  }) => {
    await page.goto("/");

    for (const sectorId of SECTOR_IDS) {
      await expect(sectors.group(sectorId)).toBeVisible();
      // Spot-check 5 tickers per sector — a missing taxonomy entry would
      // surface here without burning 50 expectations.
      for (const ticker of SECTOR_SAMPLE[sectorId]) {
        await expect(sectors.row(ticker)).toBeVisible();
      }
    }

    // Hard-cap on row count: 5 × 10 = 50.
    await expect(sectors.rows).toHaveCount(50);
  });

  test("clicking a sector row selects that ticker", async ({
    page,
    sectors,
    tradeBar,
    charts,
  }) => {
    await page.goto("/");

    // MainChart and TradeBar are visible; default selection is AAPL
    // (spec §7 — first ticker of first sector).
    await expect(charts.mainChart).toBeVisible();
    await expect(tradeBar.tickerDisplay).toHaveText("AAPL");

    // Click a different ticker; the trade-ticker mirror should update.
    await sectors.selectTicker("MSFT");
    await expect(tradeBar.tickerDisplay).toHaveText("MSFT");
  });
});
