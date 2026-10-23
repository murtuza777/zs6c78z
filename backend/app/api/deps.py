"""Dependency wiring: a lazily-initialised, process-wide analytics service.

Lazy initialisation keeps serverless runtimes that skip ASGI lifespan events working; the
lifespan hook still warms the service eagerly where it is supported.
"""

import logging
import threading
import time as _time
from datetime import time
from typing import Annotated

from fastapi import Depends, Query

from app.config import get_settings
from app.data.snapshot import load_snapshot
from app.domain.market import DEFAULT_GATE, format_gate, parse_gate
from app.services import AnalyticsService, RequestError
from app.version import CODE_FINGERPRINT

logger = logging.getLogger(__name__)
_lock = threading.Lock()
_service: AnalyticsService | None = None


def get_service() -> AnalyticsService:
    global _service
    if _service is None:
        with _lock:
            if _service is None:
                started = _time.perf_counter()
                settings = get_settings()
                snapshot = load_snapshot(settings.snapshot_dir)
                _service = AnalyticsService(snapshot)
                logger.info(
                    "snapshot loaded",
                    extra={
                        "extra_fields": {
                            "snapshot_version": snapshot.version,
                            "dir": str(settings.snapshot_dir),
                            "load_ms": round((_time.perf_counter() - started) * 1000, 1),
                        }
                    },
                )
    return _service


def current_version() -> str | None:
    """Cache-validator identity: data snapshot + code build (either changing busts ETags)."""
    return f"{_service.snapshot.version}.{CODE_FINGERPRINT}" if _service else None


def reset_service() -> None:
    """Test hook: forget the cached service so the next request reloads settings."""
    global _service
    with _lock:
        _service = None


def gate_param(
    gate: Annotated[
        str, Query(description="Gate closure, UK local time (HH:MM)", examples=["09:50"])
    ] = format_gate(DEFAULT_GATE),
) -> time:
    try:
        return parse_gate(gate)
    except ValueError as exc:
        raise RequestError(str(exc), "gate") from exc


Service = Annotated[AnalyticsService, Depends(get_service)]
Gate = Annotated[time, Depends(gate_param)]
