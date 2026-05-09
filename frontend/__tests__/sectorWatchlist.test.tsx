/**
 * SectorWatchlist tests.
 *
 * Covers:
 *   - 6 groups + 60 rows render after `/api/sectors` resolves
 *   - clicking a sector header toggles its open state and persists to localStorage
 *   - clicking a row updates the global selection store
 *   - default open: every sector is open on first visit (no saved preference)
 *   - saved preference is honored over default-open
 *   - initial selection lands on AAPL when nothing is selected
 *   - error state surfaces when /api/sectors fails
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { SectorWatchlist } from "@/components/watchlist/SectorWatchlist";
import {
  __internals as sectorsInternals,
  SECTORS_OPEN_STORAGE_KEY,
} from "@/lib/sectors";
import { __resetSelection, getSelectedTicker, setSelectedTicker } from "@/lib/selection";

const realFetch = globalThis.fetch;

const SECTORS_PAYLOAD = {
  version: "1.1",
  sectors: [
    {
      id: "technology",
      label: "Technology",
      tickers: [
        "AAPL", "MSFT", "GOOGL", "AMZN", "META",
        "NVDA", "AVGO", "ORCL", "CRM", "ADBE",
      ],
    },
    {
      id: "healthcare",
      label: "Healthcare",
      tickers: [
        "UNH", "JNJ", "LLY", "PFE", "ABBV",
        "MRK", "TMO", "ABT", "DHR", "BMY",
      ],
    },
    {
      id: "financial",
      label: "Financial",
      tickers: [
        "JPM", "BAC", "WFC", "GS", "MS",
        "C", "BLK", "AXP", "V", "MA",
      ],
    },
    {
      id: "consumer",
      label: "Consumer",
      tickers: [
        "WMT", "COST", "HD", "MCD", "NKE",
        "SBUX", "TGT", "LOW", "DIS", "PG",
      ],
    },
    {
      id: "energy",
      label: "Energy",
      tickers: [
        "XOM", "CVX", "COP", "SLB", "EOG",
        "PSX", "MPC", "OXY", "VLO", "WMB",
      ],
    },
  ],
};

function mockSectors(payload: unknown = SECTORS_PAYLOAD, status = 200) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/sectors") {
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  sectorsInternals.store.__reset();
  __resetSelection();
  window.localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("SectorWatchlist", () => {
  it("renders 5 sector groups and 50 rows after /api/sectors resolves", async () => {
    mockSectors();
    render(<SectorWatchlist />);

    await waitFor(() => {
      expect(screen.getByTestId("sector-group-technology")).toBeInTheDocument();
    });

    const expectedIds = [
      "technology", "healthcare", "financial",
      "consumer", "energy",
    ];
    for (const id of expectedIds) {
      expect(screen.getByTestId(`sector-group-${id}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("sector-group-materials")).toBeNull();

    const rows = document.querySelectorAll('[data-testid^="sector-row-"]');
    // sector-row-{TICKER} only — exclude price/change subnodes which use
    // longer testid suffixes.
    const tickerRows = Array.from(rows).filter((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      return /^sector-row-[A-Z]+$/.test(id);
    });
    expect(tickerRows).toHaveLength(50);
  });

  it("defaults every group to open on first visit", async () => {
    mockSectors();
    render(<SectorWatchlist />);

    await waitFor(() => {
      expect(screen.getByTestId("sector-group-technology")).toHaveAttribute(
        "data-open",
        "true",
      );
    });
    for (const id of ["healthcare", "financial", "consumer", "energy"]) {
      expect(screen.getByTestId(`sector-group-${id}`)).toHaveAttribute(
        "data-open",
        "true",
      );
    }
  });

  it("honors a saved open-set in localStorage", async () => {
    window.localStorage.setItem(
      SECTORS_OPEN_STORAGE_KEY,
      JSON.stringify(["technology", "energy"]),
    );
    mockSectors();
    render(<SectorWatchlist />);

    await waitFor(() => {
      expect(screen.getByTestId("sector-group-technology")).toHaveAttribute(
        "data-open",
        "true",
      );
    });
    expect(screen.getByTestId("sector-group-energy")).toHaveAttribute(
      "data-open",
      "true",
    );
    expect(screen.getByTestId("sector-group-healthcare")).toHaveAttribute(
      "data-open",
      "false",
    );
    expect(screen.getByTestId("sector-group-financial")).toHaveAttribute(
      "data-open",
      "false",
    );
  });

  it("clicking a sector header toggles open state and persists to localStorage", async () => {
    mockSectors();
    render(<SectorWatchlist />);

    await waitFor(() => {
      expect(screen.getByTestId("sector-group-technology")).toHaveAttribute(
        "data-open",
        "true",
      );
    });

    fireEvent.click(screen.getByTestId("sector-group-toggle-technology"));
    await waitFor(() =>
      expect(screen.getByTestId("sector-group-technology")).toHaveAttribute(
        "data-open",
        "false",
      ),
    );

    const saved = JSON.parse(
      window.localStorage.getItem(SECTORS_OPEN_STORAGE_KEY) ?? "[]",
    ) as string[];
    expect(saved).not.toContain("technology");
    expect(saved).toContain("healthcare");
    expect(saved).toContain("energy");

    // Toggle back
    fireEvent.click(screen.getByTestId("sector-group-toggle-technology"));
    await waitFor(() =>
      expect(screen.getByTestId("sector-group-technology")).toHaveAttribute(
        "data-open",
        "true",
      ),
    );
    const reopened = JSON.parse(
      window.localStorage.getItem(SECTORS_OPEN_STORAGE_KEY) ?? "[]",
    ) as string[];
    expect(reopened).toContain("technology");
  });

  it("clicking a ticker row updates the global selection store", async () => {
    mockSectors();
    // Pre-set selection so the first-paint AAPL effect doesn't fire.
    setSelectedTicker("MSFT");
    render(<SectorWatchlist />);

    await waitFor(() =>
      expect(screen.getByTestId("sector-row-NVDA")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("sector-row-NVDA"));
    expect(getSelectedTicker()).toBe("NVDA");
    await waitFor(() =>
      expect(screen.getByTestId("sector-row-NVDA")).toHaveAttribute(
        "data-selected",
        "true",
      ),
    );
  });

  it("auto-selects AAPL on first paint when nothing is selected", async () => {
    mockSectors();
    render(<SectorWatchlist />);

    await waitFor(() => expect(getSelectedTicker()).toBe("AAPL"));
  });

  it("renders the error state when /api/sectors fails", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/sectors") {
        return new Response(
          JSON.stringify({ error: "internal_error", message: "boom" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    render(<SectorWatchlist />);
    const banner = await screen.findByTestId("sector-watchlist-error");
    expect(banner).toHaveTextContent(/failed to load sectors/i);
  });
});
