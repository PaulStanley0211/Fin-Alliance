import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Stub out lightweight-charts before the component imports it. The test
// only cares about the range-selector UI + empty-state overlay; the chart
// canvas is opaque in jsdom anyway.
vi.mock("lightweight-charts", () => {
  const series = {
    setData: vi.fn(),
    applyOptions: vi.fn(),
  };
  const chart = {
    addSeries: vi.fn(() => series),
    remove: vi.fn(),
  };
  return {
    AreaSeries: "Area",
    ColorType: { Solid: "solid" },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    createChart: vi.fn(() => chart),
  };
});

const realFetch = globalThis.fetch;

import { __internals as portfolioInternals } from "@/lib/portfolio";

beforeEach(() => {
  portfolioInternals.store.__reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

interface Capture {
  url: string;
}

function mockFetch(handler: (call: Capture) => Response): Capture[] {
  const calls: Capture[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url });
    return handler({ url });
  }) as unknown as typeof fetch;
  return calls;
}

import { PnLChart } from "@/components/charts/PnLChart";

beforeEach(() => {
  // Each render mounts usePortfolio + PnLChart; both fire fetches.
});

function defaultRouting(): (call: Capture) => Response {
  return ({ url }) => {
    if (url.startsWith("/api/portfolio/history")) {
      return new Response(JSON.stringify({ range: "1d", snapshots: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/api/portfolio") {
      return new Response(
        JSON.stringify({
          cash_balance: 10000,
          positions: [],
          total_value: 10000,
          realized_pnl: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };
}

describe("PnLChart", () => {
  it("renders all five range buttons with the correct testids", async () => {
    mockFetch(defaultRouting());
    render(<PnLChart />);
    // Wait for the empty-state to settle so any pending async state updates
    // flush inside React's act(); avoids the act() warnings on console.
    await waitFor(() =>
      expect(screen.getByTestId("pnl-empty-state")).toBeInTheDocument(),
    );
    for (const key of ["1h", "1d", "1w", "1m", "all"] as const) {
      expect(screen.getByTestId(`pnl-range-${key}`)).toBeInTheDocument();
    }
  });

  it("defaults to 1d as the active range and re-fetches on selection", async () => {
    const calls = mockFetch(defaultRouting());
    render(<PnLChart />);

    // Wait for the first request to land
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("range=1d"))).toBe(true);
    });
    expect(screen.getByTestId("pnl-range-1d").dataset.active).toBe("true");

    fireEvent.click(screen.getByTestId("pnl-range-1w"));
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("range=1w"))).toBe(true);
    });
    expect(screen.getByTestId("pnl-range-1w").dataset.active).toBe("true");
    expect(screen.getByTestId("pnl-range-1d").dataset.active).toBeUndefined();
  });

  it("shows the empty-state overlay while there are no positions", async () => {
    mockFetch(defaultRouting());
    render(<PnLChart />);
    await waitFor(() =>
      expect(screen.getByTestId("pnl-empty-state")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pnl-empty-state")).toHaveTextContent(
      /make your first trade/i,
    );
  });

  it("hides the empty-state overlay once a position exists", async () => {
    mockFetch(({ url }) => {
      if (url.startsWith("/api/portfolio/history")) {
        return new Response(JSON.stringify({ range: "1d", snapshots: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/portfolio") {
        return new Response(
          JSON.stringify({
            cash_balance: 8000,
            positions: [
              {
                ticker: "AAPL",
                quantity: 10,
                avg_cost: 190,
                current_price: 192,
                market_value: 1920,
                unrealized_pnl: 20,
                unrealized_pnl_percent: 1.05,
              },
            ],
            total_value: 9920,
            realized_pnl: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    render(<PnLChart />);
    await waitFor(() => {
      expect(screen.queryByTestId("pnl-empty-state")).toBeNull();
    });
  });
});
