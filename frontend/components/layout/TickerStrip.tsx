"use client";

import { useMemo } from "react";

import { PriceFlash } from "@/components/common/PriceFlash";
import { useSectors } from "@/lib/sectors";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";

/**
 * Horizontal tape of every streaming ticker. Click jumps the MainChart focus.
 * Pulls the ticker order from the sector taxonomy (`/api/sectors`); live
 * values from the SSE store.
 */
export function TickerStrip() {
  const sectors = useSectors();
  const sse = useSseState();
  const [selected, setSelected] = useSelectedTicker();

  const tickers = useMemo(() => {
    return sectors.sectors.flatMap((s) => s.tickers);
  }, [sectors.sectors]);

  return (
    <div
      className="relative flex items-center gap-5 px-5 py-2 border-b border-line-soft bg-bg-0/80 overflow-x-auto"
      data-testid="ticker-strip"
    >
      <span className="eyebrow shrink-0">Tape</span>
      {tickers.length === 0 ? (
        <span className="font-mono text-2xs text-ink-3">no tickers</span>
      ) : (
        tickers.map((sym) => {
          const tick = sse.prices[sym];
          const change =
            tick && tick.previous_price !== 0
              ? ((tick.price - tick.previous_price) / tick.previous_price) * 100
              : null;
          const isSelected = selected === sym;
          return (
            <button
              type="button"
              key={sym}
              onClick={() => setSelected(sym)}
              className={`inline-flex items-baseline gap-2 shrink-0 px-1.5 -mx-1.5 rounded-sharp transition-colors ${
                isSelected ? "bg-primary/10" : "hover:bg-bg-2/60"
              }`}
              data-testid={`tape-${sym}`}
              aria-pressed={isSelected}
            >
              <span
                className={`font-mono text-2xs uppercase tracking-eyebrow ${
                  isSelected ? "text-primary-glow" : "text-ink-2"
                }`}
              >
                {sym}
              </span>
              <span
                className={`font-mono text-tabular tabular ${
                  tick?.direction === "up"
                    ? "text-up"
                    : tick?.direction === "down"
                    ? "text-down"
                    : "text-ink-1"
                }`}
              >
                <PriceFlash
                  price={tick?.price ?? null}
                  direction={tick?.direction}
                  marketStatus={tick?.market_status ?? "open"}
                />
              </span>
              <span
                className={`font-mono text-2xs tabular ${
                  change === null
                    ? "text-ink-3"
                    : change > 0
                    ? "text-up"
                    : change < 0
                    ? "text-down"
                    : "text-ink-2"
                }`}
              >
                {change === null
                  ? "—"
                  : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
