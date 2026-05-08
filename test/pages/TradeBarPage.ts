import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class TradeBarPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get tickerInput(): Locator {
    return this.byTestId("trade-ticker");
  }

  get quantityInput(): Locator {
    return this.byTestId("trade-quantity");
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

  async buy(ticker: string, quantity: number): Promise<void> {
    await this.tickerInput.fill(ticker);
    await this.quantityInput.fill(String(quantity));
    await this.buyButton.click();
  }

  async sell(ticker: string, quantity: number): Promise<void> {
    await this.tickerInput.fill(ticker);
    await this.quantityInput.fill(String(quantity));
    await this.sellButton.click();
  }
}
