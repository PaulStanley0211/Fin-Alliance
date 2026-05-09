/**
 * Cross-panel "selected ticker" store.
 *
 * The watchlist sets it on row click; the main chart and any other detail
 * views read from it. Tiny pub/sub so we don't pull in a state library
 * just for one string.
 */

import { useSyncExternalStore } from "react";

type Listener = () => void;

class SelectionStore {
  private value: string | null = null;
  private listeners = new Set<Listener>();

  get = (): string | null => this.value;

  set = (ticker: string | null): void => {
    const next = ticker?.toUpperCase() ?? null;
    if (next === this.value) return;
    this.value = next;
    for (const l of this.listeners) l();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

const _store = new SelectionStore();

/** Get + subscribe in React. */
export function useSelectedTicker(): [string | null, (t: string | null) => void] {
  const value = useSyncExternalStore(_store.subscribe, _store.get, _store.get);
  return [value, _store.set];
}

/** Imperative read — fine outside React. */
export function getSelectedTicker(): string | null {
  return _store.get();
}

export function setSelectedTicker(ticker: string | null): void {
  _store.set(ticker);
}

// Test seam — clears the singleton between tests.
export function __resetSelection(): void {
  _store.set(null);
}
