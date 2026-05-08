import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { PositionsTable } from "@/components/positions/PositionsTable";
import { __internals as portfolioInternals } from "@/lib/portfolio";

const realFetch = globalThis.fetch;

beforeEach(() => {
  portfolioInternals.store.__reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockPortfolio(payload: object) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/portfolio") {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("PositionsTable", () => {
  it("renders a row per position with the correct testids", async () => {
    mockPortfolio({
      cash_balance: 5000,
      positions: [
        {
          ticker: "AAPL",
          quantity: 10,
          avg_cost: 190,
          current_price: 195,
          market_value: 1950,
          unrealized_pnl: 50,
          unrealized_pnl_percent: 2.63,
        },
        {
          ticker: "MSFT",
          quantity: 0.5,
          avg_cost: 410,
          current_price: 405,
          market_value: 202.5,
          unrealized_pnl: -2.5,
          unrealized_pnl_percent: -1.22,
        },
      ],
      total_value: 7152.5,
      realized_pnl: 0,
    });

    render(<PositionsTable />);

    await waitFor(() => {
      expect(screen.getByTestId("position-row-AAPL")).toBeInTheDocument();
      expect(screen.getByTestId("position-row-MSFT")).toBeInTheDocument();
    });

    expect(screen.getByTestId("position-quantity-AAPL")).toHaveTextContent("10");
    expect(screen.getByTestId("position-quantity-MSFT")).toHaveTextContent("0.5");
    expect(screen.getByTestId("position-avg-cost-AAPL")).toHaveTextContent("$190.00");
    expect(screen.getByTestId("position-pnl-MSFT")).toHaveTextContent(/-\$2\.50/);
  });

  it("shows the empty-state when there are no positions", async () => {
    mockPortfolio({
      cash_balance: 10000,
      positions: [],
      total_value: 10000,
      realized_pnl: 0,
    });

    render(<PositionsTable />);
    await waitFor(() =>
      expect(screen.getByText(/no open positions/i)).toBeInTheDocument(),
    );
  });
});
