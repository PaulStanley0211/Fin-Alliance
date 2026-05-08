import { test, expect } from "../fixtures/app";
import { resetBackendState } from "../fixtures/reset";

test.describe("@chat mocked LLM", () => {
  test.beforeEach(async ({ request }) => {
    await resetBackendState(request);
  });

  test("'buy 5 AAPL' executes and reflects in positions", async ({
    page,
    chat,
    positions,
  }) => {
    await page.goto("/");

    await chat.send("buy 5 AAPL");

    // Loading bubble appears then disappears.
    await expect(chat.loading).toBeHidden({ timeout: 15_000 });

    // Inline trade receipt with status=executed.
    const receipt = chat.tradeAction("AAPL");
    await expect(receipt).toBeVisible();
    await expect(receipt).toHaveAttribute("data-status", "executed");

    // Positions table reflects the buy.
    await expect(positions.row("AAPL")).toBeVisible();
    await expect(positions.quantity("AAPL")).toHaveText("5");
  });

  test("'watch PYPL' adds PYPL to the watchlist via chat", async ({
    page,
    chat,
    watchlist,
  }) => {
    await page.goto("/");

    await chat.send("watch PYPL");
    await expect(chat.loading).toBeHidden({ timeout: 15_000 });

    const receipt = chat.watchlistAction("PYPL");
    await expect(receipt).toBeVisible();
    await expect(receipt).toHaveAttribute("data-status", "executed");

    // Watchlist UI picked up the new ticker.
    await expect(watchlist.row("PYPL")).toBeVisible();
  });

  test("conversational greeting returns a non-empty assistant turn", async ({
    page,
    chat,
  }) => {
    await page.goto("/");

    await chat.send("hi");
    await expect(chat.loading).toBeHidden({ timeout: 15_000 });

    const assistant = chat.assistantMessage(0);
    await expect(assistant).toBeVisible();
    const text = (await assistant.innerText()).trim();
    expect(text.length).toBeGreaterThan(0);
  });
});
