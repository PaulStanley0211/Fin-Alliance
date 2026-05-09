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

    // Wait briefly so the simulator has a chance to push at least one tick
    // for AAPL — the backend rejects trades with `price_unavailable` if the
    // ticker has no current price yet, even on the LLM path.
    await page.waitForTimeout(1500);

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

  test("'watch PYPL' is rejected with the watchlist-disabled chip", async ({
    page,
    chat,
  }) => {
    // Per redesign §6 / §8, the LLM executor short-circuits any
    // watchlist_changes action with `error: "watchlist_disabled"`. The
    // ChatPanel renders these via a muted, italic, INDEX-BASED notice
    // (`chat-watchlist-disabled-{N}`, where N starts at 0 and counts
    // disabled chips across the conversation).
    await page.goto("/");

    await chat.send("watch PYPL");
    await expect(chat.loading).toBeHidden({ timeout: 15_000 });

    const chip = chat.nthWatchlistDisabled(0);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/watchlist actions are disabled/i);
  });

  test("'unwatch AAPL' is rejected with the watchlist-disabled chip", async ({
    page,
    chat,
  }) => {
    // Symmetric coverage for the remove path. The mock dispatch table
    // (PLAN.md §9) emits a `watchlist_changes: [{action: "remove"}]` entry,
    // which the executor short-circuits identically.
    await page.goto("/");

    await chat.send("unwatch AAPL");
    await expect(chat.loading).toBeHidden({ timeout: 15_000 });

    const chip = chat.nthWatchlistDisabled(0);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/watchlist actions are disabled/i);
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
