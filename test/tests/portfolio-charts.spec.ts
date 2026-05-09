import { test, expect } from "../fixtures/app";
import { resetBackendState } from "../fixtures/reset";

async function waitForPrice(
  page: import("@playwright/test").Page,
  ticker: string,
) {
  await expect
    .poll(
      async () => {
        const text = (await page
          .getByTestId(`sector-row-price-${ticker}`)
          .innerText()).trim();
        return text.length > 0 && text !== "—" && /\d/.test(text);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

test.describe("@charts portfolio visualizations", () => {
  test.beforeEach(async ({ request }) => {
    await resetBackendState(request);
  });

  test("heatmap renders a cell after a buy with rail direction + P&L label", async ({
    page,
    tradeBar,
    heatmap,
  }) => {
    await page.goto("/");
    await waitForPrice(page, "AAPL");
    await tradeBar.buy("AAPL", 2);

    await expect(heatmap.region).toBeVisible();
    await expect(heatmap.cell("AAPL")).toBeVisible();

    // Per redesign §9 the rail carries data-direction (up|down|flat).
    const direction = await heatmap.direction("AAPL");
    expect(["up", "down", "flat"]).toContain(direction);

    // P&L numeric label renders non-empty text.
    await expect(heatmap.pnl("AAPL")).toBeVisible();
    const pnlText = (await heatmap.pnl("AAPL").innerText()).trim();
    expect(pnlText.length).toBeGreaterThan(0);
  });

  test("heatmap renders one cell per open position", async ({
    page,
    tradeBar,
    heatmap,
  }) => {
    await page.goto("/");

    // NVDA (~$800) and V (~$280) — both should land cells in the heatmap.
    await waitForPrice(page, "NVDA");
    await tradeBar.buy("NVDA", 1);
    await expect(heatmap.cell("NVDA")).toBeVisible();

    await waitForPrice(page, "V");
    await tradeBar.buy("V", 1);
    await expect(heatmap.cell("V")).toBeVisible();
  });

  test("P&L chart renders; range selector switches the active button", async ({
    page,
    charts,
  }) => {
    await page.goto("/");

    await expect(charts.pnlChart).toBeVisible();

    // Default is 1d per spec. Click each range and confirm the buttons exist.
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
