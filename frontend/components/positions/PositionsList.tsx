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
  avgCost: number;
  livePrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  weight: number; // 0..1 of total invested market value
  marketStatus: MarketStatus;
}

/**
 * Weight-sorted positions list. Lives in the panel region the heatmap used
 * to occupy. Complements the PositionsTable below by sorting on market-value
 * weight and emphasising the *shape* of the portfolio: which tickers carry
 * the most exposure, how their P&L is trending.
 *
 * Visual rules per user feedback:
 *  - No solid green/red surface fills on rows.
 *  - Up/down sign communicated via text color + a thin hairline accent rail.
 *  - Portfolio weight rendered as an inline neutral bar (ink-3 → ink-1
 *    gradient), not a green/red wash.
 */
export function PositionsList() {
  const portfolio = usePortfolio();
  const sse = useSseState();
  const [selected, setSelected] = useSelectedTicker();

  const { rows, totalMarketValue, totalPnl } = useMemo(() => {
    if (!portfolio.data) {
      return { rows: [] as Row[], totalMarketValue: 0, totalPnl: 0 };
    }

    // Build raw rows first so we can compute the global market-value
    // denominator before assigning per-row weights.
    const raw = portfolio.data.positions.map((p) => {
      const tick = sse.prices[p.ticker];
      const livePrice = tick?.price ?? p.current_price ?? p.avg_cost;
      const marketValue = p.quantity * livePrice;
      const costBasis = p.avg_cost * p.quantity;
      const unrealizedPnl = marketValue - costBasis;
      const unrealizedPnlPercent = costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;
      return {
        ticker: p.ticker,
        quantity: p.quantity,
        avgCost: p.avg_cost,
        livePrice,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPercent,
        marketStatus: tick?.market_status ?? ("open" as MarketStatus),
      };
    });

    const totalMV = raw.reduce((s, r) => s + r.marketValue, 0);
    const totalPnL = raw.reduce((s, r) => s + r.unrealizedPnl, 0);

    const sorted = raw
      .map((r) => ({ ...r, weight: totalMV === 0 ? 0 : r.marketValue / totalMV }))
      .sort((a, b) => b.marketValue - a.marketValue);

    return { rows: sorted, totalMarketValue: totalMV, totalPnl: totalPnL };
  }, [portfolio.data, sse.prices]);

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="positions-list"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="eyebrow text-secondary-glow">Holdings</span>
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            · {rows.length} {rows.length === 1 ? "position" : "positions"}
          </span>
        </div>
        {rows.length > 0 ? (
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
              Total
            </span>
            <span className="font-mono text-tabular tabular text-ink-0">
              ${formatDollars(totalMarketValue)}
            </span>
            <span
              className={`font-mono text-2xs tabular ${
                totalPnl > 0 ? "text-up" : totalPnl < 0 ? "text-down" : "text-ink-2"
              }`}
            >
              {formatSignedDollars(totalPnl)}
            </span>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul role="list" className="flex-1 overflow-auto divide-y divide-line-soft">
          {rows.map((r) => (
            <PositionRow
              key={r.ticker}
              row={r}
              selected={selected === r.ticker}
              onSelect={() => setSelected(r.ticker)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PositionRow({
  row,
  selected,
  onSelect,
}: {
  row: Row;
  selected: boolean;
  onSelect: () => void;
}) {
  const sign = row.unrealizedPnl > 0 ? "up" : row.unrealizedPnl < 0 ? "down" : "flat";
  const railClass =
    sign === "up"
      ? "before:bg-up/70"
      : sign === "down"
      ? "before:bg-down/70"
      : "before:bg-line-strong";

  const pnlTextClass =
    sign === "up" ? "text-up" : sign === "down" ? "text-down" : "text-ink-1";

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative px-3 py-2.5 cursor-pointer transition-colors
        before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] ${railClass}
        ${selected ? "bg-primary/10" : "hover:bg-bg-2/60"}`}
      data-testid={`holdings-row-${row.ticker}`}
      data-selected={selected || undefined}
      aria-pressed={selected}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
        <div className="min-w-0 flex flex-col">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={`font-mono text-tabular font-medium tracking-terminal ${
                selected ? "text-primary-glow" : "text-ink-0"
              }`}
            >
              {row.ticker}
            </span>
            <span className="font-mono text-2xs text-ink-3 tabular truncate">
              {formatQty(row.quantity)} @ ${row.avgCost.toFixed(2)}
            </span>
          </div>
          <WeightBar weight={row.weight} testid={`holdings-weight-${row.ticker}`} />
        </div>

        <div className="flex flex-col items-end leading-tight">
          <span
            className="font-mono text-tabular tabular text-ink-0"
            data-testid={`holdings-value-${row.ticker}`}
          >
            $<PriceFlash
              price={row.marketValue}
              marketStatus={row.marketStatus}
              data-testid={`holdings-value-flash-${row.ticker}`}
            />
          </span>
          <div className="flex items-baseline gap-1.5">
            <span
              className={`font-mono text-2xs tabular ${pnlTextClass}`}
              data-testid={`holdings-pnl-${row.ticker}`}
            >
              {formatSignedDollars(row.unrealizedPnl)}
            </span>
            <span
              className={`font-mono text-2xs tabular ${pnlTextClass}`}
              data-testid={`holdings-pnl-percent-${row.ticker}`}
            >
              {row.unrealizedPnlPercent >= 0 ? "+" : ""}
              {row.unrealizedPnlPercent.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function WeightBar({ weight, testid }: { weight: number; testid: string }) {
  // 0..1 → 0..100% width. Neutral hairline + ink-1 fill, capped to 1.
  const pct = Math.max(0, Math.min(1, weight)) * 100;
  return (
    <div
      className="mt-1.5 flex items-center gap-2"
      data-testid={testid}
      data-weight={weight.toFixed(4)}
    >
      <div className="relative flex-1 h-[3px] bg-line-soft rounded-sharp overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-ink-2/80"
          style={{ width: `${pct.toFixed(2)}%` }}
        />
      </div>
      <span className="font-mono text-2xs text-ink-3 tabular shrink-0 w-9 text-right">
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center p-6 text-center">
      <div>
        <p className="font-display italic text-ink-1">no holdings yet</p>
        <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
          Open a position from the trade bar
        </p>
      </div>
    </div>
  );
}

function formatQty(q: number): string {
  return Number.isInteger(q) ? q.toString() : q.toFixed(4).replace(/\.?0+$/, "");
}

function formatDollars(v: number): string {
  // Two decimals, comma-grouped thousands. Uses en-US which is fine for the
  // demo; the wider app already assumes USD.
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedDollars(v: number): string {
  if (v > 0) return `+$${formatDollars(v)}`;
  if (v < 0) return `-$${formatDollars(Math.abs(v))}`;
  return `$${formatDollars(v)}`;
}
