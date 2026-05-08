import { test, expect } from "../fixtures/app";

/**
 * §12 "Fresh start" scenario. Asserts the *seed shape* of the workstation:
 * default 10-ticker watchlist, ≈$10k cash, live price stream, green dot.
 *
 * Cash is asserted within $5 of $10,000 rather than `=== 10000` because the
 * suite may run against a volume that already saw a previous test session.
 * `resetBackendState` flattens any open positions but the resulting sell
 * trades drift cash by cents (sell price ≠ buy price under GBM), accumulating
 * into single-digit dollars over many runs. A truly fresh container always
 * shows exactly $10,000.00.
 */
const SEED_TICKERS = [
  "AAPL",
  "GOOGL",
  "MSFT",
  "AMZN",
  "TSLA",
  "NVDA",
  "META",
  "JPM",
  "V",
  "NFLX",
];

test.describe("@fresh fresh start", () => {
  test("default watchlist, ≈$10k balance, prices stream within 5s", async ({
    page,
    header,
    watchlist,
  }) => {
    await page.goto("/");

    // Watchlist panel renders with all 10 seed tickers.
    await expect(watchlist.panel).toBeVisible();
    for (const ticker of SEED_TICKERS) {
      await expect(watchlist.row(ticker)).toBeVisible();
    }
    await expect(watchlist.rows).toHaveCount(SEED_TICKERS.length);

    // Cash balance is ≈ $10k (drift tolerance: $5 covers prior-session reset).
    await expect(header.cashValue).toBeVisible();
    await expect
      .poll(async () => header.readCash(), { timeout: 5_000 })
      .not.toBeNull();
    const cash = await header.readCash();
    expect(cash).not.toBeNull();
    expect(Math.abs(cash! - 10000)).toBeLessThan(5);

    // Total value should also be in the same neighborhood (no positions yet,
    // so total ≈ cash give or take a live tick).
    const total = await header.readTotal();
    expect(total).not.toBeNull();
    expect(Math.abs(total! - 10000)).toBeLessThan(5);

    // Prices stream — the AAPL row's price renders a real number within 5s.
    await expect
      .poll(
        async () => {
          const text = (await watchlist.price("AAPL").innerText()).trim();
          return text.length > 0 && text !== "—" && /\d/.test(text);
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    // Connection dot lands at green within 10s of first event.
    await expect
      .poll(async () => header.statusColor(), { timeout: 10_000 })
      .toBe("green");
  });
});
