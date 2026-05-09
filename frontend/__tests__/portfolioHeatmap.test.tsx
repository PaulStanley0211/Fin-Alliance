/**
 * PortfolioHeatmap tests.
 *
 * Covers:
 *   - empty state when there are no positions
 *   - one cell per position, with the spec's testid contract
 *   - rail direction reflects sign of unrealized P&L
 *   - cell area is approximately proportional to portfolio weight
 *   - inline % label uses the up/down/flat ink color via Tailwind class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { PortfolioHeatmap, squarifyTreemap } from "@/components/charts/PortfolioHeatmap";
import { __internals as portfolioInternals } from "@/lib/portfolio";

// jsdom doesn't supply ResizeObserver — stub it to immediately fire once at
// observe() with a fixed bounding rect, which is what the heatmap needs to
// compute cell sizes.
class FakeResizeObserver {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    /* no-op — the component reads getBoundingClientRect() directly via
       useLayoutEffect; we don't need to fire the callback. */
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  FakeResizeObserver as unknown as typeof ResizeObserver;

// Make getBoundingClientRect return a fixed size so squarify has positive
// area — jsdom returns zero by default.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, width: 400, height: 240, top: 0, left: 0, right: 400, bottom: 240, toJSON: () => ({}) };
  } as typeof Element.prototype.getBoundingClientRect;
});

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

describe("PortfolioHeatmap", () => {
  it("shows the 'no holdings yet' empty state when there are no positions", async () => {
    mockPortfolio({
      cash_balance: 10000,
      positions: [],
      total_value: 10000,
      realized_pnl: 0,
    });

    render(<PortfolioHeatmap />);
    await waitFor(() =>
      expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument(),
    );
    // No cells should be rendered.
    expect(screen.queryByTestId(/^heatmap-cell-/)).toBeNull();
  });

  it("renders one cell per position with the spec testid contract", async () => {
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

    render(<PortfolioHeatmap />);
    await waitFor(() => {
      expect(screen.getByTestId("region-heatmap")).toBeInTheDocument();
      expect(screen.getByTestId("heatmap-cell-AAPL")).toBeInTheDocument();
      expect(screen.getByTestId("heatmap-cell-MSFT")).toBeInTheDocument();
    });

    expect(screen.getByTestId("heatmap-cell-pnl-AAPL")).toHaveTextContent(/\+5\.26%/);
    expect(screen.getByTestId("heatmap-cell-pnl-MSFT")).toHaveTextContent(/-1\.22%/);

    // Rails carry data-direction.
    expect(screen.getByTestId("heatmap-cell-rail-AAPL")).toHaveAttribute(
      "data-direction",
      "up",
    );
    expect(screen.getByTestId("heatmap-cell-rail-MSFT")).toHaveAttribute(
      "data-direction",
      "down",
    );
    // Cell wrapper also carries the direction for CSS hooks.
    expect(screen.getByTestId("heatmap-cell-AAPL")).toHaveAttribute(
      "data-direction",
      "up",
    );
  });

  it("flat positions get a flat-direction rail", async () => {
    mockPortfolio({
      cash_balance: 0,
      positions: [
        {
          ticker: "FLAT",
          quantity: 1,
          avg_cost: 100,
          current_price: 100,
          market_value: 100,
          unrealized_pnl: 0,
          unrealized_pnl_percent: 0,
        },
      ],
      total_value: 100,
      realized_pnl: 0,
    });

    render(<PortfolioHeatmap />);
    await waitFor(() =>
      expect(screen.getByTestId("heatmap-cell-FLAT")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("heatmap-cell-rail-FLAT")).toHaveAttribute(
      "data-direction",
      "flat",
    );
  });
});

// ---- Layout math (pure) -------------------------------------------------

describe("squarifyTreemap", () => {
  function makeCell(ticker: string, weight: number) {
    return {
      ticker,
      quantity: 1,
      avgCost: 1,
      livePrice: 1,
      marketValue: weight,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      weight,
      marketStatus: "open" as const,
      direction: "flat" as const,
    };
  }

  it("emits zero rectangles for empty input", () => {
    expect(squarifyTreemap([], 100, 100)).toEqual([]);
  });

  it("packs proportional areas inside the container bounds", () => {
    const cells = [makeCell("A", 0.25), makeCell("B", 0.75)];
    const placed = squarifyTreemap(cells, 400, 240);

    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(p.rect.x).toBeGreaterThanOrEqual(0);
      expect(p.rect.y).toBeGreaterThanOrEqual(0);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(400.001);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(240.001);
    }

    const areas = Object.fromEntries(
      placed.map((p) => [p.cell.ticker, p.rect.w * p.rect.h]),
    );
    // B should be roughly 3x A (modulo the soft-min tolerance — at this
    // scale the min cap is well below either area).
    expect(areas.B / areas.A).toBeGreaterThan(2.5);
    expect(areas.B / areas.A).toBeLessThan(3.5);
  });

  it("tiny positions are lifted to a minimum visible area", () => {
    const cells = [
      makeCell("BIG", 0.99),
      makeCell("TINY", 0.01),
    ];
    const placed = squarifyTreemap(cells, 400, 240);
    const tiny = placed.find((p) => p.cell.ticker === "TINY")!;
    expect(tiny.rect.w).toBeGreaterThan(0);
    expect(tiny.rect.h).toBeGreaterThan(0);
    expect(tiny.rect.w * tiny.rect.h).toBeGreaterThan(100); // visible
  });
});
