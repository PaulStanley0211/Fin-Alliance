import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * PortfolioHeatmap (restored, subtle styling per redesign §9).
 *
 * Color is conveyed via a 2px left-edge rail (`heatmap-cell-rail-{TICKER}`,
 * `data-direction="up|down|flat"`) plus a tinted P&L numeric label
 * (`heatmap-cell-pnl-{TICKER}`). Cell area encodes portfolio weight.
 */
export class HeatmapPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get region(): Locator {
    return this.byTestId("region-heatmap");
  }

  /**
   * All position cells in the heatmap. Filters out the inner -pnl- and
   * -rail- children that share the `heatmap-cell-` testid prefix.
   */
  get cells(): Locator {
    return this.page.locator(
      '[data-testid^="heatmap-cell-"]:not([data-testid^="heatmap-cell-pnl-"]):not([data-testid^="heatmap-cell-rail-"])',
    );
  }

  cell(ticker: string): Locator {
    return this.byTestId(`heatmap-cell-${ticker}`);
  }

  rail(ticker: string): Locator {
    return this.byTestId(`heatmap-cell-rail-${ticker}`);
  }

  pnl(ticker: string): Locator {
    return this.byTestId(`heatmap-cell-pnl-${ticker}`);
  }

  async direction(ticker: string): Promise<"up" | "down" | "flat" | "unknown"> {
    const value = await this.rail(ticker).getAttribute("data-direction");
    if (value === "up" || value === "down" || value === "flat") return value;
    return "unknown";
  }
}
