import type { APIRequestContext } from "@playwright/test";

const HEALTH_PATH = "/api/health";
const SKIP_FLAG = "FINALLY_SKIP_IF_DOWN";

/**
 * Returns true if the backend is up and reports healthy via /api/health.
 * Tolerates the warming state — readiness is a stricter check used elsewhere.
 */
export async function isBackendUp(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(HEALTH_PATH, { timeout: 3_000 });
    return res.ok();
  } catch {
    return false;
  }
}

/**
 * Skip the test (rather than fail) when the backend isn't reachable AND the
 * caller has set FINALLY_SKIP_IF_DOWN=1. This keeps the smoke test usable
 * during local scaffolding work before backend-engineer wires #6 up.
 */
export function shouldSkipIfDown(): boolean {
  return process.env[SKIP_FLAG] === "1" || process.env[SKIP_FLAG] === "true";
}
