/**
 * Helpers for reading the active theme's color tokens at runtime.
 *
 * Tailwind classes pick up `data-theme` automatically, but third-party
 * canvas libraries (Lightweight Charts, Recharts SVG) need plain hex/rgba
 * values passed in once at chart creation. This module exposes a thin
 * API: read the current theme's tokens, build a chart palette, and
 * subscribe to the theme store so charts can be repainted on toggle.
 */

"use client";

import { __internals as themeInternals, type Theme } from "./theme";

export interface ChartPalette {
  text: string;
  grid: string;
  border: string;
  primary: string;
  primaryAreaTop: string;
  primaryAreaBottom: string;
  accent: string;
  accentAreaTop: string;
  accentAreaBottom: string;
  up: string;
  upAreaTop: string;
  upAreaBottom: string;
  down: string;
  downAreaTop: string;
  downAreaBottom: string;
}

/**
 * Read a CSS variable value from `<html>`. Returns the trimmed string,
 * empty string if the variable is undefined. Safe in non-DOM environments.
 */
export function readVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function rgba(rgbVar: string, alpha: number): string {
  const triplet = readVar(rgbVar) || "0, 0, 0";
  return `rgba(${triplet}, ${alpha})`;
}

/** Snapshot the chart-relevant tokens for the active theme. */
export function getChartPalette(): ChartPalette {
  return {
    text: readVar("--ink-1") || "#a8b3c1",
    grid: rgba("--line-rgb", 0.5),
    border: rgba("--line-rgb", 0.8),
    primary: readVar("--primary") || "#209dd7",
    primaryAreaTop: rgba("--primary-rgb", 0.35),
    primaryAreaBottom: rgba("--primary-rgb", 0),
    accent: readVar("--accent") || "#ecad0a",
    accentAreaTop: rgba("--accent-rgb", 0.30),
    accentAreaBottom: rgba("--accent-rgb", 0),
    up: readVar("--up") || "#26d086",
    upAreaTop: rgba("--up-rgb", 0.32),
    upAreaBottom: rgba("--up-rgb", 0),
    down: readVar("--down") || "#f0506e",
    downAreaTop: rgba("--down-rgb", 0.32),
    downAreaBottom: rgba("--down-rgb", 0),
  };
}

/** Subscribe to theme changes; returns an unsubscribe. */
export function subscribeToTheme(listener: (theme: Theme) => void): () => void {
  return themeInternals.store.subscribe(() => listener(themeInternals.store.get()));
}
