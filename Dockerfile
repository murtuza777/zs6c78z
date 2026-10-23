# syntax=docker/dockerfile:1

# ---- 1. Build the React app ---------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. Python runtime: FastAPI serves the API and the built UI ----------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    WINDDESK_FRONTEND_DIST=/app/frontend/dist \
    PORT=8000
WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/app ./backend/app
COPY backend/scripts ./backend/scripts
COPY backend/data ./backend/data
COPY --from=web /web/dist ./frontend/dist

RUN useradd --create-home --uid 10001 winddesk && chown -R winddesk /app/backend/data
USER winddesk

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,sys,urllib.request; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/v1/health').status == 200 else 1)"

# `exec` keeps uvicorn as PID 1 (clean SIGTERM handling) while still expanding $PORT,
# which PaaS hosts such as Heroku set at runtime.
CMD ["sh", "-c", "exec uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT} --proxy-headers"]
