import { HeaderBar } from "@/components/layout/HeaderBar";
import { TickerStrip } from "@/components/layout/TickerStrip";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SseBootstrap } from "@/components/system/SseBootstrap";
import { MarketStatusBodyClass } from "@/components/system/MarketStatusBodyClass";
import { WatchlistPanel } from "@/components/watchlist/WatchlistPanel";
import { MainChart } from "@/components/charts/MainChart";
import { PnLChart } from "@/components/charts/PnLChart";
import { PositionsTable } from "@/components/positions/PositionsTable";
import { PositionsList } from "@/components/positions/PositionsList";
import { TradeBar } from "@/components/trade/TradeBar";

/**
 * AppShell — the top-level workstation grid.
 *
 * Layout intent (desktop-first, data-dense, terminal-grade):
 *   ┌──────────────────────────────── HEADER ────────────────────────────────┐
 *   │   logo  · totals · cash · status · market badge                        │
 *   ├────────────────────────── TICKER STRIP ────────────────────────────────┤
 *   │   horizontal scrolling watch tape                                       │
 *   ├──────────────────┬─────────────────────────┬──────────────────────────┤
 *   │  WATCHLIST       │   MAIN CHART            │  CHAT SIDEBAR            │
 *   │  (sparklines)    │   ─────────────────     │  (collapsible)           │
 *   │                  │   POSITIONS TABLE       │                          │
 *   │  HOLDINGS        │   PnL CHART             │                          │
 *   │  (weight list)   │   TRADE BAR             │                          │
 *   └──────────────────┴─────────────────────────┴──────────────────────────┘
 */
export function AppShell() {
  return (
    <div
      className="min-h-screen flex flex-col"
      data-testid="app-shell"
    >
      <SseBootstrap />
      <MarketStatusBodyClass />
      <HeaderBar />
      <TickerStrip />

      <main className="flex-1 grid gap-2 p-2 grid-cols-12 grid-rows-[minmax(280px,360px)_minmax(280px,1fr)] min-h-0">
        <section
          className="col-span-3 row-span-1 flex flex-col"
          data-testid="region-watchlist"
        >
          <WatchlistPanel />
        </section>

        <section
          className="col-span-6 row-span-1 flex flex-col"
          data-testid="region-main-chart"
        >
          <MainChart />
        </section>

        <aside
          className="col-span-3 row-span-2 flex flex-col"
          data-testid="region-chat"
        >
          <ChatPanel />
        </aside>

        <section
          className="col-span-3 row-span-1 flex flex-col"
          data-testid="region-holdings"
        >
          <PositionsList />
        </section>

        <section
          className="col-span-6 row-span-1 grid grid-rows-[1fr_auto] gap-2 min-h-0"
          data-testid="region-portfolio"
        >
          <div className="grid grid-cols-2 gap-2 min-h-0">
            <PositionsTable />
            <PnLChart />
          </div>
          <TradeBar />
        </section>
      </main>
    </div>
  );
}
