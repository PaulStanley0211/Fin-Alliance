import { test, expect } from "../fixtures/app";
import { resetBackendState } from "../fixtures/reset";

test.describe("@charts portfolio visualizations", () => {
  test.beforeEach(async ({ request }) => {
    await resetBackendState(request);
  });

  test("holdings list renders a row after a buy with weight + P&L data", async ({
    page,
    tradeBar,
    charts,
  }) => {
    await page.goto("/");
    await tradeBar.buy("AAPL", 2);

    await expect(charts.holdingsList).toBeVisible();
    await expect(charts.holdingsRow("AAPL")).toBeVisible();

    // Per-row data attributes per the new contract: weight is 0..1.
    const weight = await charts
      .holdingsWeight("AAPL")
      .getAttribute("data-weight");
    expect(weight, "holdings-weight cell should carry data-weight").toBeTruthy();
    const w = Number(weight);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(1);

    // Value + P&L cells render non-empty text.
    await expect(charts.holdingsValue("AAPL")).toBeVisible();
    await expect(charts.holdingsPnl("AAPL")).toBeVisible();
    const valueText = (await charts.holdingsValue("AAPL").innerText()).trim();
    expect(valueText.length).toBeGreaterThan(0);
  });

  test("holdings rows are sorted by market value descending", async ({
    page,
    tradeBar,
    charts,
  }) => {
    await page.goto("/");

    // NVDA (~$800) is much larger than V (~$280); buying 1 share of each
    // means NVDA should appear first regardless of any tick-level drift.
    await tradeBar.buy("NVDA", 1);
    await expect(charts.holdingsRow("NVDA")).toBeVisible();
    await tradeBar.buy("V", 1);
    await expect(charts.holdingsRow("V")).toBeVisible();

    const tickers = await charts.holdingsRows.evaluateAll((rows) =>
      rows
        .map((el) => el.getAttribute("data-testid") ?? "")
        .map((id) => id.replace(/^holdings-row-/, "")),
    );

    expect(tickers.length).toBeGreaterThanOrEqual(2);
    expect(tickers.indexOf("NVDA")).toBeLessThan(tickers.indexOf("V"));
  });

  test("P&L chart renders; range selector switches the active button", async ({
    page,
    charts,
  }) => {
    await page.goto("/");

    await expect(charts.pnlChart).toBeVisible();

    // Default is 1d per §10. Click each range and confirm the buttons exist.
    // Canvas data points aren't asserted (Lightweight Charts renders to
    // canvas; no DOM to inspect).
    await charts.pnlRangeButton("1h").click();
    await expect(charts.pnlRangeButton("1h")).toBeVisible();

    await charts.pnlRangeButton("1w").click();
    await expect(charts.pnlRangeButton("1w")).toBeVisible();

    await charts.pnlRangeButton("all").click();
    await expect(charts.pnlRangeButton("all")).toBeVisible();
  });

  test("empty-state hint appears on a fresh portfolio", async ({
    page,
    charts,
  }) => {
    await page.goto("/");
    // No trades have been made yet (resetBackendState flattens before each test).
    await expect(charts.pnlEmptyState).toBeVisible();
  });
});
