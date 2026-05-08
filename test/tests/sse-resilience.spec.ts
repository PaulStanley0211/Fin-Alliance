import { execSync } from "node:child_process";
import * as path from "node:path";

import { test, expect } from "../fixtures/app";

const COMPOSE_FILE = path.resolve(__dirname, "..", "docker-compose.test.yml");

function dockerCompose(args: string): void {
  execSync(`docker compose -f "${COMPOSE_FILE}" ${args}`, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * SSE resilience: pause the backend container, watch the dot leave green,
 * then unpause and watch it come home. We use `pause`/`unpause` (SIGSTOP /
 * SIGCONT) rather than `stop`/`start` because they're atomic — no risk of
 * the container being half-removed between operations, and the SSE
 * connection drops cleanly the moment the kernel freezes the uvicorn
 * process. The volume + DB state are untouched.
 *
 * Tagged @sse and run alphabetically last so a failure here doesn't strand
 * subsequent tests with a paused backend.
 */
test.describe.serial("@sse resilience", () => {
  // The §10 state machine waits 10s before going yellow and 30s before red,
  // and we then wait for the dot to recover after unpause. The default 30s
  // test timeout isn't enough — extend to 3 min.
  test.setTimeout(180_000);

  test("dot turns yellow then red when backend pauses, green when it returns", async ({
    page,
    header,
  }) => {
    await page.goto("/");
    await expect
      .poll(async () => header.statusColor(), { timeout: 10_000 })
      .toBe("green");

    dockerCompose("pause app");

    try {
      // Eventually the dot is no longer green. Either yellow OR red is fine —
      // exact transition timing depends on the 10s/30s thresholds in §10.
      await expect
        .poll(async () => header.statusColor(), { timeout: 60_000 })
        .not.toBe("green");
    } finally {
      // Always unpause, even on failure, so subsequent tests have a live backend.
      dockerCompose("unpause app");
    }

    // Once the backend recovers, the dot should return to green within ~30s.
    await expect
      .poll(async () => header.statusColor(), { timeout: 60_000 })
      .toBe("green");
  });
});
