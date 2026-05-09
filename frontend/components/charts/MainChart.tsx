"use client";

import { useEffect, useRef, useState } from "react";
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
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";
import { useTheme } from "@/lib/theme";
import { getChartPalette } from "@/lib/themeColors";
import type { TickerHistoryRange } from "@/lib/types";

/**
 * Detail price chart for the selected ticker.
 *
 * Data source: `/api/history/{ticker}?range=…` — backend proxies Yahoo's free
 * chart endpoint to give real intraday/daily candles. On top of that, when
 * the SSE stream delivers a tick newer than the latest historical point, we
 * append it so the chart keeps growing live during market hours.
 *
 * Range selector: 1D / 1W / 1M / 3M / 6M / 1Y. Default 1D (intraday 5-min).
 */
const RANGE_OPTIONS: TickerHistoryRange[] = ["1d", "1w", "1m", "3m", "6m", "1y"];

const RANGE_LABELS: Record<TickerHistoryRange, string> = {
  "1d": "1D",
  "1w": "1W",
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  "1y": "1Y",
};

type Point = { time: number; value: number };

export function MainChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [selected] = useSelectedTicker();
  const sse = useSseState();
  const { theme } = useTheme();
  const [range, setRange] = useState<TickerHistoryRange>("1d");
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
        fontSize: 11,
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
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: palette.primary,
      topColor: palette.primaryAreaTop,
      bottomColor: palette.primaryAreaBottom,
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
  }, [theme]);

  // Fetch the historical series whenever ticker or range changes.
  useEffect(() => {
    if (!selected) {
      setPoints([]);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getTickerHistory(selected, range, ctrl.signal)
      .then((resp) => {
        const next = resp.points
          .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
          .map(([t, v]) => ({ time: t, value: v }));
        setPoints(next);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") return;
        setLoading(false);
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError("Couldn't load chart history");
        }
        setPoints([]);
      });
    return () => ctrl.abort();
  }, [selected, range]);

  // Append the latest live tick whenever it advances past our last point.
  // This way the chart keeps growing during market hours without a refetch.
  useEffect(() => {
    if (!selected) return;
    const tick = sse.prices[selected];
    if (!tick) return;
    setPoints((prev) => {
      if (prev.length === 0) {
        return [{ time: Math.floor(tick.timestamp), value: tick.price }];
      }
      const last = prev[prev.length - 1];
      const t = Math.floor(tick.timestamp);
      // Only append if this tick is strictly newer than the last point.
      if (t <= last.time) return prev;
      const next = [...prev, { time: t, value: tick.price }];
      // Bound at ~3000 points so memory doesn't grow unbounded over a long session.
      return next.length > 3000 ? next.slice(next.length - 3000) : next;
    });
  }, [selected, sse.prices]);

  // Repaint whenever points change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (points.length === 0) {
      series.setData([]);
      return;
    }
    series.setData(
      points.map((p) => ({ time: p.time as Time, value: p.value })),
    );

    if (points.length >= 2) {
      const trendUp = points[points.length - 1].value >= points[0].value;
      const palette = getChartPalette();
      series.applyOptions({
        lineColor: trendUp ? palette.up : palette.down,
        topColor: trendUp ? palette.upAreaTop : palette.downAreaTop,
        bottomColor: trendUp ? palette.upAreaBottom : palette.downAreaBottom,
      });
    }

    const chart = chartRef.current;
    if (chart && points.length > 1) {
      chart.timeScale().fitContent();
    }
  }, [points, theme]);

  const tick = selected ? sse.prices[selected] : undefined;
  const change =
    tick && tick.previous_price !== 0
      ? ((tick.price - tick.previous_price) / tick.previous_price) * 100
      : null;

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="main-chart"
      data-ticker={selected ?? undefined}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-3">
          <span className="eyebrow text-accent">Chart</span>
          {selected ? (
            <>
              <span className="font-mono text-sm font-medium text-ink-0 tracking-terminal">
                {selected}
              </span>
              {tick ? (
                <span
                  className={`font-mono text-sm tabular ${
                    tick.direction === "up"
                      ? "text-up"
                      : tick.direction === "down"
                      ? "text-down"
                      : "text-ink-1"
                  }`}
                >
                  ${tick.price.toFixed(2)}
                </span>
              ) : null}
              {change !== null ? (
                <span
                  className={`font-mono text-2xs tabular ${
                    change > 0 ? "text-up" : change < 0 ? "text-down" : "text-ink-2"
                  }`}
                >
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              ) : null}
            </>
          ) : (
            <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
              · select a ticker
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Chart range">
          {RANGE_OPTIONS.map((opt) => {
            const active = opt === range;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setRange(opt)}
                className={`px-1.5 py-0.5 font-mono text-2xs uppercase tracking-eyebrow rounded-sharp border transition-colors
                  ${
                    active
                      ? "border-primary/60 bg-primary/10 text-primary-glow"
                      : "border-line-soft text-ink-2 hover:text-ink-0 hover:border-line-strong"
                  }`}
                data-testid={`main-chart-range-${opt}`}
                aria-pressed={active}
              >
                {RANGE_LABELS[opt]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" data-testid="main-chart-canvas" />
        {!selected ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="font-display italic text-ink-1">no ticker selected</p>
              <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
                Click a row in the watchlist
              </p>
            </div>
          </div>
        ) : loading && points.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="font-display italic text-ink-1">loading…</p>
              <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
                {selected}
              </p>
            </div>
          </div>
        ) : error && points.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="font-display italic text-down">{error}</p>
              <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
                {selected}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
