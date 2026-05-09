import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * SectorWatchlist replaces the legacy WatchlistPanel. The redesign spec
 * (`docs/superpowers/specs/2026-05-09-finally-redesign-design.md` §7)
 * organises the 50 streaming tickers into 5 collapsible sector groups.
 *
 * Actual `data-testid` contract shipped by frontend-engineer in #7:
 *   - `region-watchlist` — outer panel <section>
 *   - `sector-watchlist` — inner wrapper
 *   - `sector-group-{sectorId}` — disclosure wrapper for each sector (<li>)
 *   - `sector-group-toggle-{sectorId}` — clickable header that opens/closes
 *   - `sector-row-{TICKER}` — per-ticker row (<li>)
 *   - `sector-row-price-{TICKER}` — price cell within the row
 *   - `sector-row-change-{TICKER}` — sector-relative day change %
 *
 * Sector ids match the SECTORS_VERSION "1.1" taxonomy (task #14): technology,
 * healthcare, financial, consumer, energy. Materials was dropped from v1.0
 * to fit Finnhub's free-tier 50-symbol WebSocket subscription cap.
 */
export const SECTOR_IDS = [
  "technology",
  "healthcare",
  "financial",
  "consumer",
  "energy",
] as const;

export type SectorId = (typeof SECTOR_IDS)[number];

export class SectorWatchlistPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get panel(): Locator {
    return this.byTestId("region-watchlist");
  }

  group(sector: SectorId): Locator {
    return this.byTestId(`sector-group-${sector}`);
  }

  groupToggle(sector: SectorId): Locator {
    return this.byTestId(`sector-group-toggle-${sector}`);
  }

  /**
   * All sector ROW <li> elements across every group, in DOM order. Filters
   * out the price/change <span>s that share the `sector-row-` testid prefix.
   */
  get rows(): Locator {
    return this.page.locator(
      '[data-testid^="sector-row-"]:not([data-testid^="sector-row-price-"]):not([data-testid^="sector-row-change-"])',
    );
  }

  row(ticker: string): Locator {
    return this.byTestId(`sector-row-${ticker}`);
  }

  price(ticker: string): Locator {
    return this.byTestId(`sector-row-price-${ticker}`);
  }

  change(ticker: string): Locator {
    return this.byTestId(`sector-row-change-${ticker}`);
  }

  /** Click a sector row → drives `useSelectedTicker()` → MainChart updates. */
  async selectTicker(ticker: string): Promise<void> {
    await this.row(ticker).click();
  }

  async toggleGroup(sector: SectorId): Promise<void> {
    await this.groupToggle(sector).click();
  }
}
