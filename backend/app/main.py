"""FastAPI application factory."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.deps import current_version, get_service
from app.api.errors import register_error_handlers
from app.api.v1.routes import router as v1_router
from app.config import Settings, get_settings
from app.observability import CachingMiddleware, RequestContextMiddleware, configure_logging

logger = logging.getLogger(__name__)
API_VERSION = "1.0.0"


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built React app (single-container deployments) with SPA fallback."""
    index = dist / "index.html"
    if not index.exists():
        logger.warning("frontend_dist %s has no index.html; UI not served", dist)
        return
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    root = dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"No API route /{full_path}")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        get_service()  # warm the snapshot so the first request is fast
        yield

    app = FastAPI(
        title="WindDesk API",
        version=API_VERSION,
        description="Cutoff-aware GB wind forecast selection and accuracy analytics for "
        "January 2026 day-ahead procurement decisions. Timestamps are UTC; "
        "`error_mw = forecast_mw - actual_mw`.",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(CachingMiddleware, version_provider=current_version)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET"],
            allow_headers=["*"],
        )
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)
    app.include_router(v1_router, prefix="/api/v1")
    if settings.frontend_dist:
        _mount_frontend(app, settings.frontend_dist)
    return app


app = create_app()
