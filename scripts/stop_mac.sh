#!/usr/bin/env bash
# stop_mac.sh — stop and remove the FinAlly container on macOS/Linux.
#
# Does NOT remove the bind-mounted db/finally.db — your portfolio survives.
# Run `rm db/finally.db` yourself for a clean slate.

set -euo pipefail

CONTAINER="finally"

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "==> Stopping $CONTAINER"
  docker rm -f "$CONTAINER" >/dev/null
  echo "==> $CONTAINER stopped and removed (db/finally.db preserved)"
else
  echo "==> No $CONTAINER container found; nothing to do"
fi
