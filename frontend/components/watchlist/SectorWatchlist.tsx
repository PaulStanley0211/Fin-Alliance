"use client";

import { useEffect } from "react";

import { PriceFlash } from "@/components/common/PriceFlash";
import { useSectors } from "@/lib/sectors";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";
import type { MarketStatus, Sector } from "@/lib/types";

const INITIAL_TICKER = "AAPL";

/**
 * Sector-organized watchlist. Replaces the dynamic, user-managed watchlist
 * with a fixed taxonomy: 6 sectors × 10 tickers fetched from `/api/sectors`.
 *
 * Each sector group is a collapsible disclosure (default open). Per-row:
 * ticker symbol, live price (with PriceFlash), sector-relative day change %.
 * Click a row to update `useSelectedTicker()`, which drives the MainChart.
 *
 * Open/closed state is persisted to localStorage by the sectors store —
 * `lib/sectors.ts`. Selection is held in the singleton selection store and
 * survives reloads via the same module's behavior in MainChart.
 */
export function SectorWatchlist() {
  const sectors = useSectors();
  const [selected, setSelected] = useSelectedTicker();

  // Default selected ticker on first paint: AAPL — first ticker of the first
  // sector. Only fires once when sectors first load and nothing's selected.
  useEffect(() => {
    if (selected !== null) return;
    if (sectors.sectors.length === 0) return;
    const ticker = sectors.sectors[0]?.tickers[0] ?? INITIAL_TICKER;
    setSelected(ticker);
  }, [sectors.sectors, selected, setSelected]);

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="sector-watchlist"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="eyebrow text-primary">Sectors</span>
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            ·{" "}
            {sectors.sectors.reduce((s, sec) => s + sec.tickers.length, 0)}{" "}
            tickers
          </span>
        </div>
        {sectors.version ? (
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            v{sectors.version}
          </span>
        ) : null}
      </div>

      {sectors.error ? (
        <div
          className="px-3 py-1.5 border-b border-down/30 bg-down/10 font-mono text-2xs text-down"
          role="alert"
          data-testid="sector-watchlist-error"
        >
          Failed to load sectors: {sectors.error}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        {sectors.loading && sectors.sectors.length === 0 ? (
          <LoadingState />
        ) : (
          <ul role="list" className="divide-y divide-line-soft">
            {sectors.sectors.map((sector) => (
              <SectorGroup
                key={sector.id}
                sector={sector}
                open={sectors.isOpen(sector.id)}
                onToggle={() => sectors.toggleOpen(sector.id)}
                selected={selected}
                onSelect={setSelected}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SectorGroup({
  sector,
  open,
  onToggle,
  selected,
  onSelect,
}: {
  sector: Sector;
  open: boolean;
  onToggle: () => void;
  selected: string | null;
  onSelect: (ticker: string) => void;
}) {
  return (
    <li data-testid={`sector-group-${sector.id}`} data-open={open ? "true" : "false"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`sector-rows-${sector.id}`}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-2/60 transition-colors"
        data-testid={`sector-group-toggle-${sector.id}`}
      >
        <div className="flex items-center gap-2">
          <Chevron open={open} />
          <span className="font-mono text-tabular text-ink-0 tracking-terminal">
            {sector.label}
          </span>
        </div>
        <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
          {sector.tickers.length}
        </span>
      </button>

      {open ? (
        <ul
          id={`sector-rows-${sector.id}`}
          role="list"
          className="border-t border-line-soft/50 bg-bg-0/30"
        >
          {sector.tickers.map((ticker) => (
            <SectorRow
              key={ticker}
              ticker={ticker}
              selected={selected === ticker}
              onSelect={() => onSelect(ticker)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SectorRow({
  ticker,
  selected,
  onSelect,
}: {
  ticker: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const sse = useSseState();
  const tick = sse.prices[ticker];

  const price = tick?.price ?? null;
  const change =
    tick && tick.previous_price !== 0
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
      className={`grid grid-cols-[5rem_minmax(0,1fr)_5rem] items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors
        ${selected ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent hover:bg-bg-2/60"}`}
      data-testid={`sector-row-${ticker}`}
      data-selected={selected || undefined}
      aria-pressed={selected}
    >
      <span
        className={`font-mono text-tabular ${
          selected ? "text-primary-glow" : "text-ink-0"
        } font-medium`}
      >
        {ticker}
      </span>

      <span
        className={`font-mono text-tabular tabular text-right ${
          direction === "up"
            ? "text-up"
            : direction === "down"
            ? "text-down"
            : "text-ink-0"
        }`}
        data-testid={`sector-row-price-${ticker}`}
      >
        {price === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <>
            <span className="text-ink-3 mr-0.5">$</span>
            <PriceFlash
              price={price}
              direction={direction}
              marketStatus={marketStatus}
              data-testid={`sector-row-price-flash-${ticker}`}
            />
          </>
        )}
      </span>

      <span
        className={`font-mono text-2xs tabular text-right ${
          change === null
            ? "text-ink-3"
            : change > 0
            ? "text-up"
            : change < 0
            ? "text-down"
            : "text-ink-2"
        }`}
        data-testid={`sector-row-change-${ticker}`}
      >
        {change === null
          ? "—"
          : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
      </span>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`text-ink-2 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M4 2 l4 4 -4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoadingState() {
  return (
    <ul role="list" aria-busy="true" className="divide-y divide-line-soft">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="px-3 py-2 flex items-center gap-2">
          <span className="h-3 w-24 bg-line-soft rounded-sharp animate-pulse-dot" />
          <span className="ml-auto h-3 w-8 bg-line-soft rounded-sharp animate-pulse-dot opacity-60" />
        </li>
      ))}
    </ul>
  );
}
