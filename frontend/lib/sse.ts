/**
 * SSE store for live price updates.
 *
 * Subscribes to /api/stream/prices and maintains:
 *  - a price-by-ticker map: {price, previous_price, timestamp, direction, market_status}
 *  - a connection-status state machine derived from EventSource.readyState
 *    plus a "last activity" timestamp (events OR `:ping` heartbeats both count)
 *
 * Implementation: a tiny pub/sub store. We deliberately avoid Zustand here
 * because (a) the public surface is only `useSseStore()` and `useConnectionStatus()`,
 * (b) we need to integrate with the EventSource lifecycle in a way that's
 * trivial to test by injecting a fake EventSource class.
 */

import { useSyncExternalStore } from "react";

import type { Direction, MarketStatus, StreamPriceUpdate } from "./types";

// ---- Public types --------------------------------------------------------

export type ConnectionStatus = "green" | "yellow" | "red";

export interface PriceTick {
  ticker: string;
  price: number;
  previous_price: number;
  timestamp: number; // server-emitted unix seconds
  direction: Direction;
  market_status: MarketStatus;
  /** Local clock (`Date.now()`) when this tick was applied — drives flash animations. */
  received_at: number;
}

export interface SseState {
  prices: Record<string, PriceTick>;
  /** Local `Date.now()` of the last *anything* on the wire (event OR raw byte). */
  lastActivityAt: number | null;
  /** Live `EventSource.readyState` mirror. */
  readyState: 0 | 1 | 2; // CONNECTING | OPEN | CLOSED
  /** True between `start()` and the first event/heartbeat. */
  warming: boolean;
  /**
   * Monotonic counter bumped by the 1s status timer. Its only purpose is to
   * change the snapshot reference so `useSyncExternalStore` re-renders
   * subscribers — the gap-based status check (`status()`) reads `now()`
   * fresh on each render and would otherwise stay stale because the rest of
   * `state` doesn't change while the wire is silent.
   */
  statusTick: number;
}

// Thresholds from PLAN.md §10
export const STATUS_YELLOW_MS = 10_000;
export const STATUS_RED_MS = 30_000;

// ---- Store ---------------------------------------------------------------

type Listener = () => void;

class SseStore {
  private state: SseState = {
    prices: {},
    lastActivityAt: null,
    readyState: 2, // CLOSED until start()
    warming: true,
    statusTick: 0,
  };
  private listeners = new Set<Listener>();
  private es: EventSource | null = null;
  private now: () => number;
  private EventSourceCtor: typeof EventSource;
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: {
    now?: () => number;
    EventSourceCtor?: typeof EventSource;
  }) {
    this.now = opts?.now ?? (() => Date.now());
    this.EventSourceCtor =
      opts?.EventSourceCtor ??
      (typeof EventSource !== "undefined" ? EventSource : (undefined as unknown as typeof EventSource));
  }

  getState = (): SseState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Connect to the stream. Idempotent — calling twice is safe. */
  start = (url = "/api/stream/prices"): void => {
    if (this.es) return;
    if (!this.EventSourceCtor) {
      // SSR / non-DOM environment — leave the store closed so consumers see "red".
      this.set({ readyState: 2, warming: false });
      return;
    }

    this.set({ readyState: 0, warming: true, lastActivityAt: null });
    const es = new this.EventSourceCtor(url);
    this.es = es;

    es.onopen = () => {
      this.set({ readyState: 1 });
    };

    es.onmessage = (ev: MessageEvent) => {
      this.handleMessage(ev.data);
    };

    es.onerror = () => {
      // EventSource's built-in retry will bring us back; just mirror the state.
      const rs = this.es?.readyState ?? 2;
      this.set({ readyState: rs as 0 | 1 | 2 });
    };

    if (!this.statusTimer) {
      // Tick once a second so the dot moves through yellow → red even when
      // no events arrive (i.e. quiet market or dead network). We bump
      // `statusTick` (rather than just calling `notify()`) so React's
      // `useSyncExternalStore` sees a fresh snapshot reference — without
      // it, the listener fires but the snapshot's identity is unchanged
      // and React skips the re-render, freezing the dot at "green".
      this.statusTimer = setInterval(() => {
        this.set({ statusTick: this.state.statusTick + 1 });
      }, 1000);
    }
  };

  /** Disconnect and clear timers. */
  stop = (): void => {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    this.set({ readyState: 2, warming: false });
  };

  /**
   * Public for tests: feed a raw `data:` payload as if it came from the wire.
   * Production code should use `start()` instead.
   */
  ingest = (rawPayload: string): void => this.handleMessage(rawPayload);

  /**
   * Public for tests: simulate a `: ping` heartbeat. (EventSource doesn't fire
   * an event for comment lines, but the underlying TCP frame still proves the
   * connection is alive — in tests we just bump `lastActivityAt`.)
   */
  heartbeat = (): void => {
    this.set({ lastActivityAt: this.now(), warming: false });
  };

  /** Compute the dot color from the current state. Pure — fine to call in render. */
  status = (): ConnectionStatus => {
    const { readyState, lastActivityAt, warming } = this.state;
    if (readyState === 2) return "red";
    if (readyState === 0) return "yellow";
    // OPEN
    if (warming || lastActivityAt === null) return "yellow";
    const gap = this.now() - lastActivityAt;
    if (gap > STATUS_RED_MS) return "red";
    if (gap > STATUS_YELLOW_MS) return "yellow";
    return "green";
  };

  // ---- Internal --------------------------------------------------------

  private handleMessage(raw: string): void {
    const now = this.now();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed payload — still proves the connection is live.
      this.set({ lastActivityAt: now, warming: false });
      return;
    }

    if (!isTickerMap(parsed)) {
      this.set({ lastActivityAt: now, warming: false });
      return;
    }

    // Backend warm-up envelope: `{prices: {}, market_status: "warming"}`.
    // No price entries to merge; just record activity so the dot flips off yellow.
    if ("prices" in parsed && "market_status" in parsed && !isStreamPriceUpdate((parsed as Record<string, unknown>).prices)) {
      this.set({ lastActivityAt: now, warming: false });
      return;
    }

    const next: Record<string, PriceTick> = { ...this.state.prices };
    for (const [ticker, update] of Object.entries(parsed)) {
      if (!isStreamPriceUpdate(update)) continue;
      next[ticker] = {
        ticker: update.ticker,
        price: update.price,
        previous_price: update.previous_price,
        timestamp: update.timestamp,
        direction: update.direction,
        market_status: update.market_status ?? "open",
        received_at: now,
      };
    }

    this.set({ prices: next, lastActivityAt: now, warming: false });
  }

  private set(patch: Partial<SseState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

function isStreamPriceUpdate(value: unknown): value is StreamPriceUpdate {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ticker === "string" &&
    typeof v.price === "number" &&
    typeof v.previous_price === "number" &&
    typeof v.timestamp === "number" &&
    typeof v.direction === "string"
  );
}

function isTickerMap(value: unknown): value is Record<string, StreamPriceUpdate> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---- Singleton + React hooks --------------------------------------------

let _store: SseStore | null = null;

/** Returns the lazily-constructed singleton. Tests should use `createStore()`. */
export function getStore(): SseStore {
  if (!_store) _store = new SseStore();
  return _store;
}

/** Test seam — construct an isolated store with injected dependencies. */
export function createStore(opts?: ConstructorParameters<typeof SseStore>[0]) {
  return new SseStore(opts);
}

/**
 * React hook — re-renders whenever the SSE store changes. Returns the full
 * state; consumers project to the slice they care about.
 */
export function useSseState(): SseState {
  const store = getStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Convenience hook for the connection-status dot. */
export function useConnectionStatus(): ConnectionStatus {
  // We subscribe through useSseState so the hook re-runs every store tick;
  // status() is pure and cheap.
  useSseState();
  return getStore().status();
}

/** Convenience hook for a single ticker's tick. Returns undefined while warming. */
export function usePriceTick(ticker: string): PriceTick | undefined {
  const state = useSseState();
  return state.prices[ticker];
}

// Internal export for tests
export const __internals = { isStreamPriceUpdate, isTickerMap, SseStore };
