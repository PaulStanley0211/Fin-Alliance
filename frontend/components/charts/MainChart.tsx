"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

import { usePriceHistory } from "@/lib/history";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";

/**
 * Detail price chart for the selected ticker. Backed by Lightweight Charts.
 *
 * Data source: the in-memory price-history buffer accumulated from SSE since
 * page load (capped at 200 points). The MainChart and the row sparklines
 * therefore agree by construction. When the user picks a fresh ticker,
 * the chart paints whatever points the buffer holds at that moment and
 * grows with each subsequent tick.
 *
 * If/when the backend exposes a historical-prices endpoint, this is where
 * we'd seed deeper history.
 */
export function MainChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [selected] = useSelectedTicker();
  const sse = useSseState();
  const history = usePriceHistory(selected ?? "");

  // Mount the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a8b3c1",
        fontFamily:
          "JetBrains Mono, IBM Plex Mono, ui-monospace, Menlo, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(34, 42, 56, 0.5)" },
        horzLines: { color: "rgba(34, 42, 56, 0.5)" },
      },
      rightPriceScale: {
        borderColor: "rgba(34, 42, 56, 0.8)",
      },
      timeScale: {
        borderColor: "rgba(34, 42, 56, 0.8)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#209dd7",
      topColor: "rgba(32, 157, 215, 0.35)",
      bottomColor: "rgba(32, 157, 215, 0)",
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

  // Repaint whenever the selected ticker or its history changes.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (!selected) {
      series.setData([]);
      return;
    }

    // We don't have per-tick server timestamps for the historical buffer
    // (we only stored prices), so synthesize an evenly-spaced minute series
    // ending at "now". This is fine for a streaming detail view — Lightweight
    // Charts only needs strictly-ascending Time values.
    const now = Math.floor(Date.now() / 1000);
    const data = history.map((price, i) => ({
      time: (now - (history.length - 1 - i)) as Time,
      value: price,
    }));
    series.setData(data);

    // Trend color: green if last > first, red otherwise.
    if (history.length >= 2) {
      const trendUp = history[history.length - 1] >= history[0];
      series.applyOptions({
        lineColor: trendUp ? "#26d086" : "#f0506e",
        topColor: trendUp ? "rgba(38, 208, 134, 0.32)" : "rgba(240, 80, 110, 0.32)",
        bottomColor: trendUp ? "rgba(38, 208, 134, 0)" : "rgba(240, 80, 110, 0)",
      });
    }
  }, [selected, history]);

  const tick = selected ? sse.prices[selected] : undefined;
  const change =
    tick && tick.previous_price !== 0
      ? ((tick.price - tick.previous_price) / tick.previous_price) * 100
      : null;

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="main-chart"
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
        <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
          {history.length}pt
        </span>
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
        ) : history.length < 2 ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="font-display italic text-ink-1">collecting ticks…</p>
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
