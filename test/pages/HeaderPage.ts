import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class HeaderPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // Wrappers (contain the metric label + value).
  get cash(): Locator {
    return this.byTestId("header-cash");
  }

  get totalValue(): Locator {
    return this.byTestId("header-total");
  }

  // Inner numeric span — easier to assert on without label noise.
  get cashValue(): Locator {
    return this.byTestId("header-cash-value");
  }

  get totalValueValue(): Locator {
    return this.byTestId("header-total-value");
  }

  get statusDot(): Locator {
    return this.byTestId("header-status-dot");
  }

  async statusColor(): Promise<"green" | "yellow" | "red" | "unknown"> {
    const value = await this.statusDot.getAttribute("data-status");
    if (value === "green" || value === "yellow" || value === "red") return value;
    return "unknown";
  }

  /**
   * Parses a "$10,000.00" formatted PriceFlash value into a number, or null
   * when the metric renders the placeholder "—".
   */
  static parseDollar(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === "—" || trimmed.length === 0) return null;
    const cleaned = trimmed.replace(/[$,+\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  async readCash(): Promise<number | null> {
    const text = await this.cashValue.innerText();
    return HeaderPage.parseDollar(text);
  }

  async readTotal(): Promise<number | null> {
    const text = await this.totalValueValue.innerText();
    return HeaderPage.parseDollar(text);
  }
}
