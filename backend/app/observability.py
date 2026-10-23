"""Structured logging, request IDs, timing and HTTP caching middleware."""

import contextvars
import hashlib
import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
logger = logging.getLogger("winddesk.http")

# Browsers must revalidate every time (a cheap 304 when nothing changed), so a deploy is picked
# up immediately; the CDN may keep a copy for a day (Vercel's edge cache is per deployment).
CACHE_CONTROL = "public, max-age=0, must-revalidate, s-maxage=86400"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        payload.update(getattr(record, "extra_fields", {}))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str, as_json: bool) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(
        JsonFormatter()
        if as_json
        else logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    logging.getLogger("uvicorn.access").disabled = True  # replaced by our access log


_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
# The SPA loads only same-origin scripts; ECharts tooltips need inline style attributes and
# the UI font comes from Google Fonts. Swagger UI (/api/docs) uses a CDN, so it is excluded.
APP_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' "
    "https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
    "form-action 'self'"
)
API_CSP = "default-src 'none'; frame-ancestors 'none'"


def _internal_error(request_id: str, path: str) -> Response:
    """Generic 500: never leaks exception text, stack traces or configuration to clients."""
    body = {
        "type": "about:blank",
        "title": "Internal server error",
        "status": 500,
        "detail": f"Unexpected error. Quote request ID {request_id} when reporting it.",
        "instance": path,
    }
    return JSONResponse(body, status_code=500, media_type="application/problem+json")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Request ID, structured access log, timing and security headers; last-resort 500s."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        supplied = request.headers.get("x-request-id", "")
        request_id = supplied if _REQUEST_ID_RE.match(supplied) else uuid.uuid4().hex[:16]
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("unhandled error", extra={"extra_fields": {"path": request.url.path}})
            response = _internal_error(request_id, request.url.path)
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        response.headers["Server-Timing"] = f"app;dur={duration_ms:.1f}"
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        path = request.url.path
        if not path.startswith(("/api/docs", "/api/openapi.json")):
            csp = API_CSP if path.startswith("/api/") else APP_CSP
            response.headers.setdefault("Content-Security-Policy", csp)
        logger.info(
            "request",
            extra={
                "extra_fields": {
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "query": request.url.query,
                    "status": response.status_code,
                    "duration_ms": round(duration_ms, 1),
                }
            },
        )
        return response


class CachingMiddleware(BaseHTTPMiddleware):
    """Strong caching for immutable historical API responses, keyed by snapshot version."""

    def __init__(self, app, version_provider: Callable[[], str | None]) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._version = version_provider

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        path = request.url.path
        cacheable = (
            request.method == "GET" and path.startswith("/api/v1/") and not path.endswith("/health")
        )
        version = self._version() if cacheable else None
        if not version:
            response = await call_next(request)
            if path.endswith("/health"):
                response.headers["Cache-Control"] = "no-store"
            return response

        digest = hashlib.sha256(f"{path}?{request.url.query}".encode()).hexdigest()[:16]
        etag = f'W/"{version}-{digest}"'
        if etag in request.headers.get("if-none-match", ""):
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": CACHE_CONTROL})
        response = await call_next(request)
        if response.status_code == 200:
            response.headers["ETag"] = etag
            response.headers["Cache-Control"] = CACHE_CONTROL
        return response
