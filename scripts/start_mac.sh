#!/usr/bin/env bash
# start_mac.sh — build (if needed) and run the FinAlly container on macOS/Linux.
#
# Usage:
#   ./scripts/start_mac.sh           # build if image missing, then run
#   ./scripts/start_mac.sh --build   # force rebuild
#   ./scripts/start_mac.sh --logs    # follow logs after start
#
# Idempotent: a running container is left alone; an existing-but-stopped
# container is removed and restarted.

set -euo pipefail

IMAGE="finally:latest"
CONTAINER="finally"
PORT="8000"

# Resolve project root (parent of this script's directory).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

FORCE_BUILD=false
FOLLOW_LOGS=false
for arg in "$@"; do
  case "$arg" in
    --build) FORCE_BUILD=true ;;
    --logs)  FOLLOW_LOGS=true ;;
    -h|--help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# Sanity: .env must exist and contain ANTHROPIC_API_KEY.
if [ ! -f .env ]; then
  echo "ERROR: .env not found at $PROJECT_ROOT/.env" >&2
  echo "Copy .env.example to .env and add your ANTHROPIC_API_KEY." >&2
  exit 1
fi

# Sanity: docker's --env-file parser is unforgiving. Catch common hand-edit
# mistakes before docker hits the user with a cryptic message — or worse,
# silently passes a malformed value through to the API and produces 401s.

# (1) Whitespace around '=' — rejected by docker's parser.
if grep -nE '^[A-Z_][A-Z0-9_]*[[:space:]]*=[[:space:]]' .env >/dev/null; then
  echo "ERROR: .env contains whitespace around '=' which docker's --env-file parser rejects." >&2
  echo "Offending lines:" >&2
  grep -nE '^[A-Z_][A-Z0-9_]*[[:space:]]*=[[:space:]]' .env | sed 's/^/  line /' >&2
  echo "Fix: rewrite each as KEY=value (no spaces), e.g. MASSIVE_API_KEY=abc123" >&2
  exit 1
fi

# (2) Quoted values — docker's --env-file does NOT strip surrounding quotes,
# so the literal " or ' chars become part of the value (causing 401 invalid
# x-api-key on Anthropic, etc.).
if grep -nE "^[A-Z_][A-Z0-9_]*=([\"'])(.*)\\1[[:space:]]*$" .env >/dev/null; then
  echo "ERROR: .env contains quoted values. Docker's --env-file does NOT strip surrounding quotes — the literal quote characters become part of the value." >&2
  echo "Offending lines:" >&2
  grep -nE "^[A-Z_][A-Z0-9_]*=([\"'])(.*)\\1[[:space:]]*$" .env | sed 's/^/  line /' >&2
  echo "Fix: remove the surrounding quotes, e.g. ANTHROPIC_API_KEY=sk-ant-... (not \"sk-ant-...\")" >&2
  exit 1
fi

# (3) CRLF line endings — Docker's parser includes the trailing \r in values,
# silently corrupting them. Common when .env is edited on Windows and then
# the project is run inside WSL/Docker Desktop.
# `tr -dc '\r' | wc -c` is portable across grep implementations (GNU grep on
# MSYS/Git-Bash auto-strips CR before regex matching unless run with -U).
if [ "$(tr -dc '\r' < .env | wc -c)" -gt 0 ]; then
  echo "ERROR: .env has Windows CRLF line endings. Docker's --env-file includes the trailing \\r in every value, silently corrupting them." >&2
  echo "Fix: convert to LF endings — e.g. \`dos2unix .env\`, or set your editor's line-ending mode to LF and re-save." >&2
  exit 1
fi

# Build if forced or image missing.
if $FORCE_BUILD || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Building $IMAGE"
  docker build -t "$IMAGE" .
else
  echo "==> Reusing existing image $IMAGE (use --build to force rebuild)"
fi

# Idempotent container handling.
EXISTING_STATE="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
case "$EXISTING_STATE" in
  running)
    echo "==> Container $CONTAINER is already running"
    ;;
  exited|created|paused)
    echo "==> Removing stopped container $CONTAINER"
    docker rm -f "$CONTAINER" >/dev/null
    EXISTING_STATE="missing"
    ;;
esac

if [ "$EXISTING_STATE" = "missing" ]; then
  echo "==> Starting $CONTAINER on port $PORT"
  # Bind mount: $PWD/db -> /app/db so the SQLite file is visible on the host
  # and survives container removal. (Named volume alternative: -v finally-data:/app/db)
  docker run -d \
    --name "$CONTAINER" \
    -p "$PORT:8000" \
    --env-file .env \
    -v "$(pwd)/db:/app/db" \
    --restart unless-stopped \
    "$IMAGE" >/dev/null
fi

URL="http://localhost:$PORT"
echo "==> FinAlly is starting at $URL"
echo "    Health: $URL/api/health"
echo "    Stop:   ./scripts/stop_mac.sh"

if $FOLLOW_LOGS; then
  echo "==> Tailing logs (Ctrl-C to detach; container keeps running)"
  exec docker logs -f "$CONTAINER"
fi
