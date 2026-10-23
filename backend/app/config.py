"""Runtime configuration, read from environment variables prefixed ``WINDDESK_``."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WINDDESK_", env_file=".env", extra="ignore")

    snapshot_dir: Path = BACKEND_DIR / "data" / "snapshot"
    # When set (e.g. inside the Docker image) the API also serves the built React app.
    frontend_dist: Path | None = None
    log_level: str = "INFO"
    log_json: bool = True
    cors_origins: list[str] = []

    elexon_base_url: str = "https://data.elexon.co.uk/bmrs/api/v1"
    http_timeout_s: float = 30.0
    http_max_retries: int = 4
    http_backoff_s: float = 1.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
