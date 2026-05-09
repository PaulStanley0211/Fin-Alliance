"use client";

import { useEffect, useState } from "react";

import { HeaderBar } from "@/components/layout/HeaderBar";
import { TickerStrip } from "@/components/layout/TickerStrip";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SseBootstrap } from "@/components/system/SseBootstrap";
import { MarketStatusBodyClass } from "@/components/system/MarketStatusBodyClass";
import { SectorWatchlist } from "@/components/watchlist/SectorWatchlist";
import { MainChart } from "@/components/charts/MainChart";
import { PnLChart } from "@/components/charts/PnLChart";
import { PortfolioHeatmap } from "@/components/charts/PortfolioHeatmap";
import { PositionsTable } from "@/components/positions/PositionsTable";
import { TradeBar } from "@/components/trade/TradeBar";

const TABLET_BREAKPOINT_PX = 1100;

/**
 * AppShell — the top-level workstation grid.
 *
 * Three columns at desktop:
 *   ┌── HEADER ─────────────────────────────────────────────────────────┐
 *   │   logo · totals · cash · status · market badge · theme toggle      │
 *   ├── TICKER STRIP ───────────────────────────────────────────────────┤
 *   ├──── 280px ───┬───── 1fr ──────────────────┬───── 360px ──────────┤
 *   │              │  MAIN CHART                 │                       │
 *   │  SECTOR      │  ────────────────────────   │   CHAT PANEL          │
 *   │  WATCHLIST   │  HEATMAP │ PnL CHART        │   (scrollable)        │
 *   │  (60 rows,   │  ────────────────────────   │                       │
 *   │   6 groups)  │  POSITIONS TABLE            ├───────────────────────┤
 *   │              │                              │   TRADE BAR (pinned) │
 *   └──────────────┴──────────────────────────────┴───────────────────────┘
 *
 * Tablet (≤1100px): chat collapses to a slide-out drawer (toggle button is
 * mounted in the header strip area). Heatmap/PnL stack vertically.
 */
export function AppShell() {
  const [chatOpen, setChatOpen] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT_PX - 1}px)`);
    const apply = () => setIsTablet(mq.matches);
    apply();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    // Safari/old Edge
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  return (
    <div className="min-h-screen flex flex-col" data-testid="app-shell">
      <SseBootstrap />
      <MarketStatusBodyClass />
      <HeaderBar />
      <TickerStrip />

      {isTablet ? (
        <div className="flex items-center justify-end px-3 py-1 border-b border-line-soft bg-bg-1/40">
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className="btn-ghost !py-1 !px-2 !text-2xs"
            aria-expanded={chatOpen}
            aria-controls="chat-drawer"
            data-testid="chat-drawer-toggle"
            data-open={chatOpen ? "true" : "false"}
          >
            {chatOpen ? "Close chat" : "Open chat"}
          </button>
        </div>
      ) : null}

      <main
        className="flex-1 grid gap-2 p-2 min-h-0 desktop-shell"
        data-testid="app-main"
        data-tablet={isTablet ? "true" : "false"}
        style={
          isTablet
            ? undefined
            : { gridTemplateColumns: "280px minmax(0,1fr) 360px" }
        }
      >
        <section
          className={`flex flex-col min-h-0 ${isTablet ? "col-span-1" : ""}`}
          data-testid="region-watchlist"
        >
          <SectorWatchlist />
        </section>

        <section
          className="flex flex-col min-h-0 gap-2"
          data-testid="region-center"
        >
          <div className="min-h-0 flex-[2] flex flex-col" data-testid="region-main-chart">
            <MainChart />
          </div>
          <div
            className={`min-h-0 grid gap-2 flex-1 ${
              isTablet ? "grid-rows-2" : "grid-cols-2"
            }`}
            data-testid="region-portfolio"
          >
            <div className="flex flex-col min-h-0" data-testid="region-holdings">
              <PortfolioHeatmap />
            </div>
            <div className="flex flex-col min-h-0">
              <PnLChart />
            </div>
          </div>
          <div className="min-h-0 flex flex-col" data-testid="region-positions">
            <PositionsTable />
          </div>
        </section>

        {/* Right column at desktop. At tablet width this column is hidden;
            chat & trade are mounted in the drawer instead. */}
        {!isTablet ? (
          <aside
            className="flex flex-col min-h-0 gap-2"
            data-testid="region-right"
          >
            <div className="flex-1 min-h-0 flex flex-col" data-testid="region-chat">
              <ChatPanel />
            </div>
            <div className="flex-shrink-0" data-testid="region-trade">
              <TradeBar />
            </div>
          </aside>
        ) : null}
      </main>

      {/* Tablet drawer — chat + trade slide in over the layout. */}
      {isTablet ? (
        <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
      ) : null}
    </div>
  );
}

function ChatDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <div
      id="chat-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="AI Copilot"
      data-testid="chat-drawer"
      data-open={open ? "true" : "false"}
      className={`fixed inset-y-0 right-0 z-40 w-[min(360px,100vw)] flex flex-col gap-2 p-2 bg-bg-0 border-l border-line-soft transition-transform ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <span className="eyebrow text-secondary-glow">Copilot</span>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-xs text-ink-2 hover:text-ink-0"
          aria-label="Close chat"
        >
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatPanel />
      </div>
      <div className="flex-shrink-0">
        <TradeBar />
      </div>
    </div>
  );
}
