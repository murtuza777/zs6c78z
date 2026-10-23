"""Versioned on-disk snapshot: two gzip-compressed CSVs plus a JSON manifest with checksums."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

ACTUALS_FILE = "actuals_wind_halfhourly.csv.gz"
FORECASTS_FILE = "forecasts_wind.csv.gz"
MANIFEST_FILE = "manifest.json"
SCHEMA_VERSION = 1
# mtime=0 keeps gzip output byte-identical for identical data, so checksums are reproducible.
_GZIP = {"method": "gzip", "mtime": 0}
_TS_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class SnapshotError(RuntimeError):
    pass


@dataclass(frozen=True)
class Snapshot:
    # start_time, settlement_date, settlement_period, generation_mw, publish_time
    actuals: pd.DataFrame
    forecasts: pd.DataFrame  # publish_time, start_time, generation_mw
    manifest: dict[str, Any]

    @property
    def version(self) -> str:
        return str(self.manifest["snapshot_version"])


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _serialise(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    out = frame[columns].copy()
    for col in ("start_time", "publish_time"):
        out[col] = out[col].dt.tz_convert("UTC").dt.strftime(_TS_FORMAT)
    return out


def write_snapshot(
    directory: Path,
    actuals: pd.DataFrame,
    forecasts: pd.DataFrame,
    manifest_fields: dict[str, Any],
) -> dict[str, Any]:
    directory.mkdir(parents=True, exist_ok=True)
    actuals_path = directory / ACTUALS_FILE
    forecasts_path = directory / FORECASTS_FILE
    _serialise(
        actuals,
        ["start_time", "settlement_date", "settlement_period", "generation_mw", "publish_time"],
    ).to_csv(actuals_path, index=False, compression=_GZIP)
    _serialise(forecasts, ["publish_time", "start_time", "generation_mw"]).to_csv(
        forecasts_path, index=False, compression=_GZIP
    )

    files = {
        ACTUALS_FILE: {"sha256": _sha256(actuals_path), "rows": len(actuals)},
        FORECASTS_FILE: {"sha256": _sha256(forecasts_path), "rows": len(forecasts)},
    }
    content_hash = hashlib.sha256(
        (files[ACTUALS_FILE]["sha256"] + files[FORECASTS_FILE]["sha256"]).encode()
    ).hexdigest()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "snapshot_version": f"jan2026-{content_hash[:10]}",
        "created_at": datetime.now(UTC).strftime(_TS_FORMAT),
        **manifest_fields,
        "files": files,
    }
    (directory / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def load_snapshot(directory: Path, *, verify_checksums: bool = True) -> Snapshot:
    manifest_path = directory / MANIFEST_FILE
    if not manifest_path.exists():
        raise SnapshotError(
            f"No snapshot manifest at {manifest_path}. Run `python scripts/ingest.py` first."
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise SnapshotError(f"Unsupported snapshot schema {manifest.get('schema_version')}")

    for name, meta in manifest["files"].items():
        path = directory / name
        if not path.exists():
            raise SnapshotError(f"Snapshot file missing: {path}")
        if verify_checksums and _sha256(path) != meta["sha256"]:
            raise SnapshotError(f"Checksum mismatch for {path}; snapshot is corrupt or edited")

    actuals = pd.read_csv(directory / ACTUALS_FILE, dtype={"settlement_date": str})
    forecasts = pd.read_csv(directory / FORECASTS_FILE)
    for frame in (actuals, forecasts):
        for col in ("start_time", "publish_time"):
            frame[col] = pd.to_datetime(frame[col], utc=True, format=_TS_FORMAT)
        frame["generation_mw"] = frame["generation_mw"].astype(float)

    for name, frame in ((ACTUALS_FILE, actuals), (FORECASTS_FILE, forecasts)):
        if len(frame) != manifest["files"][name]["rows"]:
            raise SnapshotError(f"Row count mismatch for {name}")
    if actuals["start_time"].duplicated().any():
        raise SnapshotError("Snapshot actuals contain duplicate start_time values")
    if forecasts.duplicated(["publish_time", "start_time"]).any():
        raise SnapshotError("Snapshot forecasts contain duplicate (publish_time, start_time)")
    return Snapshot(actuals=actuals, forecasts=forecasts, manifest=manifest)
