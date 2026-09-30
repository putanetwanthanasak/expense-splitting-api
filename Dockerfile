# Backend image (FastAPI + Alembic). Used both for local development
# (docker-compose.yml) and in production, where Render builds and runs it as a
# Docker web service (render.yaml).

# ---- build stage: resolve dependencies with uv from uv.lock -----------------
FROM python:3.12-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependencies only (no project, no dev group) so this layer is cached until
# pyproject.toml or uv.lock changes. --locked fails the build if the lockfile
# is out of date instead of silently re-resolving.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

# ---- runtime stage ----------------------------------------------------------
FROM python:3.12-slim

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN groupadd --system app && useradd --system --gid app --no-create-home app

WORKDIR /app

COPY --from=build /app/.venv /app/.venv
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

USER app

EXPOSE 8000

# Migrates the database, then execs the CMD (see docker-entrypoint.sh).
ENTRYPOINT ["docker-entrypoint.sh"]
# Render injects PORT (10000 by default); docker compose doesn't set it, so the
# port falls back to 8000. Exec-form CMD can't expand ${PORT}, hence `sh -c`;
# its `exec` replaces the shell, so uvicorn is still PID 1 and gets SIGTERM.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
