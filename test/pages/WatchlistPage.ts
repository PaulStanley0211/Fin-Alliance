import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class WatchlistPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get panel(): Locator {
    return this.byTestId("watchlist-panel");
  }

  get rows(): Locator {
    return this.page.locator('[data-testid^="watchlist-row-"]');
  }

  row(ticker: string): Locator {
    return this.byTestId(`watchlist-row-${ticker}`);
  }

  price(ticker: string): Locator {
    return this.byTestId(`watchlist-price-${ticker}`);
  }

  removeButton(ticker: string): Locator {
    return this.byTestId(`watchlist-remove-${ticker}`);
  }

  get addInput(): Locator {
    return this.byTestId("watchlist-add-input");
  }

  get addSubmit(): Locator {
    return this.byTestId("watchlist-add-submit");
  }

  async addTicker(ticker: string): Promise<void> {
    await this.addInput.fill(ticker);
    await this.addSubmit.click();
  }

  async clickTicker(ticker: string): Promise<void> {
    await this.row(ticker).click();
  }
}
