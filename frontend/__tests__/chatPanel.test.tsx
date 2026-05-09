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

/**
 * Build a `text/event-stream` Response from a list of (event, data) pairs.
 *
 * `chunks` controls how the body is split across `reader.read()` calls — by
 * default each event is its own ReadableStream chunk so the test exercises
 * the chunk-buffering path in `dispatchSseBlock`. Pass `chunks: "single"`
 * to deliver the whole body in one read.
 */
function sseResponse(
  events: Array<[string, object]>,
  opts: { chunks?: "per-event" | "single" } = {},
): Response {
  const encoder = new TextEncoder();
  const blocks = events.map(
    ([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`,
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.chunks === "single") {
        controller.enqueue(encoder.encode(blocks.join("")));
      } else {
        for (const block of blocks) {
          controller.enqueue(encoder.encode(block));
        }
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
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
    await waitFor(() =>
      expect(screen.getByTestId("chat-input")).toBeInTheDocument(),
    );
  });

  it("streams deltas into the assistant bubble and renders the final text", async () => {
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        return sseResponse([
          ["delta", { text: "Your cash balance " }],
          ["delta", { text: "is $10,000." }],
          [
            "done",
            {
              executed_trades: [],
              executed_watchlist_changes: [],
              error: null,
            },
          ],
        ]);
      }
      return baseRouting(call);
    });

    const { container } = render(<ChatPanel />);
    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "what's my balance?" },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    // User message is rendered immediately.
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid~="chat-message-user-0"]'),
      ).toBeInTheDocument();
    });

    // Assistant bubble accumulates both deltas.
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid~="chat-message-assistant-0"]'),
      ).toHaveTextContent(/Your cash balance is \$10,000\./);
    });

    // Loading bubble is gone after streaming completes.
    expect(screen.queryByTestId("chat-loading")).toBeNull();
  });

  it("renders inline trade receipts and watchlist_disabled notes from the done event", async () => {
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        return sseResponse([
          ["delta", { text: "Bought 10 NVDA. Watchlist actions are disabled now." }],
          [
            "done",
            {
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
            },
          ],
        ]);
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

    expect(screen.queryByTestId("chat-action-watchlist-PYPL")).toBeNull();
    const note = screen.getByTestId("chat-watchlist-disabled-0");
    expect(note).toHaveTextContent(/watchlist actions are disabled/i);
    expect(note.className).not.toMatch(/border-down/);
  });

  it("disables the input + send button while a request is in flight", async () => {
    let releaseStream: (() => void) | null = null;
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        // A stream that doesn't close until the test releases it. The
        // ChatPanel should keep `pending=true` for the entire window.
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            releaseStream = () => {
              controller.enqueue(
                encoder.encode(
                  'event: delta\ndata: {"text":"ok"}\n\n' +
                    'event: done\ndata: {"executed_trades":[],"executed_watchlist_changes":[],"error":null}\n\n',
                ),
              );
              controller.close();
            };
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
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

    releaseStream!();

    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it("shows the loading bubble until the first delta arrives", async () => {
    let pushDelta: (() => void) | null = null;
    let closeStream: (() => void) | null = null;
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            pushDelta = () => {
              controller.enqueue(
                encoder.encode('event: delta\ndata: {"text":"hello"}\n\n'),
              );
            };
            closeStream = () => {
              controller.enqueue(
                encoder.encode(
                  'event: done\ndata: {"executed_trades":[],"executed_watchlist_changes":[],"error":null}\n\n',
                ),
              );
              controller.close();
            };
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return baseRouting(call);
    });

    render(<ChatPanel />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    // Loading bubble visible while we haven't streamed any text yet.
    await waitFor(() => {
      expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
    });

    pushDelta!();

    // Once the first delta lands the loading bubble is replaced by the
    // assistant bubble.
    await waitFor(() => {
      expect(screen.queryByTestId("chat-loading")).toBeNull();
    });

    closeStream!();
  });

  it("surfaces an error event inline and persists the user turn", async () => {
    mockFetch((call) => {
      if (call.url === "/api/chat") {
        return sseResponse([
          [
            "error",
            {
              message: "Sorry — I couldn't reach the assistant just now.",
              error: "llm_call_failed",
            },
          ],
        ]);
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
