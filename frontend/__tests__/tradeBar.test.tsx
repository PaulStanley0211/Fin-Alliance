import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import { TradeBar } from "@/components/trade/TradeBar";
import { __internals as portfolioInternals } from "@/lib/portfolio";
import { setSelectedTicker, __resetSelection } from "@/lib/selection";

const realFetch = globalThis.fetch;

beforeEach(() => {
  portfolioInternals.store.__reset();
  __resetSelection();
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

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function selectAAPL() {
  act(() => {
    setSelectedTicker("AAPL");
  });
}

function tradeOk(): Response {
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

describe("TradeBar — empty state and stepper", () => {
  it("shows the empty-state message when no ticker is selected", () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    expect(screen.getByTestId("trade-empty-state")).toHaveTextContent(
      /select a ticker from the watchlist to trade/i,
    );
    expect(screen.queryByTestId("trade-ticker")).toBeNull();
    expect(screen.queryByTestId("trade-qty")).toBeNull();
  });

  it("renders ticker label and the stepper once a ticker is selected", () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();

    expect(screen.getByTestId("trade-ticker")).toHaveTextContent("AAPL");
    const qty = screen.getByTestId("trade-qty") as HTMLInputElement;
    expect(qty.value).toBe("1");
    expect(screen.getByTestId("trade-qty-minus")).toBeInTheDocument();
    expect(screen.getByTestId("trade-qty-plus")).toBeInTheDocument();
  });

  it("+ increments and − decrements; minus disabled at qty=1", () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();

    const qty = screen.getByTestId("trade-qty") as HTMLInputElement;
    const plus = screen.getByTestId("trade-qty-plus") as HTMLButtonElement;
    const minus = screen.getByTestId("trade-qty-minus") as HTMLButtonElement;

    expect(qty.value).toBe("1");
    expect(minus.disabled).toBe(true);

    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(qty.value).toBe("4");
    expect(minus.disabled).toBe(false);

    fireEvent.click(minus);
    expect(qty.value).toBe("3");
  });

  it("clamps typed quantity to integer min=1", () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();
    const qty = screen.getByTestId("trade-qty") as HTMLInputElement;

    fireEvent.change(qty, { target: { value: "0" } });
    expect(qty.value).toBe("1"); // clamped

    fireEvent.change(qty, { target: { value: "12" } });
    expect(qty.value).toBe("12");
  });

  it("Buy and Sell appear below the qty stepper as a 2-column row", () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();

    const qty = screen.getByTestId("trade-qty");
    const buy = screen.getByTestId("trade-buy");
    const sell = screen.getByTestId("trade-sell");

    const order = [qty, buy, sell];
    for (let i = 0; i < order.length - 1; i++) {
      // eslint-disable-next-line no-bitwise
      const cmp = order[i].compareDocumentPosition(order[i + 1]);
      expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("TradeBar — submit + idempotency", () => {
  it("disables Buy/Sell while a trade is in flight, then re-enables", async () => {
    let resolveTrade: ((res: Response) => void) | null = null;
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/portfolio/trade") {
        return new Promise<Response>((resolve) => {
          resolveTrade = resolve;
        });
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();

    const buy = screen.getByTestId("trade-buy") as HTMLButtonElement;
    const sell = screen.getByTestId("trade-sell") as HTMLButtonElement;
    expect(buy.disabled).toBe(false);

    fireEvent.click(buy);
    await waitFor(() => expect(buy.disabled).toBe(true));
    expect(sell.disabled).toBe(true);

    resolveTrade!(tradeOk());

    await waitFor(() => expect(buy).toHaveAttribute("aria-busy", "false"));
    await waitFor(() => expect(buy.disabled).toBe(false));
    expect(sell.disabled).toBe(false);
  });

  it("attaches a fresh request_id per click", async () => {
    const calls = mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/portfolio/trade") return tradeOk();
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();

    const buy = screen.getByTestId("trade-buy");
    fireEvent.click(buy);

    await waitFor(() => {
      expect(calls.filter((c) => c.url === "/api/portfolio/trade").length).toBe(1);
    });

    await waitFor(() => expect((buy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(buy);
    await waitFor(() => {
      expect(calls.filter((c) => c.url === "/api/portfolio/trade").length).toBe(2);
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
      if (url === "/api/portfolio/trade") {
        return jsonResponse(
          { error: "insufficient_cash", message: "Need $42 more" },
          400,
        );
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();
    fireEvent.click(screen.getByTestId("trade-buy"));

    const banner = await screen.findByTestId("trade-error");
    expect(banner.dataset.code).toBe("insufficient_cash");
    expect(banner).toHaveTextContent(/not enough cash/i);
  });

  it("rapid double-click fires exactly one /api/portfolio/trade request (regression #19)", async () => {
    let resolveTrade: ((res: Response) => void) | null = null;
    const calls = mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/portfolio/trade") {
        return new Promise<Response>((resolve) => {
          resolveTrade = resolve;
        });
      }
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();

    const buy = screen.getByTestId("trade-buy");
    fireEvent.click(buy);
    fireEvent.click(buy);

    await waitFor(() => {
      expect(calls.filter((c) => c.url === "/api/portfolio/trade").length).toBe(1);
    });

    resolveTrade!(tradeOk());

    await waitFor(() =>
      expect((buy as HTMLButtonElement).getAttribute("aria-busy")).toBe("false"),
    );
    expect(calls.filter((c) => c.url === "/api/portfolio/trade").length).toBe(1);
  });

  it("sends a UUID-shaped request_id on the first click", async () => {
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioPayload);
      if (url === "/api/portfolio/trade") return tradeOk();
      return jsonResponse({}, 404);
    });

    render(<TradeBar />);
    selectAAPL();
    fireEvent.click(screen.getByTestId("trade-buy"));

    await waitFor(() => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const tradeCall = fetchMock.mock.calls.find(
        (args: unknown[]) => args[0] === "/api/portfolio/trade",
      );
      expect(tradeCall).toBeTruthy();
      const init = tradeCall?.[1] as RequestInit;
      const body = JSON.parse(init.body as string) as { request_id?: string };
      expect(typeof body.request_id).toBe("string");
      expect((body.request_id ?? "").length).toBeGreaterThan(8);
    });
  });
});
