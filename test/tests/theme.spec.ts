import { test, expect } from "../fixtures/app";

/**
 * Redesign spec §10 / §11: theme toggle in the header swaps between dark
 * and light, persists to `localStorage["finally:theme"]`, and rehydrates
 * across reload.
 *
 * Default: the FE honors `prefers-color-scheme` on first visit when there
 * is no saved preference. Playwright Chromium defaults to
 * `prefers-color-scheme: light`, so the initial theme on a fresh page in
 * the test environment is "light". We don't pin the *value* of the
 * initial theme — we verify the toggle flips it and that the flipped
 * value persists.
 */
test.describe("@theme light/dark toggle", () => {
  test("toggle swaps theme and back", async ({ page, header }) => {
    await page.goto("/");

    const initial = await header.currentTheme();
    expect(["light", "dark"]).toContain(initial);
    const flipped = initial === "light" ? "dark" : "light";

    await header.clickThemeToggle();
    await expect
      .poll(async () => header.currentTheme(), { timeout: 5_000 })
      .toBe(flipped);

    await header.clickThemeToggle();
    await expect
      .poll(async () => header.currentTheme(), { timeout: 5_000 })
      .toBe(initial);
  });

  test("theme preference persists across reload", async ({ page, header }) => {
    await page.goto("/");

    const initial = await header.currentTheme();
    const flipped = initial === "light" ? "dark" : "light";

    // Switch and confirm it stuck.
    await header.clickThemeToggle();
    await expect
      .poll(async () => header.currentTheme(), { timeout: 5_000 })
      .toBe(flipped);

    // localStorage should carry the saved value.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("finally:theme"),
    );
    expect(stored).toBe(flipped);

    // Reload — theme should rehydrate from localStorage.
    await page.reload();
    await expect
      .poll(async () => header.currentTheme(), { timeout: 5_000 })
      .toBe(flipped);
  });
});
