"use client";

import { useMemo } from "react";

import { PriceFlash } from "@/components/common/PriceFlash";
import { usePortfolio } from "@/lib/portfolio";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";
import type { MarketStatus } from "@/lib/types";

interface Row {
  ticker: string;
  quantity: number;
  avg_cost: number;
  livePrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  marketStatus: MarketStatus;
}

/**
 * Live positions table. Pulls structure from `/api/portfolio` and overlays
 * SSE prices for live unrealized P&L. No polling — `usePortfolio` exposes a
 * `refresh()` that the TradeBar calls after each trade.
 */
export function PositionsTable() {
  const portfolio = usePortfolio();
  const sse = useSseState();
  const [selected, setSelected] = useSelectedTicker();

  const rows = useMemo<Row[]>(() => {
    if (!portfolio.data) return [];
    return portfolio.data.positions.map((p) => {
      const tick = sse.prices[p.ticker];
      const livePrice = tick?.price ?? p.current_price ?? p.avg_cost;
      const unrealizedPnl = (livePrice - p.avg_cost) * p.quantity;
      const costBasis = p.avg_cost * p.quantity;
      const unrealizedPnlPercent = costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;
      return {
        ticker: p.ticker,
        quantity: p.quantity,
        avg_cost: p.avg_cost,
        livePrice,
        unrealizedPnl,
        unrealizedPnlPercent,
        marketStatus: tick?.market_status ?? "open",
      };
    });
  }, [portfolio.data, sse.prices]);

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="positions-table"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-2">
          <span className="eyebrow text-primary">Positions</span>
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            · {rows.length}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p className="font-display italic text-ink-1">no open positions</p>
            <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
              Use the trade bar to open one
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-tabular tabular">
            <thead className="sticky top-0 bg-bg-1/95 backdrop-blur-sm">
              <tr className="border-b border-line-soft">
                <Th align="left">Ticker</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Avg Cost</Th>
                <Th align="right">Last</Th>
                <Th align="right">P&amp;L</Th>
                <Th align="right">%</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.ticker}
                  className={`border-b border-line-soft cursor-pointer hover:bg-bg-2/60 transition-colors ${
                    selected === r.ticker ? "bg-primary/10" : ""
                  }`}
                  onClick={() => setSelected(r.ticker)}
                  data-testid={`position-row-${r.ticker}`}
                  data-selected={selected === r.ticker || undefined}
                >
                  <Td align="left">
                    <span
                      className={`font-mono font-medium ${
                        selected === r.ticker ? "text-primary-glow" : "text-ink-0"
                      }`}
                    >
                      {r.ticker}
                    </span>
                  </Td>
                  <Td align="right" testid={`position-quantity-${r.ticker}`}>
                    {formatQty(r.quantity)}
                  </Td>
                  <Td align="right" testid={`position-avg-cost-${r.ticker}`}>
                    ${r.avg_cost.toFixed(2)}
                  </Td>
                  <Td align="right">
                    <PriceFlash
                      price={r.livePrice}
                      marketStatus={r.marketStatus}
                    />
                  </Td>
                  <Td
                    align="right"
                    testid={`position-pnl-${r.ticker}`}
                    className={
                      r.unrealizedPnl > 0
                        ? "text-up"
                        : r.unrealizedPnl < 0
                        ? "text-down"
                        : "text-ink-1"
                    }
                  >
                    {formatSignedDollars(r.unrealizedPnl)}
                  </Td>
                  <Td
                    align="right"
                    className={
                      r.unrealizedPnlPercent > 0
                        ? "text-up"
                        : r.unrealizedPnlPercent < 0
                        ? "text-down"
                        : "text-ink-1"
                    }
                  >
                    {r.unrealizedPnlPercent >= 0 ? "+" : ""}
                    {r.unrealizedPnlPercent.toFixed(2)}%
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" }) {
  return (
    <th
      className={`px-3 py-1.5 font-mono text-2xs uppercase tracking-eyebrow text-ink-2 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  testid,
  className = "",
}: {
  children: React.ReactNode;
  align: "left" | "right";
  testid?: string;
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-1.5 font-mono text-tabular tabular ${className} ${
        align === "right" ? "text-right" : "text-left"
      }`}
      data-testid={testid}
    >
      {children}
    </td>
  );
}

function formatQty(q: number): string {
  // Integer-quantities render whole; fractional gets up to 4 decimals.
  return Number.isInteger(q) ? q.toString() : q.toFixed(4).replace(/\.?0+$/, "");
}

function formatSignedDollars(v: number): string {
  // Always render sign *before* the dollar glyph (e.g. -$2.50, +$50.00, $0.00).
  if (v > 0) return `+$${v.toFixed(2)}`;
  if (v < 0) return `-$${Math.abs(v).toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}
