/**
 * Singleton portfolio store + React bindings.
 *
 * Why a singleton: every panel that depends on portfolio state (HeaderBar,
 * PositionsTable, PortfolioHeatmap, ChatPanel, TradeBar) needs to see the
 * same `data` and react to the same `refresh()`. With per-component
 * `useState`, a refresh in ChatPanel only updates ChatPanel's copy and the
 * other panels stay stale. Subscribing them all to the same store fixes
 * that.
 *
 * Live total value: derived per-render against the SSE price store; this
 * keeps the header total updating on every tick without refetching the
 * REST endpoint.
 */

"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { api, ApiError } from "./api";
import { useSseState } from "./sse";
import type { PortfolioResponse } from "./types";

interface InternalState {
  data: PortfolioResponse | null;
  loading: boolean;
  error: string | null;
  /** Sequence of the latest in-flight refresh — guards against stale responses. */
  fetchSeq: number;
}

type Listener = () => void;

class PortfolioStore {
  private state: InternalState = {
    data: null,
    loading: true,
    error: null,
    fetchSeq: 0,
  };
  private listeners = new Set<Listener>();
  private inFlight: Promise<void> | null = null;
  private mountCount = 0;

  getState = (): InternalState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Returns the in-flight promise so callers can `await` consistency. */
  refresh = async (): Promise<void> => {
    const seq = this.state.fetchSeq + 1;
    this.set({ fetchSeq: seq, error: null });

    const promise = (async () => {
      try {
        const next = await api.getPortfolio();
        if (seq !== this.state.fetchSeq) return;
        this.set({ data: next, loading: false });
      } catch (e) {
        if (seq !== this.state.fetchSeq) return;
        this.set({
          error: e instanceof ApiError ? e.message : (e as Error).message,
          loading: false,
        });
      }
    })();

    this.inFlight = promise;
    return promise;
  };

  /** Track mount count so the initial fetch fires exactly once across all subscribers. */
  _registerMount(): void {
    this.mountCount++;
    if (this.mountCount === 1 && this.state.data === null && !this.inFlight) {
      void this.refresh();
    }
  }

  _registerUnmount(): void {
    this.mountCount = Math.max(0, this.mountCount - 1);
  }

  /** Test seam — wipes state. */
  __reset(): void {
    this.state = { data: null, loading: true, error: null, fetchSeq: 0 };
    this.inFlight = null;
    this.mountCount = 0;
    this.notify();
  }

  private set(patch: Partial<InternalState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

const _store = new PortfolioStore();

/** Imperative refresh — fine outside React (e.g. from a non-component callsite). */
export function refreshPortfolio(): Promise<void> {
  return _store.refresh();
}

export interface PortfolioState {
  data: PortfolioResponse | null;
  liveTotalValue: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * React hook — returns the shared portfolio state plus a live total value
 * recomputed against the SSE price store. All subscribers see the same
 * `data`; calling `refresh()` from any one of them updates them all.
 */
export function usePortfolio(): PortfolioState {
  const internal = useSyncExternalStore(
    _store.subscribe,
    _store.getState,
    _store.getState,
  );
  const sse = useSseState();

  // Auto-fire the initial fetch on first mount across the tree.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    _store._registerMount();
    return () => {
      _store._registerUnmount();
    };
  }, []);

  const liveTotalValue = useMemo(() => {
    if (!internal.data) return null;
    let liveValue = internal.data.cash_balance;
    for (const pos of internal.data.positions) {
      const tick = sse.prices[pos.ticker];
      const price = tick?.price ?? pos.current_price ?? pos.avg_cost;
      liveValue += pos.quantity * price;
    }
    return liveValue;
  }, [internal.data, sse.prices]);

  return {
    data: internal.data,
    liveTotalValue,
    loading: internal.loading,
    error: internal.error,
    refresh: _store.refresh,
  };
}

// Test seam
export const __internals = { store: _store };
