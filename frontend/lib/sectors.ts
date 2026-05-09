/**
 * Sectors store + React bindings.
 *
 * Fetches `/api/sectors` once on first mount and caches the response in
 * memory. The taxonomy is frozen on the backend (60 tickers across 6
 * sectors); we only refetch if the `version` field changes between runs.
 *
 * Open/closed state for each sector is persisted to
 * `localStorage["finally:sectors:open"]` as a JSON array of sector ids.
 * Default on first visit: every sector is open.
 */

"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { api, ApiError } from "./api";
import type { Sector, SectorsResponse } from "./types";

export const SECTORS_OPEN_STORAGE_KEY = "finally:sectors:open";

interface InternalState {
  data: SectorsResponse | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  /** Sector ids currently expanded — persists across reloads. */
  openSet: Set<string>;
}

type Listener = () => void;

function loadOpenSet(): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SECTORS_OPEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return new Set(parsed as string[]);
    }
  } catch {
    // Corrupt entry — ignore and fall back to default-open.
  }
  return null;
}

function persistOpenSet(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SECTORS_OPEN_STORAGE_KEY,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    // Best-effort.
  }
}

class SectorsStore {
  private state: InternalState = {
    data: null,
    loading: true,
    error: null,
    errorCode: null,
    openSet: new Set<string>(),
  };
  private listeners = new Set<Listener>();
  private inFlight: Promise<void> | null = null;
  private mountCount = 0;
  private hydrated = false;

  getState = (): InternalState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  refresh = async (): Promise<void> => {
    if (this.inFlight) return this.inFlight;
    this.set({ loading: true, error: null, errorCode: null });
    const promise = (async () => {
      try {
        const res = await api.getSectors();
        // Hydrate open-set: saved preference if present, else *every* sector
        // open (default-open behavior on first visit).
        let openSet = this.state.openSet;
        if (!this.hydrated) {
          const saved = loadOpenSet();
          openSet = saved ?? new Set(res.sectors.map((s) => s.id));
          this.hydrated = true;
        }
        this.set({ data: res, openSet, loading: false });
      } catch (e) {
        if (e instanceof ApiError) {
          this.set({ error: e.message, errorCode: e.code, loading: false });
        } else {
          this.set({ error: (e as Error).message, loading: false });
        }
      } finally {
        this.inFlight = null;
      }
    })();
    this.inFlight = promise;
    return promise;
  };

  isOpen = (sectorId: string): boolean => this.state.openSet.has(sectorId);

  toggleOpen = (sectorId: string): void => {
    const next = new Set(this.state.openSet);
    if (next.has(sectorId)) next.delete(sectorId);
    else next.add(sectorId);
    this.set({ openSet: next });
    persistOpenSet(next);
  };

  setOpen = (sectorId: string, open: boolean): void => {
    const has = this.state.openSet.has(sectorId);
    if (open === has) return;
    this.toggleOpen(sectorId);
  };

  _registerMount(): void {
    this.mountCount++;
    if (this.mountCount === 1 && !this.state.data && !this.inFlight) {
      void this.refresh();
    }
  }

  _registerUnmount(): void {
    this.mountCount = Math.max(0, this.mountCount - 1);
  }

  /** Test seam. */
  __reset(): void {
    this.state = {
      data: null,
      loading: true,
      error: null,
      errorCode: null,
      openSet: new Set<string>(),
    };
    this.inFlight = null;
    this.mountCount = 0;
    this.hydrated = false;
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

const _store = new SectorsStore();

export interface SectorsState {
  version: string | null;
  sectors: Sector[];
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  isOpen: (sectorId: string) => boolean;
  toggleOpen: (sectorId: string) => void;
  refresh: () => Promise<void>;
}

export function useSectors(): SectorsState {
  const internal = useSyncExternalStore(
    _store.subscribe,
    _store.getState,
    _store.getState,
  );

  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    _store._registerMount();
    return () => {
      _store._registerUnmount();
    };
  }, []);

  return {
    version: internal.data?.version ?? null,
    sectors: internal.data?.sectors ?? [],
    loading: internal.loading,
    error: internal.error,
    errorCode: internal.errorCode,
    isOpen: _store.isOpen,
    toggleOpen: _store.toggleOpen,
    refresh: _store.refresh,
  };
}

/** Imperative refresh — fine outside React. */
export function refreshSectors(): Promise<void> {
  return _store.refresh();
}

// Test seams.
export const __internals = { store: _store, loadOpenSet, persistOpenSet };
