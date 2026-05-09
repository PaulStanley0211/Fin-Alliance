import { test, expect } from "../fixtures/app";

/**
 * Auth happy paths — signup, logout, login.
 *
 * The default `testUsername` fixture has already signed up a fresh user
 * before the test runs, so by the time we hit the page we're authed.
 * These tests then exercise the visible parts of that flow.
 */
test.describe("@auth", () => {
  test("authed user lands on the workstation, not the login form", async ({
    page,
  }) => {
    await page.goto("/");
    // The login form should not be present; the workstation should be.
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("login-form")).toHaveCount(0);
  });

  test("header shows the username chip and a sign-out button", async ({
    page,
    testUsername,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("header-username")).toHaveText(testUsername);
    await expect(page.getByTestId("header-logout")).toBeVisible();
  });

  test("sign-out returns to the login form, sign-in returns to the workstation", async ({
    page,
    testUsername,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    await page.getByTestId("header-logout").click();

    // Login form replaces the workstation.
    await expect(page.getByTestId("login-form")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);

    // Log back in with the same credentials the fixture used.
    await page.getByTestId("auth-username").fill(testUsername);
    await page.getByTestId("auth-password").fill("e2epass1234");
    await page.getByTestId("auth-submit").click();

    // Workstation is back, with the same user.
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("header-username")).toHaveText(testUsername);
  });

  test("login form rejects bad password with a visible error", async ({
    page,
    testUsername,
  }) => {
    await page.goto("/");
    await page.getByTestId("header-logout").click();
    await expect(page.getByTestId("login-form")).toBeVisible();

    await page.getByTestId("auth-username").fill(testUsername);
    await page.getByTestId("auth-password").fill("wrongguess");
    await page.getByTestId("auth-submit").click();

    await expect(page.getByTestId("auth-error")).toBeVisible();
    await expect(page.getByTestId("login-form")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });
});
