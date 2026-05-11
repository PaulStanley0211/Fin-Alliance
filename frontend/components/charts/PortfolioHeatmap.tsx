"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { usePortfolio } from "@/lib/portfolio";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";
import type { MarketStatus } from "@/lib/types";

/**
 * Portfolio heatmap — Finviz-style treemap. Cells are sized by portfolio
 * weight and flood-filled green/red, with tint intensity scaled by
 * |unrealized P&L %| so a +0.2% mover reads as a soft green and a +5%
 * mover reads as a vivid green. Direction is also kept on a hidden rail
 * element for backwards-compatibility with E2E selectors.
 *
 * Layout: a squarified-style treemap on a single row of "strips" (greedy
 * row-packing) — simpler than the full Bruls algorithm but visually similar
 * for ≤25 cells. Cells are absolutely positioned inside a container that
 * tracks its own size via a ResizeObserver, so the treemap reflows as the
 * panel resizes.
 */

// Map |pnl %| → background alpha. 0% (flat handled separately) starts at a
// visible base so a tiny mover still reads as colored, and saturates at 5%.
const TINT_BASE_ALPHA = 0.22;
const TINT_PER_PERCENT = 0.13;
const TINT_MAX_ALPHA = 0.88;
const TINT_PERCENT_CAP = 5;

interface Cell {
  ticker: string;
  quantity: number;
  avgCost: number;
  livePrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  weight: number;
  marketStatus: MarketStatus;
  direction: "up" | "down" | "flat";
}

const MIN_CELL_AREA_PX = 1800; // ~ a 60×30 cell

export function PortfolioHeatmap() {
  const portfolio = usePortfolio();
  const sse = useSseState();
  const [selected, setSelected] = useSelectedTicker();

  const cells = useMemo<Cell[]>(() => {
    if (!portfolio.data) return [];
    const raw = portfolio.data.positions.map((p) => {
      const tick = sse.prices[p.ticker];
      const livePrice = tick?.price ?? p.current_price ?? p.avg_cost;
      const marketValue = p.quantity * livePrice;
      const costBasis = p.avg_cost * p.quantity;
      const unrealizedPnl = marketValue - costBasis;
      const unrealizedPnlPercent =
        costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;
      const direction: "up" | "down" | "flat" =
        unrealizedPnl > 0 ? "up" : unrealizedPnl < 0 ? "down" : "flat";
      return {
        ticker: p.ticker,
        quantity: p.quantity,
        avgCost: p.avg_cost,
        livePrice,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPercent,
        marketStatus: tick?.market_status ?? ("open" as MarketStatus),
        direction,
      };
    });

    const totalMV = raw.reduce((s, r) => s + r.marketValue, 0);
    return raw
      .map((r) => ({ ...r, weight: totalMV === 0 ? 0 : r.marketValue / totalMV }))
      .sort((a, b) => b.marketValue - a.marketValue);
  }, [portfolio.data, sse.prices]);

  return (
    <div
      className="panel relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="region-heatmap"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="eyebrow text-secondary-glow">Heatmap</span>
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            · {cells.length} {cells.length === 1 ? "position" : "positions"}
          </span>
        </div>
        {cells.length > 0 ? (
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            sized by weight
          </span>
        ) : null}
      </div>

      <div className="relative flex-1 min-h-0">
        {cells.length === 0 ? (
          <EmptyState />
        ) : (
          <Treemap
            cells={cells}
            selected={selected}
            onSelect={setSelected}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
      <p className="font-display italic text-ink-2">no holdings yet</p>
    </div>
  );
}

function Treemap({
  cells,
  selected,
  onSelect,
}: {
  cells: Cell[];
  selected: string | null;
  onSelect: (ticker: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rects = useMemo(() => {
    if (size.w === 0 || size.h === 0) return [];
    return squarifyTreemap(cells, size.w, size.h);
  }, [cells, size]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 p-1.5"
      data-testid="heatmap-container"
    >
      {rects.map(({ cell, rect }) => (
        <HeatmapCell
          key={cell.ticker}
          cell={cell}
          rect={rect}
          selected={selected === cell.ticker}
          onSelect={() => onSelect(cell.ticker)}
        />
      ))}
    </div>
  );
}

function HeatmapCell({
  cell,
  rect,
  selected,
  onSelect,
}: {
  cell: Cell;
  rect: { x: number; y: number; w: number; h: number };
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const pct = cell.unrealizedPnlPercent;
  const intensity = Math.min(Math.abs(pct), TINT_PERCENT_CAP);
  const tintAlpha = Math.min(
    TINT_MAX_ALPHA,
    TINT_BASE_ALPHA + intensity * TINT_PER_PERCENT,
  );
  const tintVar =
    cell.direction === "up"
      ? "--up-rgb"
      : cell.direction === "down"
      ? "--down-rgb"
      : null;
  const tintColor = tintVar ? `rgba(var(${tintVar}), ${tintAlpha})` : undefined;

  const tooSmallForLabels = rect.w < 56 || rect.h < 36;
  const tooSmallForTicker = rect.w < 32 || rect.h < 22;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: Math.max(0, rect.w - 4),
        height: Math.max(0, rect.h - 4),
        backgroundColor: tintColor,
      }}
      className={`group cursor-pointer overflow-hidden rounded-sharp border transition-shadow
        ${cell.direction === "flat" ? "bg-bg-1" : ""}
        ${selected ? "border-primary ring-1 ring-primary/40" : "border-line-soft hover:border-line-strong"}
        hover:brightness-110`}
      data-testid={`heatmap-cell-${cell.ticker}`}
      data-direction={cell.direction}
      data-selected={selected || undefined}
      aria-label={`${cell.ticker} · ${pct.toFixed(2)}%`}
      aria-pressed={selected}
    >
      {/* Direction rail kept in the DOM for testid/a11y hooks; no longer
          visible because the flood fill conveys direction. */}
      <div
        className="sr-only"
        data-testid={`heatmap-cell-rail-${cell.ticker}`}
        data-direction={cell.direction}
        aria-hidden="true"
      />

      {/* Cell content */}
      <div className="absolute inset-0 px-2 py-1.5 flex flex-col justify-between">
        {!tooSmallForTicker ? (
          <span className="font-mono text-tabular font-semibold tracking-terminal text-ink-0 leading-none truncate drop-shadow-[0_1px_0_rgba(0,0,0,0.18)]">
            {cell.ticker}
          </span>
        ) : null}
        {!tooSmallForLabels ? (
          <span
            className="font-mono text-2xs tabular leading-none text-ink-0 drop-shadow-[0_1px_0_rgba(0,0,0,0.18)]"
            data-testid={`heatmap-cell-pnl-${cell.ticker}`}
          >
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </span>
        ) : (
          <span
            data-testid={`heatmap-cell-pnl-${cell.ticker}`}
            className="sr-only"
          >
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </span>
        )}
      </div>

      {hovered ? <HeatmapTooltip cell={cell} /> : null}
    </div>
  );
}

function HeatmapTooltip({ cell }: { cell: Cell }) {
  const pnlText =
    cell.direction === "up"
      ? "text-up"
      : cell.direction === "down"
      ? "text-down"
      : "text-ink-2";
  return (
    <div
      role="tooltip"
      className="absolute bottom-full left-0 mb-1 z-10 min-w-[180px] panel-raised px-3 py-2 shadow-panel pointer-events-none"
      data-testid={`heatmap-cell-tooltip-${cell.ticker}`}
    >
      <div className="font-mono text-tabular text-ink-0 mb-1">{cell.ticker}</div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-2xs">
        <dt className="text-ink-3">Qty</dt>
        <dd className="tabular text-right text-ink-1">{formatQty(cell.quantity)}</dd>

        <dt className="text-ink-3">Avg cost</dt>
        <dd className="tabular text-right text-ink-1">${cell.avgCost.toFixed(2)}</dd>

        <dt className="text-ink-3">Last</dt>
        <dd className="tabular text-right text-ink-1">${cell.livePrice.toFixed(2)}</dd>

        <dt className="text-ink-3">Value</dt>
        <dd className="tabular text-right text-ink-0">${formatDollars(cell.marketValue)}</dd>

        <dt className="text-ink-3">P&amp;L</dt>
        <dd className={`tabular text-right ${pnlText}`}>
          {formatSignedDollars(cell.unrealizedPnl)} (
          {cell.unrealizedPnlPercent >= 0 ? "+" : ""}
          {cell.unrealizedPnlPercent.toFixed(2)}%)
        </dd>

        <dt className="text-ink-3">Weight</dt>
        <dd className="tabular text-right text-ink-1">
          {(cell.weight * 100).toFixed(1)}%
        </dd>
      </dl>
    </div>
  );
}

// ---- Treemap layout (squarify) ------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placed {
  cell: Cell;
  rect: Rect;
}

/**
 * Squarified treemap (Bruls/Huijsmans/van Wijk) — pack rectangles into a
 * container so each one's area is proportional to its weight and aspect
 * ratios stay close to 1:1.
 */
export function squarifyTreemap(
  cells: Cell[],
  width: number,
  height: number,
): Placed[] {
  if (width <= 0 || height <= 0 || cells.length === 0) return [];

  const totalWeight = cells.reduce((s, c) => s + Math.max(c.weight, 0), 0);
  if (totalWeight <= 0) return [];

  const totalArea = width * height;
  const items = cells
    .map((c) => ({ cell: c, area: (Math.max(c.weight, 0) / totalWeight) * totalArea }))
    .filter((it) => it.area > 0);

  // Apply a soft minimum cell area so a 0.1% position is still tappable —
  // we do this by lifting tiny areas up to MIN_CELL_AREA_PX and then
  // re-normalizing the rest down. Skip if container is too small for it
  // to make sense (would invert weights).
  const minArea = Math.min(MIN_CELL_AREA_PX, totalArea / Math.max(items.length, 1) / 4);
  if (minArea > 0) {
    let lifted = 0;
    for (const it of items) {
      if (it.area < minArea) {
        lifted += minArea - it.area;
        it.area = minArea;
      }
    }
    if (lifted > 0) {
      const big = items.filter((it) => it.area > minArea);
      const bigTotal = big.reduce((s, b) => s + b.area, 0);
      if (bigTotal > lifted) {
        for (const b of big) {
          b.area -= lifted * (b.area / bigTotal);
        }
      }
    }
  }

  const placed: Placed[] = [];
  let remaining = items.slice();
  let region: Rect = { x: 0, y: 0, w: width, h: height };

  while (remaining.length > 0) {
    const shorter = Math.min(region.w, region.h);
    if (shorter <= 0) break;

    // Greedy: keep adding items to the current row while the worst aspect
    // ratio is improving. Once it gets worse, freeze the row and recurse.
    const row: typeof remaining = [];
    let bestWorst = Infinity;

    for (const candidate of remaining) {
      const trial = [...row, candidate];
      const worst = worstAspect(trial.map((t) => t.area), shorter);
      if (worst <= bestWorst) {
        row.push(candidate);
        bestWorst = worst;
      } else {
        break;
      }
    }

    layoutRow(row, region, placed);
    const consumed = row.reduce((s, r) => s + r.area, 0);
    const totalRowArea = region.w * region.h;

    if (region.w >= region.h) {
      // Row was placed vertically along the left edge.
      const rowWidth = totalRowArea === 0 ? 0 : consumed / region.h;
      region = {
        x: region.x + rowWidth,
        y: region.y,
        w: region.w - rowWidth,
        h: region.h,
      };
    } else {
      const rowHeight = totalRowArea === 0 ? 0 : consumed / region.w;
      region = {
        x: region.x,
        y: region.y + rowHeight,
        w: region.w,
        h: region.h - rowHeight,
      };
    }

    remaining = remaining.slice(row.length);
  }

  return placed;
}

function worstAspect(areas: number[], shorter: number): number {
  if (areas.length === 0) return Infinity;
  const total = areas.reduce((s, a) => s + a, 0);
  if (total <= 0) return Infinity;
  const stripLong = total / shorter;
  let worst = 0;
  for (const a of areas) {
    const stripShort = a / stripLong;
    const ratio = Math.max(stripLong / stripShort, stripShort / stripLong);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function layoutRow(
  row: { cell: Cell; area: number }[],
  region: Rect,
  placed: Placed[],
): void {
  if (row.length === 0) return;
  const total = row.reduce((s, r) => s + r.area, 0);
  if (total <= 0) return;

  if (region.w >= region.h) {
    // Layout row as a vertical strip along the left edge.
    const stripWidth = total / region.h;
    let yCursor = region.y;
    for (const r of row) {
      const cellH = r.area / stripWidth;
      placed.push({
        cell: r.cell,
        rect: { x: region.x, y: yCursor, w: stripWidth, h: cellH },
      });
      yCursor += cellH;
    }
  } else {
    // Layout row as a horizontal strip along the top edge.
    const stripHeight = total / region.w;
    let xCursor = region.x;
    for (const r of row) {
      const cellW = r.area / stripHeight;
      placed.push({
        cell: r.cell,
        rect: { x: xCursor, y: region.y, w: cellW, h: stripHeight },
      });
      xCursor += cellW;
    }
  }
}

// ---- Formatters ----------------------------------------------------------

function formatQty(q: number): string {
  return Number.isInteger(q) ? q.toString() : q.toFixed(4).replace(/\.?0+$/, "");
}

function formatDollars(v: number): string {
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

// Re-exports for tests.
export const __test = { squarifyTreemap, worstAspect };

// Suppress unused-import warning for useEffect (kept for future timers).
void useEffect;
