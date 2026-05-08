import { test, expect } from "../fixtures/app";
import { isBackendUp, shouldSkipIfDown } from "../fixtures/backendReady";

// Wiring check only. Verifies the static frontend is served on / and that
// the page renders SOMETHING visible. Real scenarios live in #15.
test.describe("@smoke", () => {
  test("home page loads with status 200 and shows visible content", async ({
    page,
    request,
  }) => {
    const up = await isBackendUp(request);
    test.skip(
      !up && shouldSkipIfDown(),
      "Backend not reachable and FINALLY_SKIP_IF_DOWN=1 — skipping wiring check.",
    );

    const response = await page.goto("/");
    expect(response, "navigation must produce a response").not.toBeNull();
    expect(response!.status(), "home page should return 200").toBe(200);

    // Avoid coupling to specific copy that's still being designed; assert that
    // the body has *some* non-whitespace text. Once the Header lands we'll
    // tighten this in #15.
    await expect(page.locator("body")).toBeVisible();
    const bodyText = (await page.locator("body").innerText()).trim();
    expect(bodyText.length, "body should render visible text").toBeGreaterThan(0);
  });
});
