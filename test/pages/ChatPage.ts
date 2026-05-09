import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * ChatPanel renders each `<li>` with a SPACE-SEPARATED data-testid combining
 * a flat `chat-message-{i}` and a role-scoped `chat-message-{role}-{j}`.
 * `getByTestId` does an exact match and would miss those, so we use the
 * `~=` whitespace-token selector via `byTestIdToken`.
 */
export class ChatPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get panel(): Locator {
    return this.byTestId("chat-panel");
  }

  get input(): Locator {
    return this.byTestId("chat-input");
  }

  get sendButton(): Locator {
    return this.byTestId("chat-send");
  }

  get loading(): Locator {
    return this.byTestId("chat-loading");
  }

  get messages(): Locator {
    // Match either the flat or role-scoped token on any chat message <li>.
    return this.page.locator('[data-testid*="chat-message-"]');
  }

  message(index: number): Locator {
    return this.byTestIdToken(`chat-message-${index}`);
  }

  userMessage(roleIndex: number): Locator {
    return this.byTestIdToken(`chat-message-user-${roleIndex}`);
  }

  assistantMessage(roleIndex: number): Locator {
    return this.byTestIdToken(`chat-message-assistant-${roleIndex}`);
  }

  lastAssistantMessage(): Locator {
    return this.page.locator('[data-testid*="chat-message-assistant-"]').last();
  }

  tradeAction(ticker: string): Locator {
    return this.byTestId(`chat-action-trade-${ticker}`);
  }

  watchlistAction(ticker: string): Locator {
    return this.byTestId(`chat-action-watchlist-${ticker}`);
  }

  /**
   * Rejection chips rendered when the executor short-circuits a
   * watchlist_changes action with `error: "watchlist_disabled"` (redesign
   * spec §6 / §8). The frontend ships these as muted italic notices with
   * INDEX-BASED testids — `chat-watchlist-disabled-0`, `-1`, `-2`, …
   * (one per chip across the entire conversation, NOT keyed by ticker).
   * The chip text is the constant string "watchlist actions are disabled".
   *
   * Use `nthWatchlistDisabled(n)` for a specific occurrence and
   * `anyWatchlistDisabled` for "at least one is rendered" assertions.
   */
  nthWatchlistDisabled(n: number): Locator {
    return this.byTestId(`chat-watchlist-disabled-${n}`);
  }

  get anyWatchlistDisabled(): Locator {
    return this.page.locator('[data-testid^="chat-watchlist-disabled-"]');
  }

  async send(text: string): Promise<void> {
    await this.input.fill(text);
    await this.sendButton.click();
  }
}
