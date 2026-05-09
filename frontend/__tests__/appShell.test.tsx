/**
 * AppShell layout tests.
 *
 * Covers:
 *   - desktop grid uses `grid-template-columns: 280px ... 360px`
 *   - tablet width (≤1100px) collapses the chat into a drawer
 *   - chat-drawer-toggle flips the drawer open/closed and the dialog tracks state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";

import { AppShell } from "@/components/layout/AppShell";

// Stub out lightweight-charts (MainChart + PnLChart try to mount).
vi.mock("lightweight-charts", () => {
  const series = {
    setData: vi.fn(),
    applyOptions: vi.fn(),
  };
  const chart = {
    addSeries: vi.fn(() => series),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };
  return {
    AreaSeries: "Area",
    ColorType: { Solid: "solid" },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    createChart: vi.fn(() => chart),
  };
});

// Stub ResizeObserver so the heatmap doesn't crash in jsdom.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  FakeResizeObserver as unknown as typeof ResizeObserver;

// Make getBoundingClientRect return a fixed size so the heatmap layout has positive area.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0, width: 400, height: 240,
      top: 0, left: 0, right: 400, bottom: 240,
      toJSON: () => ({}),
    };
  } as typeof Element.prototype.getBoundingClientRect;
});

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/portfolio") {
      return jsonResponse({
        cash_balance: 10000,
        positions: [],
        total_value: 10000,
        realized_pnl: 0,
      });
    }
    if (url === "/api/sectors") {
      return jsonResponse({
        version: "1.0",
        sectors: [
          { id: "technology", label: "Technology", tickers: ["AAPL"] },
        ],
      });
    }
    if (url.startsWith("/api/portfolio/history")) {
      return jsonResponse({ range: "1d", snapshots: [] });
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

function setViewport(width: number) {
  const mockMq = (query: string): MediaQueryList => {
    // Crude parse of `(max-width: ...px)` — sufficient for our two breakpoints.
    const m = /max-width:\s*(\d+)px/.exec(query);
    const matches = m ? width <= Number(m[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn(mockMq),
  });
}

describe("AppShell", () => {
  it("desktop layout uses 280px / 1fr / 360px grid columns", async () => {
    setViewport(1600);
    mockApi();
    render(<AppShell />);

    const main = await screen.findByTestId("app-main");
    expect(main.dataset.tablet).toBe("false");
    expect(main.style.gridTemplateColumns).toContain("280px");
    expect(main.style.gridTemplateColumns).toContain("360px");

    // Chat + trade live in the right column on desktop, NOT in a drawer.
    expect(screen.getByTestId("region-chat")).toBeInTheDocument();
    expect(screen.getByTestId("region-trade")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-drawer-toggle")).toBeNull();
  });

  it("tablet width collapses chat into a drawer, with a toggle in the header strip", async () => {
    setViewport(900);
    mockApi();
    render(<AppShell />);

    const main = await screen.findByTestId("app-main");
    await waitFor(() => expect(main.dataset.tablet).toBe("true"));

    const drawer = screen.getByTestId("chat-drawer");
    expect(drawer).toHaveAttribute("data-open", "false");

    const toggle = screen.getByTestId("chat-drawer-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(drawer).toHaveAttribute("data-open", "true");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(drawer).toHaveAttribute("data-open", "false");
  });
});
