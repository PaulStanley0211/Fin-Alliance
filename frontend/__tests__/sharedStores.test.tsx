import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

import { usePortfolio, __internals as portfolioInternals } from "@/lib/portfolio";
import { useSectors, __internals as sectorsInternals } from "@/lib/sectors";

const realFetch = globalThis.fetch;

beforeEach(() => {
  portfolioInternals.store.__reset();
  sectorsInternals.store.__reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

interface Capture {
  url: string;
  method: string;
}

function mockFetch(handler: (call: Capture) => Response): Capture[] {
  const calls: Capture[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    return handler({ url, method });
  }) as unknown as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const portfolioV1 = {
  cash_balance: 10000,
  positions: [],
  total_value: 10000,
  realized_pnl: 0,
};

const portfolioV2 = {
  cash_balance: 9000,
  positions: [
    {
      ticker: "AAPL",
      quantity: 5,
      avg_cost: 200,
      current_price: 201,
      market_value: 1005,
      unrealized_pnl: 5,
      unrealized_pnl_percent: 0.5,
    },
  ],
  total_value: 10005,
  realized_pnl: 0,
};

const sectorsV1 = {
  version: "1.1",
  sectors: [{ id: "technology", label: "Technology", tickers: ["AAPL"] }],
};
const sectorsV2 = {
  version: "1.2",
  sectors: [
    { id: "technology", label: "Technology", tickers: ["AAPL", "MSFT"] },
  ],
};

function PortfolioReader({ id }: { id: string }) {
  const portfolio = usePortfolio();
  return (
    <div data-testid={id}>
      cash:{portfolio.data?.cash_balance ?? "—"} positions:{portfolio.data?.positions.length ?? 0}
    </div>
  );
}

function SectorsReader({ id }: { id: string }) {
  const sectors = useSectors();
  const tickers = sectors.sectors.flatMap((s) => s.tickers).join(",");
  return <div data-testid={id}>tickers:{tickers}</div>;
}

describe("shared portfolio store (regression for #18)", () => {
  it("two components hit /api/portfolio once between them", async () => {
    const calls = mockFetch(({ url }) => {
      if (url === "/api/portfolio") return jsonResponse(portfolioV1);
      return jsonResponse({});
    });

    render(
      <>
        <PortfolioReader id="reader-a" />
        <PortfolioReader id="reader-b" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("reader-a")).toHaveTextContent("cash:10000");
    });
    expect(screen.getByTestId("reader-b")).toHaveTextContent("cash:10000");

    const portfolioCalls = calls.filter((c) => c.url === "/api/portfolio");
    expect(portfolioCalls.length).toBe(1);
  });

  it("a refresh in one consumer propagates to all consumers", async () => {
    let phase: "v1" | "v2" = "v1";
    mockFetch(({ url }) => {
      if (url === "/api/portfolio") {
        return jsonResponse(phase === "v1" ? portfolioV1 : portfolioV2);
      }
      return jsonResponse({});
    });

    render(
      <>
        <PortfolioReader id="reader-a" />
        <PortfolioReader id="reader-b" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("reader-a")).toHaveTextContent("positions:0");
    });

    phase = "v2";
    await act(async () => {
      await portfolioInternals.store.refresh();
    });

    expect(screen.getByTestId("reader-a")).toHaveTextContent("positions:1");
    expect(screen.getByTestId("reader-b")).toHaveTextContent("positions:1");
    expect(screen.getByTestId("reader-a")).toHaveTextContent("cash:9000");
    expect(screen.getByTestId("reader-b")).toHaveTextContent("cash:9000");
  });
});

describe("shared sectors store", () => {
  it("two components hit /api/sectors once between them", async () => {
    const calls = mockFetch(({ url }) => {
      if (url === "/api/sectors") return jsonResponse(sectorsV1);
      return jsonResponse({});
    });

    render(
      <>
        <SectorsReader id="reader-a" />
        <SectorsReader id="reader-b" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("reader-a")).toHaveTextContent("tickers:AAPL");
    });
    expect(screen.getByTestId("reader-b")).toHaveTextContent("tickers:AAPL");

    const sectorCalls = calls.filter((c) => c.url === "/api/sectors");
    expect(sectorCalls.length).toBe(1);
  });

  it("a refresh in one consumer propagates to all consumers", async () => {
    let phase: "v1" | "v2" = "v1";
    mockFetch(({ url }) => {
      if (url === "/api/sectors") {
        return jsonResponse(phase === "v1" ? sectorsV1 : sectorsV2);
      }
      return jsonResponse({});
    });

    render(
      <>
        <SectorsReader id="reader-a" />
        <SectorsReader id="reader-b" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("reader-a")).toHaveTextContent("tickers:AAPL");
    });

    phase = "v2";
    await act(async () => {
      await sectorsInternals.store.refresh();
    });

    expect(screen.getByTestId("reader-a")).toHaveTextContent("tickers:AAPL,MSFT");
    expect(screen.getByTestId("reader-b")).toHaveTextContent("tickers:AAPL,MSFT");
  });
});
