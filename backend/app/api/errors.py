"""RFC 9457 problem+json error responses."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.data.snapshot import SnapshotError
from app.domain.market import NonexistentLocalTimeError
from app.services import RequestError

logger = logging.getLogger(__name__)
PROBLEM = "application/problem+json"


def problem(
    status: int,
    title: str,
    detail: str,
    request: Request,
    errors: list[dict] | None = None,
    type_: str = "about:blank",
) -> JSONResponse:
    body = {
        "type": type_,
        "title": title,
        "status": status,
        "detail": detail,
        "instance": str(request.url.path),
    }
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type=PROBLEM)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg", ""), "type": e.get("type")}
            for e in exc.errors()
        ]
        detail = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in errors)
        return problem(
            422,
            "Invalid request parameters",
            detail,
            request,
            errors,
            "/problems/invalid-parameters",
        )

    @app.exception_handler(RequestError)
    async def _request(request: Request, exc: RequestError) -> JSONResponse:
        errors = [{"loc": ["query", exc.field] if exc.field else [], "msg": exc.detail}]
        return problem(
            422,
            "Request outside supported scope",
            exc.detail,
            request,
            errors,
            "/problems/out-of-scope",
        )

    @app.exception_handler(NonexistentLocalTimeError)
    async def _local_time(request: Request, exc: NonexistentLocalTimeError) -> JSONResponse:
        errors = [{"loc": ["query", "gate"], "msg": str(exc)}]
        return problem(
            422,
            "Gate time does not exist on this date",
            str(exc),
            request,
            errors,
            "/problems/out-of-scope",
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem(
            exc.status_code,
            "Not found" if exc.status_code == 404 else "HTTP error",
            str(exc.detail),
            request,
        )

    @app.exception_handler(SnapshotError)
    async def _snapshot(request: Request, exc: SnapshotError) -> JSONResponse:
        logger.error("snapshot unavailable: %s", exc)
        return problem(503, "Historical snapshot unavailable", str(exc), request)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error")
        return problem(
            500,
            "Internal server error",
            "Unexpected error; quote the X-Request-ID header when reporting it.",
            request,
        )
