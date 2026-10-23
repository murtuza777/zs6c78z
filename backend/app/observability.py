"""Structured logging, request IDs, timing and HTTP caching middleware."""

import contextvars
import hashlib
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
logger = logging.getLogger("winddesk.http")

# Historical results never change for a given snapshot version.
CACHE_CONTROL = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"


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


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns a request ID, logs one structured access line, and adds timing headers."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        response.headers["Server-Timing"] = f"app;dur={duration_ms:.1f}"
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
