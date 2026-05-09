import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * TradeBar — restyled per redesign §7 / §11. The shipped UI:
 *
 *   trade-ticker        SPAN — read-only display of currently selected ticker
 *   trade-qty-minus     BUTTON — − stepper
 *   trade-qty           INPUT  — quantity (typeable + stepper-driven)
 *   trade-qty-plus      BUTTON — + stepper
 *   trade-buy           BUTTON
 *   trade-sell          BUTTON
 *
 * The ticker is no longer typed into the trade bar; it's derived from
 * `useSelectedTicker()`, which is updated by clicking a row in the
 * SectorWatchlist (or a button in the TickerStrip tape). Tests that want
 * to act on a specific ticker must select it first via the sectors
 * fixture, then call buy/sell with quantity only.
 *
 * The `buy(ticker, qty)` / `sell(ticker, qty)` helpers wrap that flow:
 * they click the sector row for the ticker, fill quantity, and click the
 * Buy / Sell button.
 */
export class TradeBarPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** Span showing the ticker the trade will be executed against. */
  get tickerDisplay(): Locator {
    return this.byTestId("trade-ticker");
  }

  get quantityInput(): Locator {
    return this.byTestId("trade-qty");
  }

  get incrementButton(): Locator {
    return this.byTestId("trade-qty-plus");
  }

  get decrementButton(): Locator {
    return this.byTestId("trade-qty-minus");
  }

  get buyButton(): Locator {
    return this.byTestId("trade-buy");
  }

  get sellButton(): Locator {
    return this.byTestId("trade-sell");
  }

  get error(): Locator {
    return this.byTestId("trade-error");
  }

  /** Click the sector row for `ticker` so the TradeBar binds to it. */
  async selectTicker(ticker: string): Promise<void> {
    await this.page.getByTestId(`sector-row-${ticker}`).click();
  }

  async readSelectedTicker(): Promise<string> {
    return (await this.tickerDisplay.innerText()).trim();
  }

  async setQuantity(quantity: number): Promise<void> {
    await this.quantityInput.fill(String(quantity));
  }

  async buy(ticker: string, quantity: number): Promise<void> {
    await this.selectTicker(ticker);
    await this.setQuantity(quantity);
    await this.buyButton.click();
  }

  async sell(ticker: string, quantity: number): Promise<void> {
    await this.selectTicker(ticker);
    await this.setQuantity(quantity);
    await this.sellButton.click();
  }

  async incrementQuantity(times: number = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.incrementButton.click();
    }
  }

  async decrementQuantity(times: number = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.decrementButton.click();
    }
  }

  async readQuantity(): Promise<number | null> {
    const value = await this.quantityInput.inputValue();
    if (!value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
