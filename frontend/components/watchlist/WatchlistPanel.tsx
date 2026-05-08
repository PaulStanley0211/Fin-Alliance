"use client";

import { useState, type FormEvent } from "react";

import { Sparkline } from "@/components/charts/Sparkline";
import { PriceFlash } from "@/components/common/PriceFlash";
import { usePriceHistory } from "@/lib/history";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";
import { useWatchlist } from "@/lib/watchlist";
import type { MarketStatus } from "@/lib/types";

const ERROR_LABELS: Record<string, string> = {
  ticker_unsupported: "Unknown ticker. Set MASSIVE_API_KEY for full coverage.",
  watchlist_full: "Watchlist is full (max 25 tickers).",
  invalid_request: "Invalid input.",
};

/**
 * Live watchlist panel. Reads the watchlist from `/api/watchlist`, overlays
 * the SSE price stream, and renders one row per ticker with: symbol, live
 * price (price-flash on change), 1-tick change %, sparkline, remove button.
 *
 * Click a row → updates the global selection store (consumed by MainChart).
 */
export function WatchlistPanel() {
  const watchlist = useWatchlist();
  const [selected, setSelected] = useSelectedTicker();
  const [draft, setDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = draft.trim().toUpperCase();
    if (!value) return;
    setAdding(true);
    setSubmitError(null);
    const res = await watchlist.add(value);
    setAdding(false);
    if (res.ok) {
      setDraft("");
    } else {
      setSubmitError(ERROR_LABELS[res.code] ?? res.message);
    }
  }

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="watchlist-panel"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-2">
          <span className="eyebrow text-primary">Watchlist</span>
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            · {watchlist.tickers.length}
          </span>
        </div>
        <form onSubmit={onAdd} className="flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="add ticker"
            aria-label="Add ticker"
            data-testid="watchlist-add-input"
            className="input !py-1 !px-2 !text-2xs uppercase tracking-eyebrow w-[7.5rem]"
            maxLength={10}
            disabled={adding}
          />
          <button
            type="submit"
            data-testid="watchlist-add-submit"
            className="btn-primary !py-1 !px-2 !text-2xs"
            disabled={adding || draft.trim().length === 0}
          >
            +
          </button>
        </form>
      </div>

      {submitError ? (
        <div
          className="px-3 py-1.5 border-b border-down/30 bg-down/10 font-mono text-2xs text-down"
          role="alert"
          data-testid="watchlist-error"
        >
          {submitError}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        {watchlist.loading ? (
          <RowSkeleton />
        ) : watchlist.tickers.length === 0 ? (
          <EmptyState />
        ) : (
          <ul role="list" className="divide-y divide-line-soft">
            {watchlist.tickers.map((ticker) => (
              <WatchlistRow
                key={ticker}
                ticker={ticker}
                selected={selected === ticker}
                onSelect={() => setSelected(ticker)}
                onRemove={() => watchlist.remove(ticker)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WatchlistRow({
  ticker,
  selected,
  onSelect,
  onRemove,
}: {
  ticker: string;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const sse = useSseState();
  const tick = sse.prices[ticker];
  const history = usePriceHistory(ticker);

  const price = tick?.price ?? null;
  const change = tick && tick.previous_price !== 0
    ? ((tick.price - tick.previous_price) / tick.previous_price) * 100
    : null;
  const direction = tick?.direction;
  const marketStatus: MarketStatus = tick?.market_status ?? "open";

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
      className={`group grid grid-cols-[5.5rem_1fr_5.5rem_auto] items-center gap-2 px-3 py-2 cursor-pointer transition-colors
        ${selected ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent hover:bg-bg-2/60"}`}
      data-testid={`watchlist-row-${ticker}`}
      data-selected={selected || undefined}
      aria-pressed={selected}
    >
      <span className={`font-mono text-tabular ${selected ? "text-primary-glow" : "text-ink-0"} font-medium`}>
        {ticker}
      </span>

      <div className="flex justify-end pr-1">
        <Sparkline values={history} width={88} height={22} />
      </div>

      <div className="flex flex-col items-end leading-tight">
        <span
          className={`font-mono text-tabular tabular ${
            direction === "up" ? "text-up" : direction === "down" ? "text-down" : "text-ink-0"
          }`}
          data-testid={`watchlist-price-${ticker}`}
        >
          <PriceFlash
            price={price}
            direction={direction}
            marketStatus={marketStatus}
            data-testid={`watchlist-price-value-${ticker}`}
          />
        </span>
        <span
          className={`font-mono text-2xs tabular ${
            change === null ? "text-ink-3" : change > 0 ? "text-up" : change < 0 ? "text-down" : "text-ink-2"
          }`}
        >
          {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
        </span>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 font-mono text-2xs text-ink-2 hover:text-down px-1 transition-opacity"
        data-testid={`watchlist-remove-${ticker}`}
        aria-label={`Remove ${ticker} from watchlist`}
      >
        ×
      </button>
    </li>
  );
}

function RowSkeleton() {
  return (
    <ul role="list" aria-busy="true" className="divide-y divide-line-soft">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-2 px-3 py-3">
          <span className="h-3 w-12 bg-line-soft rounded-sharp animate-pulse-dot" />
          <span className="h-3 w-full bg-line-soft rounded-sharp animate-pulse-dot opacity-60" />
          <span className="h-3 w-14 bg-line-soft rounded-sharp animate-pulse-dot ml-auto" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center p-6 text-center">
      <div>
        <p className="font-display italic text-ink-1">no tickers watched</p>
        <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
          Add one above to start streaming
        </p>
      </div>
    </div>
  );
}
