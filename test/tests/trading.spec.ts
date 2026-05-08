import { test, expect } from "../fixtures/app";
import { resetBackendState } from "../fixtures/reset";

test.describe("@portfolio buy / sell flows", () => {
  test.beforeEach(async ({ request }) => {
    await resetBackendState(request);
  });

  test("buy decreases cash, opens a position, updates total", async ({
    page,
    header,
    tradeBar,
    positions,
  }) => {
    await page.goto("/");
    // Wait for the cash value to be readable. We don't pin to $10,000 —
    // resetBackendState may leave a few cents of drift from prior sells.
    await expect
      .poll(async () => header.readCash(), { timeout: 10_000 })
      .not.toBeNull();

    const cashBefore = await header.readCash();
    expect(cashBefore).not.toBeNull();

    await tradeBar.buy("AAPL", 5);

    // Confirmation chip shows up.
    await expect(page.getByTestId("trade-confirmation")).toBeVisible();

    // Position row appears for AAPL with quantity 5.
    await expect(positions.row("AAPL")).toBeVisible();
    await expect(positions.quantity("AAPL")).toHaveText("5");

    // Cash decreased.
    await expect
      .poll(async () => header.readCash(), { timeout: 10_000 })
      .toBeLessThan(cashBefore!);
  });

  test("sell flattens the position; row disappears at zero qty", async ({
    page,
    header,
    tradeBar,
    positions,
  }) => {
    await page.goto("/");
    await expect
      .poll(async () => header.readCash(), { timeout: 10_000 })
      .not.toBeNull();

    // Open a 3-share AAPL position.
    await tradeBar.buy("AAPL", 3);
    await expect(positions.row("AAPL")).toBeVisible();
    await expect(positions.quantity("AAPL")).toHaveText("3");

    const cashAfterBuy = await header.readCash();
    expect(cashAfterBuy).not.toBeNull();

    // Sell all 3.
    await tradeBar.sell("AAPL", 3);

    // Row disappears (zero qty deletes per §7).
    await expect(positions.row("AAPL")).toHaveCount(0);

    // Cash increased relative to post-buy state.
    await expect
      .poll(async () => header.readCash(), { timeout: 10_000 })
      .toBeGreaterThan(cashAfterBuy!);
  });

  test("buying more than cash allows surfaces an error", async ({
    page,
    tradeBar,
  }) => {
    await page.goto("/");

    // NVDA seeds at ~$800 on the simulator allowlist; 100 shares ≈ $80k > $10k.
    await tradeBar.buy("NVDA", 100);

    const error = page.getByTestId("trade-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("data-code", "insufficient_cash");
  });
});
