import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * MainChart + PnLChart locators. The redesign keeps both components; the
 * old holdings-list / treemap that lived alongside them is now owned by
 * HeatmapPage (PortfolioHeatmap, restored per §8 / §9).
 */
export class ChartsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get mainChart(): Locator {
    return this.byTestId("main-chart");
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
