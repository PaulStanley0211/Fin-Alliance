import { test, expect } from "../fixtures/app";
import { resetBackendState } from "../fixtures/reset";

test.describe("@portfolio idempotency", () => {
  test.beforeEach(async ({ request }) => {
    await resetBackendState(request);
  });

  test("rapid double-click on Buy does not duplicate the trade", async ({
    page,
    tradeBar,
    positions,
  }) => {
    await page.goto("/");

    await tradeBar.tickerInput.fill("AAPL");
    await tradeBar.quantityInput.fill("2");

    // Wait for the button to actually be enabled (canSubmit is gated on
    // ticker + qty + no in-flight pending state).
    await expect(tradeBar.buyButton).toBeEnabled();

    // Fire two click events back-to-back via the DOM, BEFORE Playwright's
    // auto-wait can detect the disabled state. Plain Locator.click() retries
    // on `not enabled` and would never fire the second click. Using
    // dispatchEvent bypasses the visibility/enabled checks and simulates a
    // user mashing the mouse — which is exactly the scenario we're testing.
    await tradeBar.buyButton.evaluate((el) => {
      const btn = el as HTMLButtonElement;
      btn.click();
      btn.click();
    });

    await expect(positions.row("AAPL")).toBeVisible();
    await expect(positions.quantity("AAPL")).toHaveText("2");
  });
});
