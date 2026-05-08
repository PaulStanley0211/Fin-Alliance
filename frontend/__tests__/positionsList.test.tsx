import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { PositionsList } from "@/components/positions/PositionsList";
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

describe("PositionsList (replaces PortfolioHeatmap)", () => {
  it("renders one row per position with the new testid contract", async () => {
    mockPortfolio({
      cash_balance: 5000,
      positions: [
        {
          ticker: "AAPL",
          quantity: 10,
          avg_cost: 190,
          current_price: 200,
          market_value: 2000,
          unrealized_pnl: 100,
          unrealized_pnl_percent: 5.26,
        },
        {
          ticker: "MSFT",
          quantity: 5,
          avg_cost: 410,
          current_price: 405,
          market_value: 2025,
          unrealized_pnl: -25,
          unrealized_pnl_percent: -1.22,
        },
      ],
      total_value: 9025,
      realized_pnl: 0,
    });

    render(<PositionsList />);

    await waitFor(() => {
      expect(screen.getByTestId("holdings-row-AAPL")).toBeInTheDocument();
      expect(screen.getByTestId("holdings-row-MSFT")).toBeInTheDocument();
    });

    expect(screen.getByTestId("holdings-pnl-AAPL")).toHaveTextContent(/\+\$100\.00/);
    expect(screen.getByTestId("holdings-pnl-MSFT")).toHaveTextContent(/-\$25\.00/);
    expect(screen.getByTestId("holdings-pnl-percent-AAPL")).toHaveTextContent(/\+5\.26%/);
    expect(screen.getByTestId("holdings-pnl-percent-MSFT")).toHaveTextContent(/-1\.22%/);
  });

  it("sorts rows by market value descending (largest first)", async () => {
    mockPortfolio({
      cash_balance: 0,
      positions: [
        {
          ticker: "SMALL",
          quantity: 1,
          avg_cost: 10,
          current_price: 12,
          market_value: 12,
          unrealized_pnl: 2,
          unrealized_pnl_percent: 20,
        },
        {
          ticker: "BIG",
          quantity: 100,
          avg_cost: 50,
          current_price: 60,
          market_value: 6000,
          unrealized_pnl: 1000,
          unrealized_pnl_percent: 20,
        },
      ],
      total_value: 6012,
      realized_pnl: 0,
    });

    const { container } = render(<PositionsList />);
    await waitFor(() =>
      expect(screen.getByTestId("holdings-row-BIG")).toBeInTheDocument(),
    );

    const rows = container.querySelectorAll('[data-testid^="holdings-row-"]');
    expect(rows[0].getAttribute("data-testid")).toBe("holdings-row-BIG");
    expect(rows[1].getAttribute("data-testid")).toBe("holdings-row-SMALL");
  });

  it("computes portfolio weight as marketValue / Σ marketValue", async () => {
    mockPortfolio({
      cash_balance: 0,
      positions: [
        {
          ticker: "A",
          quantity: 10,
          avg_cost: 100,
          current_price: 100,
          market_value: 1000,
          unrealized_pnl: 0,
          unrealized_pnl_percent: 0,
        },
        {
          ticker: "B",
          quantity: 30,
          avg_cost: 100,
          current_price: 100,
          market_value: 3000,
          unrealized_pnl: 0,
          unrealized_pnl_percent: 0,
        },
      ],
      total_value: 4000,
      realized_pnl: 0,
    });

    render(<PositionsList />);
    await waitFor(() =>
      expect(screen.getByTestId("holdings-row-A")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("holdings-weight-A").dataset.weight).toBe("0.2500");
    expect(screen.getByTestId("holdings-weight-B").dataset.weight).toBe("0.7500");
  });

  it("shows the empty state when there are no positions", async () => {
    mockPortfolio({
      cash_balance: 10000,
      positions: [],
      total_value: 10000,
      realized_pnl: 0,
    });

    render(<PositionsList />);
    await waitFor(() =>
      expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument(),
    );
  });
});
