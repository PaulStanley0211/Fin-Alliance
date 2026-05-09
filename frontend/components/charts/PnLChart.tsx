"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

import { api, ApiError } from "@/lib/api";
import { usePortfolio } from "@/lib/portfolio";
import { useTheme } from "@/lib/theme";
import { getChartPalette } from "@/lib/themeColors";
import type { HistoryRange, HistorySnapshot } from "@/lib/types";

const RANGES: { key: HistoryRange; label: string }[] = [
  { key: "1h", label: "1H" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "all", label: "All" },
];

/**
 * Total-portfolio-value line chart, fed by `/api/portfolio/history`.
 *
 * The empty-state overlay shows until the user has at least one position —
 * a flat $10,000 line is a *correct* but boring view, and the spec calls for
 * an explicit "make your first trade" hint.
 */
export function PnLChart() {
  const portfolio = usePortfolio();
  const [range, setRange] = useState<HistoryRange>("1d");
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const { theme } = useTheme();

  // The empty-state condition is "no trades yet". Positions count is a clean
  // proxy: a fresh user has zero positions, so the snapshot line is trivially
  // flat at the seed cash balance.
  const showEmptyState =
    !portfolio.loading && (portfolio.data?.positions.length ?? 0) === 0;

  // Fetch on mount + when range changes.
  const fetchHistory = useCallback(
    async (r: HistoryRange) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getHistory(r);
        setSnapshots(res.snapshots);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchHistory(range);
  }, [range, fetchHistory]);

  // Mount the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const palette = getChartPalette();
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: palette.text,
        fontFamily:
          "JetBrains Mono, IBM Plex Mono, ui-monospace, Menlo, monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: {
        borderColor: palette.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: palette.accent,
      topColor: palette.accentAreaTop,
      bottomColor: palette.accentAreaBottom,
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Restyle on theme change without re-mounting the chart.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const palette = getChartPalette();
    chart.applyOptions({
      layout: { textColor: palette.text },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    });
    series.applyOptions({
      lineColor: palette.accent,
      topColor: palette.accentAreaTop,
      bottomColor: palette.accentAreaBottom,
    });
  }, [theme]);

  // Seriously short-and-sweet — repaint when snapshots change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data = snapshots
      .map((s) => ({
        time: Math.floor(new Date(s.recorded_at).getTime() / 1000) as Time,
        value: s.total_value,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    // De-dupe identical timestamps Lightweight Charts won't accept ascending duplicates.
    const dedup: typeof data = [];
    let lastT: number | null = null;
    for (const point of data) {
      if (lastT === point.time) continue;
      dedup.push(point);
      lastT = point.time as number;
    }
    series.setData(dedup);
  }, [snapshots]);

  const summary = useMemo(() => {
    if (snapshots.length === 0) return null;
    const first = snapshots[0].total_value;
    const last = snapshots[snapshots.length - 1].total_value;
    const delta = last - first;
    const pct = first === 0 ? 0 : (delta / first) * 100;
    return { first, last, delta, pct };
  }, [snapshots]);

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="pnl-chart"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="eyebrow text-accent">P&amp;L</span>
          {summary ? (
            <span
              className={`font-mono text-2xs tabular ${
                summary.delta > 0 ? "text-up" : summary.delta < 0 ? "text-down" : "text-ink-2"
              }`}
            >
              {summary.delta >= 0 ? "+" : ""}
              ${summary.delta.toFixed(2)} ({summary.pct >= 0 ? "+" : ""}
              {summary.pct.toFixed(2)}%)
            </span>
          ) : null}
        </div>
        <div role="group" aria-label="Time range" className="flex items-center gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`font-mono text-2xs uppercase tracking-eyebrow px-2 py-1 rounded-sharp border transition-colors ${
                range === r.key
                  ? "border-accent/50 text-accent bg-accent/10"
                  : "border-transparent text-ink-2 hover:text-ink-0 hover:bg-bg-2"
              }`}
              data-testid={`pnl-range-${r.key}`}
              data-active={range === r.key || undefined}
              aria-pressed={range === r.key}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" data-testid="pnl-chart-canvas" />
        {showEmptyState ? (
          <div
            className="absolute inset-0 flex items-center justify-center px-6 text-center pointer-events-none"
            data-testid="pnl-empty-state"
          >
            <div className="bg-bg-1/85 backdrop-blur-sm border border-line-soft rounded-panel px-5 py-3">
              <p className="font-display italic text-ink-0">
                Make your first trade to start tracking P&amp;L
              </p>
              <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
                $10,000.00 · seed balance
              </p>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-x-0 bottom-0 px-3 py-1.5 bg-down/10 border-t border-down/30 font-mono text-2xs text-down">
            {error}
          </div>
        ) : null}
        {loading && snapshots.length === 0 && !showEmptyState ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
              Loading {range}…
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
