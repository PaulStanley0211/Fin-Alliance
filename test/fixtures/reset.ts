import type { APIRequestContext } from "@playwright/test";

/**
 * Backend state reset between tests.
 *
 * Historical purpose: when the suite ran against a single shared `default`
 * user, this helper sold every open position back to flat so the next test
 * started clean.
 *
 * Now that auth + multi-user is in place, every test signs up its own
 * unique user (see `fixtures/app.ts → testUsername`), so each test
 * already starts on a brand new portfolio with zero positions and $10k
 * cash. There's nothing to reset.
 *
 * The function is kept as a no-op so existing call sites in
 * `chat.spec.ts`, `trading.spec.ts`, etc. don't have to be updated. Feel
 * free to drop the calls when touching those files for other reasons.
 */
export async function resetBackendState(_request: APIRequestContext): Promise<void> {
  // Per-test user isolation handles state cleanup; nothing to do.
}
