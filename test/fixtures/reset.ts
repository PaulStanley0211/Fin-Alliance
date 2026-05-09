import type { APIRequestContext } from "@playwright/test";

/**
 * Resets the backend to a known-clean state between tests by selling every
 * open position back to flat (reuses /api/portfolio/trade so cost_basis math
 * runs through the real path, not a backdoor).
 *
 * Cash will not return to *exactly* $10,000 because sell prices drift on the
 * GBM simulator — that's fine; tests assert deltas, not absolutes (except
 * the fresh-start scenario, which is the only one that runs against a brand
 * new volume).
 *
 * The legacy watchlist trim is gone: per the redesign spec the dynamic
 * watchlist concept was removed in favor of the fixed 50-ticker sector
 * taxonomy, so there is no per-test ticker state to reset.
 */
export async function resetBackendState(request: APIRequestContext): Promise<void> {
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
}
