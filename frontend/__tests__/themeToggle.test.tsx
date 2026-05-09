/**
 * Theme system tests.
 *
 * Covers:
 *   - hydration order: saved > prefers-color-scheme > dark default
 *   - toggle persists to localStorage
 *   - <html data-theme="..."> attribute updates on change
 *   - ThemeToggle button in HeaderBar renders correct icon + testid attrs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  __internals,
  THEME_STORAGE_KEY,
  hydrateTheme,
  getTheme,
  setTheme,
  toggleTheme,
} from "@/lib/theme";

function setSavedTheme(value: string | null) {
  if (value === null) {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  }
}

function mockPrefers(scheme: "dark" | "light" | "none") {
  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      (scheme === "light" && query === "(prefers-color-scheme: light)") ||
      (scheme === "dark" && query === "(prefers-color-scheme: dark)"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMedia,
  });
}

describe("theme store", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    __internals.store.__reset();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    __internals.store.__reset();
  });

  it("defaults to dark when no saved preference and no media match", () => {
    mockPrefers("none");
    hydrateTheme();
    expect(getTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("uses prefers-color-scheme: light when no saved preference", () => {
    mockPrefers("light");
    hydrateTheme();
    expect(getTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("saved preference takes priority over prefers-color-scheme", () => {
    mockPrefers("light"); // OS prefers light
    setSavedTheme("dark"); // user explicitly chose dark
    hydrateTheme();
    expect(getTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("ignores invalid saved values and falls back to prefers/dark", () => {
    mockPrefers("none");
    setSavedTheme("blue"); // garbage
    hydrateTheme();
    expect(getTheme()).toBe("dark");
  });

  it("setTheme writes localStorage and updates the html attribute", () => {
    mockPrefers("none");
    hydrateTheme();
    setTheme("light");
    expect(getTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("toggleTheme flips and persists", () => {
    mockPrefers("none");
    hydrateTheme();
    expect(getTheme()).toBe("dark");
    toggleTheme();
    expect(getTheme()).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    toggleTheme();
    expect(getTheme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("hydrate is idempotent — second call does not re-read storage", () => {
    mockPrefers("none");
    setSavedTheme("light");
    hydrateTheme();
    expect(getTheme()).toBe("light");
    // Change saved value behind the scenes — should be ignored.
    setSavedTheme("dark");
    hydrateTheme();
    expect(getTheme()).toBe("light");
  });
});

// ---- ThemeToggle in HeaderBar ----

vi.mock("@/lib/portfolio", () => ({
  usePortfolio: () => ({
    data: { cash_balance: 10000, positions: [], realized_pnl: 0, total_value: 10000 },
    liveTotalValue: 10000,
    loading: false,
    error: null,
  }),
}));

vi.mock("@/lib/sse", () => ({
  useSseState: () => ({ prices: {}, warming: false, lastActivityAt: null, readyState: 1, statusTick: 0 }),
  useConnectionStatus: () => "green" as const,
}));

import { HeaderBar } from "@/components/layout/HeaderBar";

describe("HeaderBar theme toggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    __internals.store.__reset();
    mockPrefers("none");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    __internals.store.__reset();
  });

  it("renders the toggle with data-testid and matches current theme", () => {
    render(<HeaderBar />);
    const btn = screen.getByTestId("header-theme-toggle");
    expect(btn).toHaveAttribute("data-theme", "dark");
    expect(btn).toHaveAttribute("data-next-theme", "light");
  });

  it("clicking flips the theme and updates html + localStorage", async () => {
    const user = userEvent.setup();
    render(<HeaderBar />);
    const btn = screen.getByTestId("header-theme-toggle");

    await user.click(btn);
    // After click, the React state has updated.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(btn).toHaveAttribute("data-theme", "light");

    await user.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("hydrates from localStorage on mount", async () => {
    setSavedTheme("light");
    render(<HeaderBar />);
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
    const btn = screen.getByTestId("header-theme-toggle");
    await waitFor(() => {
      expect(btn).toHaveAttribute("data-theme", "light");
    });
  });
});
