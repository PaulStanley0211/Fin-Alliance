import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { __internals as portfolioInternals } from "@/lib/portfolio";

const realFetch = globalThis.fetch;

beforeEach(() => {
  portfolioInternals.store.__reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

interface Capture {
  url: string;
  body: unknown;
}

function mockFetch(handler: (call: Capture) => Promise<Response> | Response): Capture[] {
  const calls: Capture[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Capture = { url, body };
    calls.push(call);
    return await handler(call);
  }) as unknown as typeof fetch;
  return calls;
}

const portfolioPayload = {
  cash_balance: 10_000,
  positions: [],
  total_value: 10_000,
  realized_pnl: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseRouting = ({ url }: Capture) => {
  if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
  return jsonResponse({ error: "not_found", message: "x" }, 404);
};

describe("ChatPanel", () => {
  it("renders the empty state and disabled send button on mount", async () => {
    mockFetch(baseRouting);
    render(<ChatPanel />);
    expect(screen.getByText(/ask finally anything/i)).toBeInTheDocument();
    const send = screen.getByTestId("chat-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    // Allow the portfolio initial fetch to flush so React's act() warning
    // doesn't fire on subsequent state updates.
    await waitFor(() =>
      expect(screen.getByTestId("chat-input")).toBeInTheDocument(),
    );
  });

  it("sends the message, shows loading, then renders the assistant reply", async () => {
    let resolveChat: ((res: Response) => void) | null = null;
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        return new Promise<Response>((resolve) => {
          resolveChat = resolve;
        });
      }
      return baseRouting(call);
    });

    const { container } = render(<ChatPanel />);
    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "what's my balance?" },
    });

    const send = screen.getByTestId("chat-send");
    fireEvent.click(send);

    // Loading bubble shows; user message in DOM
    await waitFor(() => {
      expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
    });
    expect(
      container.querySelector('[data-testid~="chat-message-0"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid~="chat-message-user-0"]'),
    ).toBeInTheDocument();

    resolveChat!(
      jsonResponse({
        message: "Your cash balance is $10,000.",
        executed_trades: [],
        executed_watchlist_changes: [],
        error: null,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-loading")).toBeNull();
    });

    // Both flat (chat-message-1) and role-scoped (chat-message-assistant-0)
    // testids should resolve the same DOM node.
    const flat = container.querySelector('[data-testid~="chat-message-1"]');
    const role = container.querySelector('[data-testid~="chat-message-assistant-0"]');
    expect(flat).toBe(role);
    expect(flat).toHaveTextContent(/Your cash balance is \$10,000\./);
  });

  it("renders inline trade receipts and watchlist_disabled notes with the right testids", async () => {
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        return jsonResponse({
          message: "Bought 10 NVDA. Watchlist actions are disabled now.",
          executed_trades: [
            {
              ticker: "NVDA",
              side: "buy",
              quantity: 10,
              status: "executed",
              price: 800.5,
              error: null,
            },
            {
              ticker: "BRK",
              side: "buy",
              quantity: 1,
              status: "rejected",
              price: null,
              error: "ticker_unsupported",
            },
          ],
          executed_watchlist_changes: [
            {
              ticker: "PYPL",
              action: "add",
              status: "rejected",
              error: "watchlist_disabled",
            },
          ],
          error: null,
        });
      }
      return baseRouting(call);
    });

    render(<ChatPanel />);
    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "buy 10 NVDA and watch PYPL" },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-action-trade-NVDA")).toBeInTheDocument();
    });

    expect(screen.getByTestId("chat-action-trade-NVDA").dataset.status).toBe("executed");
    expect(screen.getByTestId("chat-action-trade-BRK").dataset.status).toBe("rejected");
    expect(screen.getByTestId("chat-action-trade-NVDA")).toHaveTextContent(/800\.50/);
    expect(screen.getByTestId("chat-action-trade-BRK")).toHaveTextContent(/ticker not supported/i);

    // watchlist_disabled rejections render as a muted note, not a red error chip.
    expect(screen.queryByTestId("chat-action-watchlist-PYPL")).toBeNull();
    const note = screen.getByTestId("chat-watchlist-disabled-0");
    expect(note).toHaveTextContent(/watchlist actions are disabled/i);
    // Should NOT carry the red error chip styling (no down/down border).
    expect(note.className).not.toMatch(/border-down/);
  });

  it("disables the input + send button while a request is in flight", async () => {
    let resolveChat: ((res: Response) => void) | null = null;
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        return new Promise<Response>((resolve) => {
          resolveChat = resolve;
        });
      }
      return baseRouting(call);
    });

    render(<ChatPanel />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    const input = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    const send = screen.getByTestId("chat-send") as HTMLButtonElement;

    await waitFor(() => expect(input.disabled).toBe(true));
    expect(send.disabled).toBe(true);

    resolveChat!(
      jsonResponse({
        message: "ok",
        executed_trades: [],
        executed_watchlist_changes: [],
        error: null,
      }),
    );

    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it("surfaces an error envelope inline when the LLM call failed server-side", async () => {
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        return jsonResponse({
          message: "Sorry — I couldn't reach the assistant just now.",
          executed_trades: [],
          executed_watchlist_changes: [],
          error: "llm_call_failed",
        });
      }
      return baseRouting(call);
    });

    const { container } = render(<ChatPanel />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(
        container.querySelector('[data-testid~="chat-message-assistant-0"]'),
      ).toHaveTextContent(/sorry/i);
    });
  });
});
