/**
 * Per-ticker price-history buffer for sparklines.
 *
 * The SSE stream gives us one tick per ticker per ~500ms; we keep the last N
 * (default 200) in memory so each watchlist row can render a sparkline that
 * builds up since page load. Memory is bounded, no localStorage, no replay
 * across reloads — this is intentional per PLAN.md §2.
 */

import { useSyncExternalStore } from "react";

import { getStore as getSseStore, type PriceTick } from "./sse";

const MAX_POINTS = 200;

type Listener = () => void;

class HistoryStore {
  private buffers = new Map<string, number[]>();
  private listeners = new Set<Listener>();
  private detach: (() => void) | null = null;
  private lastSeen = new Map<string, number>(); // ticker → received_at of last appended tick

  /** Begin observing the SSE store. Idempotent. */
  attach(): void {
    if (this.detach) return;
    const sse = getSseStore();
    this.detach = sse.subscribe(() => this.ingest(sse.getState().prices));
  }

  /** For tests. */
  attachTo(sse: ReturnType<typeof getSseStore>): void {
    if (this.detach) this.detach();
    this.detach = sse.subscribe(() => this.ingest(sse.getState().prices));
  }

  detachStore(): void {
    if (this.detach) {
      this.detach();
      this.detach = null;
    }
  }

  get(ticker: string): number[] {
    return this.buffers.get(ticker.toUpperCase()) ?? EMPTY;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** For tests. */
  reset(): void {
    this.buffers.clear();
    this.lastSeen.clear();
    for (const l of this.listeners) l();
  }

  private ingest(prices: Record<string, PriceTick>): void {
    let changed = false;
    for (const [ticker, tick] of Object.entries(prices)) {
      const last = this.lastSeen.get(ticker);
      // Append only when the *received_at* clock advanced; otherwise the SSE
      // store re-emitted an unchanged snapshot and we skip duplicates.
      if (last !== undefined && last >= tick.received_at) continue;
      this.lastSeen.set(ticker, tick.received_at);
      const buf = this.buffers.get(ticker);
      if (buf) {
        buf.push(tick.price);
        if (buf.length > MAX_POINTS) buf.splice(0, buf.length - MAX_POINTS);
      } else {
        // First tick for this ticker. If the SSE payload carries a distinct
        // previous_price (e.g. the backend seeded yesterday's close + today's
        // quote during off-hours), prime the buffer with both points so the
        // chart and sparkline have something to draw immediately.
        if (
          typeof tick.previous_price === "number" &&
          tick.previous_price > 0 &&
          tick.previous_price !== tick.price
        ) {
          this.buffers.set(ticker, [tick.previous_price, tick.price]);
        } else {
          this.buffers.set(ticker, [tick.price]);
        }
      }
      changed = true;
    }
    if (changed) {
      for (const l of this.listeners) l();
    }
  }
}

const EMPTY: number[] = Object.freeze([]) as unknown as number[];

const _store = new HistoryStore();

/** Subscribe & lazily attach on first use. */
export function usePriceHistory(ticker: string): number[] {
  // Calling attach inside the subscribe path is safe — the SseStore is
  // idempotent and this runs only once.
  _store.attach();
  const get = () => _store.get(ticker);
  return useSyncExternalStore(_store.subscribe, get, get);
}

// Test seams
export const __internals = { store: _store, MAX_POINTS };
