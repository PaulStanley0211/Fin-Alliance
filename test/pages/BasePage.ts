import type { Locator, Page } from "@playwright/test";

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Match a single token in a multi-token `data-testid` attribute. ChatBubble
   * carries both a flat and a role-scoped testid separated by a space; the
   * default `getByTestId` does an exact match and would miss those. The CSS
   * `~=` selector matches whitespace-separated tokens.
   */
  byTestIdToken(token: string): Locator {
    return this.page.locator(`[data-testid~="${cssEscape(token)}"]`);
  }

  async goto(path: string = "/"): Promise<void> {
    await this.page.goto(path);
  }
}
