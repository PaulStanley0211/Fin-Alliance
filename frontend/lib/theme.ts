/**
 * Theme store + React bindings.
 *
 * Manages a single `theme: "dark" | "light"` value, mutates
 * `<html data-theme="...">` on change, and persists to
 * `localStorage["finally:theme"]`.
 *
 * Hydration order on first read:
 *   1. Saved preference in localStorage (`finally:theme`)
 *   2. `prefers-color-scheme` media query
 *   3. Default: dark
 *
 * Tiny pub/sub — no Zustand for one enum.
 */

"use client";

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "finally:theme";
const HTML_ATTR = "data-theme";

type Listener = () => void;

function readSaved(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    // localStorage may be unavailable (private mode etc.) — fall through.
  }
  return null;
}

function readPrefers(): Theme | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    // Non-conformant matchMedia — fall through.
  }
  return null;
}

function resolveInitial(): Theme {
  return readSaved() ?? readPrefers() ?? "dark";
}

function applyToDom(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(HTML_ATTR, theme);
}

function persist(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Best-effort.
  }
}

class ThemeStore {
  private theme: Theme = "dark";
  private listeners = new Set<Listener>();
  private hydrated = false;

  /** Resolve the initial theme from saved → prefers → dark, then push to DOM. */
  hydrate = (): void => {
    if (this.hydrated) return;
    this.hydrated = true;
    const initial = resolveInitial();
    this.theme = initial;
    applyToDom(initial);
    this.notify();
  };

  get = (): Theme => this.theme;

  set = (theme: Theme): void => {
    if (theme === this.theme) return;
    this.theme = theme;
    applyToDom(theme);
    persist(theme);
    this.notify();
  };

  toggle = (): void => {
    this.set(this.theme === "dark" ? "light" : "dark");
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Test seam — reset state without touching the DOM/localStorage. */
  __reset = (): void => {
    this.theme = "dark";
    this.hydrated = false;
    this.notify();
  };

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

const _store = new ThemeStore();

export interface ThemeApi {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

/** React hook — reactive theme value plus mutators. */
export function useTheme(): ThemeApi {
  const theme = useSyncExternalStore(_store.subscribe, _store.get, _store.get);
  return {
    theme,
    setTheme: _store.set,
    toggleTheme: _store.toggle,
  };
}

/** Imperative read — fine outside React. */
export function getTheme(): Theme {
  return _store.get();
}

/** Imperative write. */
export function setTheme(theme: Theme): void {
  _store.set(theme);
}

/** Imperative toggle. */
export function toggleTheme(): void {
  _store.toggle();
}

/**
 * Hydrate the store from localStorage / prefers-color-scheme and push the
 * result to `<html data-theme="...">`. Safe to call repeatedly; no-op after
 * the first invocation.
 */
export function hydrateTheme(): void {
  _store.hydrate();
}

// Test seam.
export const __internals = { store: _store, resolveInitial, readSaved, readPrefers };
