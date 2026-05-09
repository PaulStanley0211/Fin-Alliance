"use client";

import { useConnectionStatus, type ConnectionStatus } from "@/lib/sse";

/**
 * Live connection-status indicator.
 *
 * Bound to the SSE store via `useConnectionStatus()`. Color + `data-status`
 * follow the §10 state machine:
 *   green  — OPEN AND last activity ≤ 10s
 *   yellow — CONNECTING, OR OPEN with 10–30s gap, OR initial warm-up
 *   red    — CLOSED, OR OPEN with > 30s gap
 *
 * Lives in the header — testid `header-status-dot` per the integration
 * suite contract.
 */
export function ConnectionDot({ status }: { status?: ConnectionStatus }) {
  // The hook subscribes to the store; tests of the header in isolation can
  // bypass the live store by passing an explicit `status` prop.
  const live = useConnectionStatus();
  const state = status ?? live;
  const meta = STATE_META[state];

  return (
    <span
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-sharp border ${meta.ring} bg-bg-2/60`}
      data-testid="header-status-dot"
      data-status={state}
      aria-label={`Connection: ${meta.label}`}
      role="status"
    >
      <span className={`status-dot ${meta.dot} ${meta.glow}`} aria-hidden="true" />
      <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-1">
        {meta.label}
      </span>
    </span>
  );
}

const STATE_META: Record<
  ConnectionStatus,
  { label: string; ring: string; dot: string; glow: string }
> = {
  green: {
    label: "Live",
    ring: "border-up/40",
    dot: "bg-up",
    glow: "shadow-[0_0_10px_rgb(var(--up-rgb)/0.6)]",
  },
  yellow: {
    label: "Reconnecting",
    ring: "border-accent/40",
    dot: "bg-accent animate-pulse-dot",
    glow: "shadow-[0_0_10px_rgb(var(--accent-rgb)/0.55)]",
  },
  red: {
    label: "Offline",
    ring: "border-down/40",
    dot: "bg-down",
    glow: "shadow-[0_0_10px_rgb(var(--down-rgb)/0.55)]",
  },
};
