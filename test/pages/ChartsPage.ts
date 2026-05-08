import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class ChartsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get mainChart(): Locator {
    return this.byTestId("main-chart");
  }

  // Holdings list (replaced the treemap heatmap; same panel region).
  get holdingsList(): Locator {
    return this.byTestId("positions-list");
  }

  holdingsRow(ticker: string): Locator {
    return this.byTestId(`holdings-row-${ticker}`);
  }

  holdingsValue(ticker: string): Locator {
    return this.byTestId(`holdings-value-${ticker}`);
  }

  holdingsPnl(ticker: string): Locator {
    return this.byTestId(`holdings-pnl-${ticker}`);
  }

  holdingsPnlPercent(ticker: string): Locator {
    return this.byTestId(`holdings-pnl-percent-${ticker}`);
  }

  holdingsWeight(ticker: string): Locator {
    return this.byTestId(`holdings-weight-${ticker}`);
  }

  /** All holdings rows in render order (sorted by market value desc). */
  get holdingsRows(): Locator {
    return this.page.locator('[data-testid^="holdings-row-"]');
  }

  get pnlChart(): Locator {
    return this.byTestId("pnl-chart");
  }

  get pnlEmptyState(): Locator {
    return this.byTestId("pnl-empty-state");
  }

  pnlRangeButton(range: "1h" | "1d" | "1w" | "1m" | "all"): Locator {
    return this.byTestId(`pnl-range-${range}`);
  }
}
