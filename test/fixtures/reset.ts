import type { APIRequestContext } from "@playwright/test";

/**
 * Resets the backend to a known-clean state between tests by:
 *  1. Selling every open position back to flat (reuses /api/portfolio/trade
 *     so cost_basis math runs through the real path, not a backdoor).
 *  2. Trimming the watchlist back to the seed 10 tickers.
 *
 * Cash will not return to *exactly* $10,000 because sell prices drift on the
 * GBM simulator — that's fine; tests assert deltas, not absolutes (except the
 * fresh-start scenario, which is the only one that runs against a brand-new
 * volume).
 */
const SEED_TICKERS = new Set([
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
]);

export async function resetBackendState(request: APIRequestContext): Promise<void> {
  // 1. Flatten any open positions.
  const portfolioRes = await request.get("/api/portfolio");
  if (portfolioRes.ok()) {
    const portfolio = await portfolioRes.json();
    for (const pos of portfolio.positions ?? []) {
      if (pos.quantity > 0) {
        await request.post("/api/portfolio/trade", {
          data: {
            ticker: pos.ticker,
            quantity: pos.quantity,
            side: "sell",
          },
        });
      }
    }
  }

  // 2. Trim the watchlist back to seed.
  const wlRes = await request.get("/api/watchlist");
  if (wlRes.ok()) {
    const wl = await wlRes.json();
    for (const entry of wl.tickers ?? []) {
      if (!SEED_TICKERS.has(entry.ticker)) {
        await request.delete(`/api/watchlist/${entry.ticker}`);
      }
    }
  }
}
