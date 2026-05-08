# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the Next.js static export ----
FROM node:20-slim AS frontend-builder

WORKDIR /build/frontend

# Copy lockfile + manifest first so dependency install is cached separately
# from source changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# Copy the rest of the frontend project and build the static export.
COPY frontend/ ./
RUN npm run build && [ -d out ] && cp -r out /build/out


# ---- Stage 2: Python runtime with uv ----
FROM python:3.12-slim AS runtime

# Install uv via the official standalone binary (small, no pip install).
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /usr/local/bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    FINALLY_STATIC_DIR=/app/static \
    FINALLY_DB_PATH=/app/db/finally.db \
    FINALLY_SCHEMA_PATH=/app/db_schema/schema.sql

WORKDIR /app

# Install dependencies first (cached layer). Hatchling reads README.md during
# metadata validation even with --no-install-project, so it must be present.
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --extra dev

# Copy backend source. Split from the dependency install so source changes
# don't bust the dependency cache layer.
COPY backend/app ./app
# Schema files go to /app/db_schema/ (NOT /app/db/) because /app/db/ is the
# bind-mount target for finally.db at runtime — the host volume would shadow
# anything we baked there. The backend reads the schema via FINALLY_SCHEMA_PATH.
COPY backend/db ./db_schema

# Install the project itself into the venv (now that source is in place).
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --extra dev

# Copy the built static frontend. FastAPI mounts this directory via
# FINALLY_STATIC_DIR (default /app/static) — see backend-engineer's app/main.py.
COPY --from=frontend-builder /build/out ./static

# Bind-mount target for the SQLite database (db/finally.db lives here at runtime).
RUN mkdir -p /app/db

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
