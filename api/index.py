"""Vercel serverless entrypoint: exposes the FastAPI app that lives in ``backend/``."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app

__all__ = ["app"]
