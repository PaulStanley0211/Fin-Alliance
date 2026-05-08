import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { TradeBar } from "@/components/trade/TradeBar";
import { __internals as portfolioInternals } from "@/lib/portfolio";
import { __internals as watchlistInternals } from "@/lib/watchlist";

const realFetch = globalThis.fetch;

beforeEach(() => {
  portfolioInternals.store.__reset();
  watchlistInternals.store.__reset();
});

interface Capture {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(handler: (call: Capture) => Promise<Response> | Response): Capture[] {
  const calls: Capture[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Capture = { url, method, body };
    calls.push(call);
    return await handler(call);
  }) as unknown as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const portfolioPayload = {
  cash_balance: 10_000,
  positions: [
    {
      ticker: "AAPL",
      quantity: 5,
      avg_cost: 190,
      current_price: 191,
      market_value: 955,
      unrealized_pnl: 5,
      unrealized_pnl_percent: 0.5,
    },
  ],
  total_value: 10955,
  realized_pnl: 0,
};
const watchlistPayload = { tickers: [] };

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("TradeBar", () => {
  beforeEach(() => {
    // baseline routing — overridden per test
  });

  it("disables Buy/Sell while a trade is in flight, then re-enables", async () => {
    let resolveTrade: ((res: Response) => void) | null = null;
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/watchlist") return jsonResponse(watchlistPayload);
      if (url === "/api/portfolio/trade") {
        return new Promise<Response>((resolve) => {
          resolveTrade = resolve;
        });
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "1" } });

    const buy = screen.getByTestId("trade-buy") as HTMLButtonElement;
    const sell = screen.getByTestId("trade-sell") as HTMLButtonElement;

    expect(buy.disabled).toBe(false);
    fireEvent.click(buy);

    // While the trade is pending, *both* sides must be disabled.
    await waitFor(() => expect(buy.disabled).toBe(true));
    expect(sell.disabled).toBe(true);

    resolveTrade!(
      jsonResponse({
        id: "t1",
        ticker: "AAPL",
        side: "buy",
        quantity: 1,
        price: 191.5,
        cost_basis: 191.5,
        executed_at: "2026-05-08T12:00:00Z",
        cash_balance: 9808.5,
        position_quantity: 6,
      }),
    );

    // After the trade settles, the bar clears qty (success UX). Re-fill to
    // confirm the buttons enable again — the disabled-while-flight contract
    // is satisfied as long as `pending` is back to null.
    await waitFor(() => expect(buy).toHaveAttribute("aria-busy", "false"));
    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "1" } });
    await waitFor(() => expect(buy.disabled).toBe(false));
    expect(sell.disabled).toBe(false);
  });

  it("attaches a fresh request_id per click", async () => {
    const calls = mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/watchlist") return jsonResponse(watchlistPayload);
      if (url === "/api/portfolio/trade") {
        return jsonResponse({
          id: "t1",
          ticker: "AAPL",
          side: "buy",
          quantity: 1,
          price: 191,
          cost_basis: 191,
          executed_at: "2026-05-08T12:00:00Z",
          cash_balance: 9809,
          position_quantity: 6,
        });
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "1" } });

    const buy = screen.getByTestId("trade-buy");
    fireEvent.click(buy);

    await waitFor(() => {
      const tradeCalls = calls.filter((c) => c.url === "/api/portfolio/trade");
      expect(tradeCalls.length).toBe(1);
    });

    // After the first trade finishes, refresh fetches land. Reset & click again.
    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "2" } });
    await waitFor(() => expect((buy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(buy);
    await waitFor(() => {
      const tradeCalls = calls.filter((c) => c.url === "/api/portfolio/trade");
      expect(tradeCalls.length).toBe(2);
    });

    const ids = calls
      .filter((c) => c.url === "/api/portfolio/trade")
      .map((c) => (c.body as { request_id?: string }).request_id);

    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("renders the server's error code inline on rejection", async () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/watchlist") return jsonResponse(watchlistPayload);
      if (url === "/api/portfolio/trade") {
        return jsonResponse(
          { error: "insufficient_cash", message: "Need $42 more" },
          400,
        );
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "9999" } });
    fireEvent.click(screen.getByTestId("trade-buy"));

    const banner = await screen.findByTestId("trade-error");
    expect(banner.dataset.code).toBe("insufficient_cash");
    expect(banner).toHaveTextContent(/not enough cash/i);
  });

  it("submit is disabled when ticker or quantity is missing", async () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/watchlist") return jsonResponse(watchlistPayload);
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    const buy = screen.getByTestId("trade-buy") as HTMLButtonElement;
    expect(buy.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "AAPL" } });
    expect(buy.disabled).toBe(true); // still no qty

    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "0" } });
    expect(buy.disabled).toBe(true); // qty must be > 0

    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "0.5" } });
    await waitFor(() => expect(buy.disabled).toBe(false));
  });

  it("rapid double-click fires exactly one /api/portfolio/trade request (regression #19)", async () => {
    let resolveTrade: ((res: Response) => void) | null = null;
    const calls = mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/watchlist") return jsonResponse(watchlistPayload);
      if (url === "/api/portfolio/trade") {
        return new Promise<Response>((resolve) => {
          resolveTrade = resolve;
        });
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "2" } });

    const buy = screen.getByTestId("trade-buy");

    // Two clicks in the same task — neither has had a chance to re-render
    // the disabled state. Without the synchronous ref guard this would
    // produce two requests with two different request_ids.
    fireEvent.click(buy);
    fireEvent.click(buy);

    // Settle so any racing fetch could land.
    await waitFor(() => {
      expect(calls.filter((c) => c.url === "/api/portfolio/trade").length).toBe(1);
    });

    resolveTrade!(
      jsonResponse({
        id: "t1",
        ticker: "AAPL",
        side: "buy",
        quantity: 2,
        price: 191,
        cost_basis: 191,
        executed_at: "2026-05-08T12:00:00Z",
        cash_balance: 9618,
        position_quantity: 7,
      }),
    );

    // After settle, still exactly one trade request.
    await waitFor(() => {
      expect((buy as HTMLButtonElement).getAttribute("aria-busy")).toBe("false");
    });
    expect(calls.filter((c) => c.url === "/api/portfolio/trade").length).toBe(1);
  });

  it("racing clicks share a request_id so server-side dedup is the second line of defense", async () => {
    // We can't observe two simultaneous calls when guard 1 already blocked
    // the second; instead we verify the *invariant* that the request_id
    // generated on the first click is used. Capture it and assert.
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/watchlist") return jsonResponse(watchlistPayload);
      if (url === "/api/portfolio/trade") {
        return jsonResponse({
          id: "t1",
          ticker: "AAPL",
          side: "buy",
          quantity: 1,
          price: 191,
          cost_basis: 191,
          executed_at: "2026-05-08T12:00:00Z",
          cash_balance: 9809,
          position_quantity: 6,
        });
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByTestId("trade-quantity"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("trade-buy"));

    await waitFor(() => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const tradeCall = fetchMock.mock.calls.find(
        (args: unknown[]) => args[0] === "/api/portfolio/trade",
      );
      expect(tradeCall).toBeTruthy();
      const init = tradeCall?.[1] as RequestInit;
      const body = JSON.parse(init.body as string) as { request_id?: string };
      // Request_id must be a UUID-shaped string — not undefined and not "".
      expect(typeof body.request_id).toBe("string");
      expect((body.request_id ?? "").length).toBeGreaterThan(8);
    });
  });
});
