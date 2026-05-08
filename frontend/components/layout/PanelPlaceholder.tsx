type Accent = "primary" | "accent" | "secondary";

const ACCENT_RING: Record<Accent, string> = {
  primary: "before:bg-primary/60",
  accent: "before:bg-accent/60",
  secondary: "before:bg-secondary/60",
};

const ACCENT_TEXT: Record<Accent, string> = {
  primary: "text-primary",
  accent: "text-accent",
  secondary: "text-secondary-glow",
};

/**
 * Visual placeholder used while the real panels are still in their
 * own task tickets. Keeps the grid honest so we can lock in spacing
 * and typography first.
 */
export function PanelPlaceholder({
  label,
  hint,
  accent = "primary",
  ticker,
  compact = false,
  testid,
}: {
  label: string;
  hint?: string;
  accent?: Accent;
  ticker?: string;
  compact?: boolean;
  testid?: string;
}) {
  return (
    <div
      className={`panel relative flex-1 min-h-0 flex flex-col overflow-hidden
        before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] before:rounded-sharp ${ACCENT_RING[accent]}`}
      data-testid={testid}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-2">
          <span className={`eyebrow ${ACCENT_TEXT[accent]}`}>{label}</span>
          {ticker ? (
            <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
              · {ticker}
            </span>
          ) : null}
        </div>
        <span className="font-mono text-2xs text-ink-3">—</span>
      </div>

      <div
        className={`relative flex-1 ${compact ? "p-3" : "p-4"} flex items-center justify-center`}
      >
        {/* faint grid texture for depth */}
        <div className="pointer-events-none absolute inset-0 bg-grid-faint bg-grid-cell opacity-30" />
        <div className="relative text-center">
          <p className="font-display text-base text-ink-1 italic">awaiting data</p>
          {hint ? (
            <p className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3 mt-1">
              {hint}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
