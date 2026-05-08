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

  async send(text: string): Promise<void> {
    await this.input.fill(text);
    await this.sendButton.click();
  }
}
