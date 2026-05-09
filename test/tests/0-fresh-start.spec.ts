import { test, expect } from "../fixtures/app";
import { SECTOR_IDS } from "../pages";

/**
 * §12 "Fresh start" scenario, redesigned for the sector taxonomy.
 *
 * Asserts the seed shape of the workstation: the SectorWatchlist renders
 * all 5 sector groups (v1.1 taxonomy — Materials dropped per task #14),
 * the first ticker of the first sector (AAPL) shows a streamed price,
 * ≈$10k cash, and the connection dot lands at green.
 *
 * Cash is asserted within $5 of $10,000 rather than `=== 10000` because
 * the suite may run against a volume that already saw a previous test
 * session. `resetBackendState` flattens any open positions but the
 * resulting sell trades drift cash by cents (sell price ≠ buy price under
 * GBM). A truly fresh container always shows exactly $10,000.00.
 */
const FIRST_TICKER = "AAPL"; // First ticker of first sector per spec §7.

test.describe("@fresh fresh start", () => {
  test("sector watchlist + ≈$10k balance + prices stream within 5s", async ({
    page,
    header,
    sectors,
  }) => {
    await page.goto("/");

    // SectorWatchlist panel renders with all 5 sector groups.
    await expect(sectors.panel).toBeVisible();
    for (const sectorId of SECTOR_IDS) {
      await expect(sectors.group(sectorId)).toBeVisible();
    }

    // 50 ticker rows total (5 × 10) — Materials dropped per task #14 to
    // fit Finnhub's free-tier 50-symbol WebSocket cap.
    await expect(sectors.rows).toHaveCount(50);

    // AAPL row is rendered (first sector, first ticker).
    await expect(sectors.row(FIRST_TICKER)).toBeVisible();

    // Cash balance is ≈ $10k (drift tolerance: $5 covers prior-session reset).
    await expect(header.cashValue).toBeVisible();
    await expect
      .poll(async () => header.readCash(), { timeout: 5_000 })
      .not.toBeNull();
    const cash = await header.readCash();
    expect(cash).not.toBeNull();
    expect(Math.abs(cash! - 10000)).toBeLessThan(5);

    // Total value is in the same neighborhood (no positions yet).
    const total = await header.readTotal();
    expect(total).not.toBeNull();
    expect(Math.abs(total! - 10000)).toBeLessThan(5);

    // Prices stream — AAPL row's price renders a real number within 10s.
    // The simulator emits at ~500ms cadence; 10s is generous.
    await expect
      .poll(
        async () => {
          const text = (await sectors.price(FIRST_TICKER).innerText()).trim();
          return text.length > 0 && text !== "—" && /\d/.test(text);
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    // Connection dot lands at green within 10s of first event.
    await expect
      .poll(async () => header.statusColor(), { timeout: 10_000 })
      .toBe("green");
  });
});
