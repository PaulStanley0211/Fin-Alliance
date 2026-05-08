import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class PositionsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get table(): Locator {
    return this.byTestId("positions-table");
  }

  row(ticker: string): Locator {
    return this.byTestId(`position-row-${ticker}`);
  }

  quantity(ticker: string): Locator {
    return this.byTestId(`position-quantity-${ticker}`);
  }

  avgCost(ticker: string): Locator {
    return this.byTestId(`position-avg-cost-${ticker}`);
  }

  unrealizedPnl(ticker: string): Locator {
    return this.byTestId(`position-pnl-${ticker}`);
  }
}
