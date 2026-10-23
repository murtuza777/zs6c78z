"""Reproducible ingestion: Elexon BMRS -> validated, versioned snapshot.

Usage (from ``backend/``):
    python scripts/ingest.py                      # writes data/snapshot/
    python scripts/ingest.py --out /tmp/snap      # alternative directory
    python scripts/ingest.py --allow-incomplete   # keep a snapshot that has gaps

Fetches only what January 2026 decisions need (see ``app.domain.market.ingestion_window``),
validates it, and writes compressed CSVs plus ``manifest.json``. Exits non-zero on failure.

Safety: an incomplete result (missing actual periods or target hours with no forecast run) is
refused unless ``--allow-incomplete`` is given, and the new snapshot replaces the old one only
after it has been written and verified in a staging directory.
"""

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path
from typing import Any, Protocol

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.data.elexon_client import ElexonClient, ElexonError
from app.data.snapshot import publish_snapshot
from app.data.validation import DataValidationError, clean_actuals, clean_forecasts
from app.domain.market import DECISION_END, DECISION_START, ingestion_window

logger = logging.getLogger("ingest")


class IncompleteDataError(DataValidationError):
    """The fetched data has gaps; refusing to replace the snapshot without explicit consent."""


class SourceClient(Protocol):
    def fetch_fuelhh_wind(self, settlement_from: date, settlement_to: date) -> list[Any]: ...

    def fetch_windfor(self, publish_from: pd.Timestamp, publish_to: pd.Timestamp) -> list[Any]: ...


def completeness_problems(actuals_report: dict, forecasts_report: dict) -> list[str]:
    problems = []
    if actuals_report.get("missing_periods"):
        problems.append(f"{len(actuals_report['missing_periods'])} missing actual half-hours")
    if forecasts_report.get("target_hours_without_any_run"):
        hours = len(forecasts_report["target_hours_without_any_run"])
        problems.append(f"{hours} delivery hours with no forecast run")
    return problems


def run(
    out_dir: Path,
    *,
    client: SourceClient | None = None,
    decision_range: tuple[date, date] = (DECISION_START, DECISION_END),
    allow_incomplete: bool = False,
) -> dict:
    settings = get_settings()
    first_decision, last_decision = decision_range
    window = ingestion_window(first_decision, last_decision)
    logger.info(
        "delivery window %s -> %s (UTC, end exclusive)",
        window.delivery_start_utc,
        window.delivery_end_utc,
    )
    logger.info(
        "forecast publish window %s -> %s (UTC, inclusive)",
        window.publish_from_utc,
        window.publish_to_utc,
    )

    if client is None:
        with ElexonClient(
            settings.elexon_base_url,
            timeout_s=settings.http_timeout_s,
            max_retries=settings.http_max_retries,
            backoff_s=settings.http_backoff_s,
        ) as elexon:
            return run(
                out_dir,
                client=elexon,
                decision_range=decision_range,
                allow_incomplete=allow_incomplete,
            )

    raw_actuals = client.fetch_fuelhh_wind(window.delivery_start_date, window.delivery_end_date)
    raw_forecasts = client.fetch_windfor(window.publish_from_utc, window.publish_to_utc)

    actuals, actuals_report = clean_actuals(raw_actuals, window)
    forecasts, forecasts_report = clean_forecasts(raw_forecasts, window)

    for report in (actuals_report, forecasts_report):
        if report.get("missing_periods") or report.get("target_hours_without_any_run"):
            logger.warning("%s has gaps; they are kept as gaps (never imputed)", report["dataset"])
        if report.get("duplicate_rows_conflicting"):
            logger.warning(
                "%s had %s conflicting duplicates",
                report["dataset"],
                report["duplicate_rows_conflicting"],
            )

    problems = completeness_problems(actuals_report, forecasts_report)
    if problems and not allow_incomplete:
        raise IncompleteDataError(
            "refusing to replace the snapshot: "
            + "; ".join(problems)
            + " (re-run later, or pass --allow-incomplete to keep the gaps)"
        )

    manifest = publish_snapshot(
        out_dir,
        actuals,
        forecasts,
        {
            "scope": {
                "decision_dates": [first_decision.isoformat(), last_decision.isoformat()],
                "delivery_dates": [
                    window.delivery_start_date.isoformat(),
                    window.delivery_end_date.isoformat(),
                ],
                "delivery_window_utc": [
                    window.delivery_start_utc.isoformat(),
                    window.delivery_end_utc.isoformat(),
                ],
                "forecast_publish_window_utc": [
                    window.publish_from_utc.isoformat(),
                    window.publish_to_utc.isoformat(),
                ],
            },
            "sources": {
                "actuals": {
                    "endpoint": f"{settings.elexon_base_url}/datasets/FUELHH/stream",
                    "params": {
                        "settlementDateFrom": window.delivery_start_date.isoformat(),
                        "settlementDateTo": window.delivery_end_date.isoformat(),
                        "fuelType": "WIND",
                    },
                    "semantics": "Half-hourly average MW per settlement period (Elexon docs).",
                },
                "forecasts": {
                    "endpoint": f"{settings.elexon_base_url}/datasets/WINDFOR/stream",
                    "params": {
                        "publishDateTimeFrom": window.publish_from_utc.isoformat(),
                        "publishDateTimeTo": window.publish_to_utc.isoformat(),
                        "chunking": "24 h publish-time windows",
                    },
                    "semantics": "Hourly MW forecast for metered wind visible to NESO.",
                },
            },
            "validation": {
                "actuals": actuals_report,
                "forecasts": forecasts_report,
                "incomplete_accepted": problems,
            },
        },
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out", type=Path, default=get_settings().snapshot_dir)
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="write the snapshot even if actuals or forecasts have gaps (gaps stay gaps)",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        manifest = run(args.out, allow_incomplete=args.allow_incomplete)
    except (ElexonError, DataValidationError) as exc:
        logger.error("ingestion failed: %s", exc)
        return 1
    summary = {k: manifest[k] for k in ("snapshot_version", "created_at", "files")}
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
