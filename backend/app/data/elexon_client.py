"""Thin, retrying client for the Elexon BMRS Insights API (stream endpoints only)."""

import logging
import time as _time
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import httpx
import pandas as pd

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class ElexonError(RuntimeError):
    """A request to Elexon failed permanently (after retries) or returned an invalid payload."""


class ElexonClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float = 30.0,
        max_retries: int = 4,
        backoff_s: float = 1.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_s),
            headers={"Accept": "application/json", "User-Agent": "winddesk-ingest/1.0"},
            transport=transport,
        )
        self._max_retries = max_retries
        self._backoff_s = backoff_s

    def __enter__(self) -> "ElexonClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self._client.close()

    def get_rows(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        """GET a stream endpoint and return its JSON array, retrying transient failures."""
        attempt = 0
        while True:
            attempt += 1
            try:
                response = self._client.get(path, params=params)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt > self._max_retries:
                    raise ElexonError(
                        f"{path} {params}: network error after {attempt} attempts: {exc!r}"
                    ) from exc
                self._sleep(attempt, None, reason=repr(exc))
                continue

            if response.status_code in RETRYABLE_STATUS and attempt <= self._max_retries:
                self._sleep(
                    attempt,
                    response.headers.get("Retry-After"),
                    reason=f"HTTP {response.status_code}",
                )
                continue
            if response.status_code != 200:
                raise ElexonError(
                    f"{path} {params}: HTTP {response.status_code}: {response.text[:300]}"
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise ElexonError(f"{path} {params}: response is not valid JSON") from exc
            if not isinstance(payload, list):
                raise ElexonError(
                    f"{path} {params}: expected a JSON array, got {type(payload).__name__}"
                )
            logger.info("fetched %s rows from %s %s", len(payload), path, params)
            return payload

    def _sleep(self, attempt: int, retry_after: str | None, *, reason: str) -> None:
        delay = self._backoff_s * 2 ** (attempt - 1)
        if retry_after and retry_after.isdigit():
            delay = max(delay, float(retry_after))
        logger.warning("retrying in %.1fs (attempt %s, %s)", delay, attempt, reason)
        _time.sleep(delay)

    def fetch_fuelhh_wind(self, settlement_from: date, settlement_to: date) -> list[dict[str, Any]]:
        """Half-hourly WIND outturn for settlement dates [from, to] (both inclusive)."""
        rows: list[dict[str, Any]] = []
        for chunk_start, chunk_end in _date_chunks(settlement_from, settlement_to, days=7):
            rows += self.get_rows(
                "/datasets/FUELHH/stream",
                {
                    "settlementDateFrom": chunk_start.isoformat(),
                    "settlementDateTo": chunk_end.isoformat(),
                    "fuelType": "WIND",
                },
            )
        return rows

    def fetch_windfor(
        self, publish_from: pd.Timestamp, publish_to: pd.Timestamp
    ) -> list[dict[str, Any]]:
        """All WINDFOR runs with publishTime in [from, to], requested one day at a time."""
        rows: list[dict[str, Any]] = []
        for chunk_start, chunk_end in _time_chunks(publish_from, publish_to, hours=24):
            rows += self.get_rows(
                "/datasets/WINDFOR/stream",
                {
                    "publishDateTimeFrom": _iso_z(chunk_start),
                    "publishDateTimeTo": _iso_z(chunk_end),
                },
            )
        return rows


def _iso_z(ts: pd.Timestamp) -> str:
    return ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def _date_chunks(start: date, end: date, *, days: int) -> Iterator[tuple[date, date]]:
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=days - 1), end)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def _time_chunks(
    start: pd.Timestamp, end: pd.Timestamp, *, hours: int
) -> Iterator[tuple[pd.Timestamp, pd.Timestamp]]:
    # Chunks share boundaries; duplicate rows at a boundary are removed during validation.
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + pd.Timedelta(hours=hours), end)
        yield cursor, chunk_end
        cursor = chunk_end
