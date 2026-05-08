/**
 * Tiny inline SVG sparkline. Hand-rolled rather than dragging Lightweight
 * Charts into a 60×16px context — keeps the watchlist row light and the
 * chart library reserved for the main detail chart.
 */

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Minimum points before we render anything; otherwise show a dim hairline. */
  minPoints?: number;
}

export function Sparkline({
  values,
  width = 88,
  height = 24,
  color,
  minPoints = 2,
}: SparklineProps) {
  if (values.length < minPoints) {
    return (
      <svg
        width={width}
        height={height}
        aria-hidden="true"
        className="text-ink-3 opacity-50"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      // Invert Y because SVG (0,0) is top-left; pad 1px so the stroke isn't clipped.
      const y = height - 1 - ((v - min) / range) * (height - 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  // Auto-color from the first→last delta when not specified.
  const last = values[values.length - 1];
  const first = values[0];
  const trendColor = color ?? (last > first ? "var(--up)" : last < first ? "var(--down)" : "var(--ink-2)");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {/* Soft fill underneath */}
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={trendColor}
        opacity={0.12}
      />
      <polyline
        points={points}
        fill="none"
        stroke={trendColor}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
