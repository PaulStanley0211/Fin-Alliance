import { test, expect } from "../fixtures/app";
import { resetBackendState } from "../fixtures/reset";

test.describe("@portfolio idempotency", () => {
  test.beforeEach(async ({ request }) => {
    await resetBackendState(request);
  });

  test("rapid double-click on Buy does not duplicate the trade", async ({
    page,
    sectors,
    tradeBar,
    positions,
  }) => {
    await page.goto("/");

    // Wait for AAPL to have a streamed price so the trade isn't rejected
    // with `price_unavailable`.
    await expect
      .poll(
        async () => {
          const text = (await sectors.price("AAPL").innerText()).trim();
          return text.length > 0 && text !== "—" && /\d/.test(text);
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    await sectors.selectTicker("AAPL");
    await tradeBar.setQuantity(2);

    // Wait for the button to actually be enabled (canSubmit gates on
    // selected ticker + qty + price + no in-flight pending state).
    await expect(tradeBar.buyButton).toBeEnabled();

    // Fire two click events back-to-back via the DOM, BEFORE Playwright's
    // auto-wait can detect the disabled state. Plain Locator.click() retries
    // on `not enabled` and would never fire the second click. Using a raw
    // .click() in a page.evaluate bypasses Playwright's checks and simulates
    // a user mashing the mouse — which is exactly the scenario we're testing.
    await tradeBar.buyButton.evaluate((el) => {
      const btn = el as HTMLButtonElement;
      btn.click();
      btn.click();
    });

    await expect(positions.row("AAPL")).toBeVisible();
    await expect(positions.quantity("AAPL")).toHaveText("2");
  });
});
