"""Reproducible ingestion: Elexon BMRS -> validated, versioned snapshot.

Usage (from ``backend/``):
    python scripts/ingest.py                 # writes data/snapshot/
    python scripts/ingest.py --out /tmp/snap # alternative directory

Fetches only what January 2026 decisions need (see ``app.domain.market.ingestion_window``),
validates it, and writes compressed CSVs plus ``manifest.json``. Exits non-zero on failure.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.data.elexon_client import ElexonClient, ElexonError
from app.data.snapshot import write_snapshot
from app.data.validation import DataValidationError, clean_actuals, clean_forecasts
from app.domain.market import DECISION_END, DECISION_START, ingestion_window

logger = logging.getLogger("ingest")


def run(out_dir: Path) -> dict:
    settings = get_settings()
    window = ingestion_window(DECISION_START, DECISION_END)
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

    with ElexonClient(
        settings.elexon_base_url,
        timeout_s=settings.http_timeout_s,
        max_retries=settings.http_max_retries,
        backoff_s=settings.http_backoff_s,
    ) as client:
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

    manifest = write_snapshot(
        out_dir,
        actuals,
        forecasts,
        {
            "scope": {
                "decision_dates": [DECISION_START.isoformat(), DECISION_END.isoformat()],
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
            "validation": {"actuals": actuals_report, "forecasts": forecasts_report},
        },
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out", type=Path, default=get_settings().snapshot_dir)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        manifest = run(args.out)
    except (ElexonError, DataValidationError) as exc:
        logger.error("ingestion failed: %s", exc)
        return 1
    summary = {k: manifest[k] for k in ("snapshot_version", "created_at", "files")}
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
