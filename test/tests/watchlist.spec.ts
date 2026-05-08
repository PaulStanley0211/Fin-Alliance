import { test, expect } from "../fixtures/app";
import { resetBackendState } from "../fixtures/reset";

test.describe("@watchlist add/remove flow", () => {
  test.beforeEach(async ({ request }) => {
    await resetBackendState(request);
  });

  test("PYPL can be added and removed via the UI", async ({ page, watchlist }) => {
    await page.goto("/");
    await expect(watchlist.panel).toBeVisible();

    // Add PYPL.
    await watchlist.addTicker("PYPL");
    await expect(watchlist.row("PYPL")).toBeVisible();

    // Price tick lands within 5s.
    await expect
      .poll(
        async () => {
          const text = (await watchlist.price("PYPL").innerText()).trim();
          return text.length > 0 && text !== "—" && /\d/.test(text);
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    // Remove PYPL — hover over the row to reveal the remove button (it's
    // hidden via group-hover until you mouse over the row).
    const row = watchlist.row("PYPL");
    await row.hover();
    await watchlist.removeButton("PYPL").click({ force: true });
    await expect(watchlist.row("PYPL")).toHaveCount(0);
  });

  test("rejects unsupported ticker with a visible error", async ({
    page,
    watchlist,
  }) => {
    await page.goto("/");
    await watchlist.addTicker("ZZZZ");
    await expect(page.getByTestId("watchlist-error")).toBeVisible();
    await expect(watchlist.row("ZZZZ")).toHaveCount(0);
  });
});
