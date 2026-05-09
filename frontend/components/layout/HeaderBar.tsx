"use client";

import { useEffect, useMemo } from "react";

import { ConnectionDot } from "@/components/layout/ConnectionDot";
import { PriceFlash } from "@/components/common/PriceFlash";
import { usePortfolio } from "@/lib/portfolio";
import { useSseState } from "@/lib/sse";
import { hydrateTheme, useTheme, type Theme } from "@/lib/theme";
import type { MarketStatus } from "@/lib/types";

/**
 * HeaderBar — the workstation crown.
 *
 * Pulls portfolio + SSE state and renders:
 *   • brand mark
 *   • Net Liquidation (live-computed: cash + Σ qty × latest_price)
 *   • Cash Balance
 *   • Day P&L (realized + unrealized live deltas)
 *   • Market status badge (Open / Closed / Warming)
 *   • Connection-status dot
 */
export function HeaderBar() {
  const portfolio = usePortfolio();
  const sse = useSseState();
  const { theme, toggleTheme } = useTheme();

  // Hydrate the theme store from localStorage / prefers-color-scheme on
  // first mount. The inline <script> in app/layout.tsx already applied the
  // result to <html data-theme="...">, but the React store starts at "dark"
  // — this syncs it.
  useEffect(() => {
    hydrateTheme();
  }, []);

  const cash = portfolio.data?.cash_balance ?? null;
  const totalValue = portfolio.liveTotalValue;

  // Day P&L = unrealized P&L (recomputed live) + realized P&L.
  // Unrealized = Σ((live_price - avg_cost) × quantity) across positions.
  const dayPnl = useMemo(() => {
    if (!portfolio.data) return null;
    let unrealized = 0;
    for (const pos of portfolio.data.positions) {
      const live = sse.prices[pos.ticker]?.price ?? pos.current_price ?? pos.avg_cost;
      unrealized += (live - pos.avg_cost) * pos.quantity;
    }
    return unrealized + portfolio.data.realized_pnl;
  }, [portfolio.data, sse.prices]);

  // Market status: take the most recent tick's status as authoritative; fall
  // back to the warm-up flag.
  const marketStatus = useMemo<MarketStatus>(() => {
    const ticks = Object.values(sse.prices);
    if (ticks.length === 0) return sse.warming ? "warming" : "open";
    return ticks[0].market_status;
  }, [sse.prices, sse.warming]);

  return (
    <header
      className="relative flex items-stretch border-b border-line-soft bg-bg-1/70 backdrop-blur-md"
      data-testid="header-bar"
      data-market-status={marketStatus}
    >
      <div className="flex items-center gap-3 px-5 py-3 border-r border-line-soft min-w-[260px]">
        <div className="flex flex-col leading-none">
          <span className="font-display text-2xl font-medium text-ink-0 tracking-tight">
            Fin<span className="text-accent">Ally</span>
          </span>
          <span className="font-mono text-2xs uppercase text-ink-2 tracking-eyebrow mt-1">
            Finance · Ally · Terminal
          </span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-3 divide-x divide-line-soft">
        <Metric
          label="Net Liquidation"
          value={totalValue}
          dataTestId="header-total"
          marketStatus={marketStatus}
          variant="accent"
        />
        <Metric
          label="Cash Balance"
          value={cash}
          dataTestId="header-cash"
          marketStatus={marketStatus}
          variant="neutral"
        />
        <Metric
          label="Day P&amp;L"
          value={dayPnl}
          dataTestId="header-day-pnl"
          marketStatus={marketStatus}
          variant="signed"
        />
      </div>

      <div className="flex items-center gap-3 px-5 border-l border-line-soft min-w-[260px]">
        <MarketStatusBadge status={marketStatus} />
        <ConnectionDot />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
    </header>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const next = theme === "dark" ? "light" : "dark";
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-7 h-7 rounded-sharp border border-line-soft text-ink-1 hover:text-ink-0 hover:border-line-strong bg-bg-2/40 transition-colors"
      data-testid="header-theme-toggle"
      data-theme={theme}
      data-next-theme={next}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.93 19.07 1.41-1.41" />
      <path d="m17.66 6.34 1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function Metric({
  label,
  value,
  dataTestId,
  marketStatus,
  variant,
}: {
  label: string;
  value: number | null;
  dataTestId: string;
  marketStatus: MarketStatus;
  variant: "accent" | "neutral" | "signed";
}) {
  const tone =
    variant === "signed"
      ? value === null
        ? "text-ink-1"
        : value > 0
        ? "text-up"
        : value < 0
        ? "text-down"
        : "text-ink-1"
      : variant === "accent"
      ? "text-ink-0"
      : "text-ink-1";

  const display = value === null ? null : value;

  return (
    <div className="px-5 py-2.5 flex flex-col justify-center min-w-0" data-testid={dataTestId}>
      <span className="eyebrow">{label}</span>
      <span className={`font-mono text-xl font-light tabular mt-0.5 ${tone}`}>
        {display === null ? (
          "—"
        ) : (
          <>
            {variant === "signed" && display !== 0 ? (display > 0 ? "+" : "") : null}
            <span className="text-ink-3 mr-0.5">$</span>
            <PriceFlash
              price={display}
              marketStatus={marketStatus}
              data-testid={`${dataTestId}-value`}
            />
          </>
        )}
      </span>
    </div>
  );
}

function MarketStatusBadge({ status }: { status: MarketStatus }) {
  const labels: Record<MarketStatus, string> = {
    open: "Market Open",
    closed: "Market Closed",
    warming: "Warming Up",
  };
  const colors: Record<MarketStatus, string> = {
    open: "border-up/40 text-up bg-up/5",
    closed: "border-line text-ink-2 bg-bg-2 stripe-closed",
    warming: "border-accent/40 text-accent bg-accent/5",
  };
  return (
    <span
      className={`inline-flex items-center gap-2 px-2.5 py-1 border rounded-sharp font-mono text-2xs uppercase tracking-eyebrow ${colors[status]}`}
      data-testid="market-status-badge"
      data-status={status}
    >
      <span
        className={`status-dot bg-current ${status === "warming" ? "animate-pulse-dot" : ""}`}
        aria-hidden="true"
      />
      {labels[status]}
    </span>
  );
}
