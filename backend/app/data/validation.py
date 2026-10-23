"""Validation and cleaning of raw Elexon rows into typed, de-duplicated frames.

Policy:
* Structural problems (missing fields, unparseable timestamps, empty result) raise
  ``DataValidationError``; the ingestion run fails.
* Row-level problems (non-numeric values, off-grid timestamps, conflicting duplicates) are
  removed and recorded in the report. Nothing is ever imputed or fabricated; gaps stay gaps.
"""

from typing import Any

import numpy as np
import pandas as pd

from app.domain.market import UK_TZ, IngestionWindow

ACTUAL_FIELDS = (
    "startTime",
    "generation",
    "fuelType",
    "settlementDate",
    "settlementPeriod",
    "publishTime",
)
FORECAST_FIELDS = ("publishTime", "startTime", "generation")
_MAX_EXAMPLES = 10


class DataValidationError(ValueError):
    pass


def _iso(ts: pd.Timestamp) -> str:
    return ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_fields(frame: pd.DataFrame, fields: tuple[str, ...], dataset: str) -> None:
    missing = [f for f in fields if f not in frame.columns]
    if missing:
        raise DataValidationError(f"{dataset}: response is missing required fields {missing}")


def _parse_utc(series: pd.Series, field: str, dataset: str) -> pd.Series:
    try:
        parsed = pd.to_datetime(series, utc=True, format="ISO8601")
    except (ValueError, TypeError) as exc:
        raise DataValidationError(f"{dataset}: could not parse {field}: {exc}") from exc
    if parsed.isna().any():
        raise DataValidationError(f"{dataset}: {int(parsed.isna().sum())} null {field} values")
    return parsed


def _numeric(frame: pd.DataFrame, report: dict[str, Any]) -> pd.DataFrame:
    values = pd.to_numeric(frame["generation"], errors="coerce")
    invalid = values.isna() | ~np.isfinite(values.astype(float))
    report["invalid_generation_rows_dropped"] = int(invalid.sum())
    frame = frame.loc[~invalid].copy()
    frame["generation_mw"] = values.loc[~invalid].astype(float)
    report["negative_generation_rows"] = int((frame["generation_mw"] < 0).sum())
    return frame


def clean_actuals(
    raw: list[dict[str, Any]], window: IngestionWindow
) -> tuple[pd.DataFrame, dict[str, Any]]:
    dataset = "FUELHH"
    report: dict[str, Any] = {"dataset": dataset, "rows_received": len(raw)}
    if not raw:
        raise DataValidationError(f"{dataset}: no rows returned")
    frame = pd.DataFrame(raw)
    _require_fields(frame, ACTUAL_FIELDS, dataset)

    non_wind = frame["fuelType"] != "WIND"
    report["non_wind_rows_dropped"] = int(non_wind.sum())
    frame = frame.loc[~non_wind].copy()

    frame["start_time"] = _parse_utc(frame["startTime"], "startTime", dataset)
    frame["publish_time"] = _parse_utc(frame["publishTime"], "publishTime", dataset)
    frame = _numeric(frame, report)

    off_grid = (frame["start_time"].dt.minute % 30 != 0) | (frame["start_time"].dt.second != 0)
    report["off_grid_rows_dropped"] = int(off_grid.sum())
    frame = frame.loc[~off_grid]

    in_window = (frame["start_time"] >= window.delivery_start_utc) & (
        frame["start_time"] < window.delivery_end_utc
    )
    report["out_of_window_rows_dropped"] = int((~in_window).sum())
    frame = frame.loc[in_window].sort_values(["start_time", "publish_time"], kind="mergesort")

    # Duplicates: identical values are harmless; conflicting values keep the latest revision.
    dup_all = frame.duplicated(["start_time", "generation_mw"], keep="last")
    report["duplicate_rows_identical"] = int(dup_all.sum())
    frame = frame.loc[~dup_all]
    conflicts = frame.duplicated("start_time", keep="last")
    report["duplicate_rows_conflicting"] = int(conflicts.sum())
    report["conflict_examples"] = [
        _iso(t) for t in frame.loc[conflicts, "start_time"].head(_MAX_EXAMPLES)
    ]
    frame = frame.loc[~conflicts]

    local = frame["start_time"].dt.tz_convert(UK_TZ)
    local_midnight = local.dt.normalize()
    expected_sp = (
        (frame["start_time"] - local_midnight.dt.tz_convert("UTC")) / pd.Timedelta(minutes=30)
    ).astype(int) + 1
    sp_mismatch = expected_sp != frame["settlementPeriod"].astype(int)
    sd_mismatch = local.dt.strftime("%Y-%m-%d") != frame["settlementDate"].astype(str)
    report["settlement_period_mismatches"] = int(sp_mismatch.sum())
    report["settlement_date_mismatches"] = int(sd_mismatch.sum())

    expected = pd.date_range(
        window.delivery_start_utc, window.delivery_end_utc, freq="30min", inclusive="left"
    )
    missing = expected.difference(pd.DatetimeIndex(frame["start_time"]))
    report["expected_periods"] = len(expected)
    report["missing_periods"] = [_iso(t) for t in missing]
    report["rows_clean"] = len(frame)
    if frame.empty:
        raise DataValidationError(f"{dataset}: no valid WIND rows inside the delivery window")

    clean = pd.DataFrame(
        {
            "start_time": frame["start_time"].to_numpy(),
            "settlement_date": frame["settlementDate"].astype(str).to_numpy(),
            "settlement_period": frame["settlementPeriod"].astype(int).to_numpy(),
            "generation_mw": frame["generation_mw"].to_numpy(),
            "publish_time": frame["publish_time"].to_numpy(),
        }
    )
    clean["start_time"] = pd.to_datetime(clean["start_time"], utc=True)
    clean["publish_time"] = pd.to_datetime(clean["publish_time"], utc=True)
    return clean.reset_index(drop=True), report


def clean_forecasts(
    raw: list[dict[str, Any]], window: IngestionWindow
) -> tuple[pd.DataFrame, dict[str, Any]]:
    dataset = "WINDFOR"
    report: dict[str, Any] = {"dataset": dataset, "rows_received": len(raw)}
    if not raw:
        raise DataValidationError(f"{dataset}: no rows returned")
    frame = pd.DataFrame(raw)
    _require_fields(frame, FORECAST_FIELDS, dataset)

    frame["start_time"] = _parse_utc(frame["startTime"], "startTime", dataset)
    frame["publish_time"] = _parse_utc(frame["publishTime"], "publishTime", dataset)
    frame = _numeric(frame, report)

    # Verified on the live API: WINDFOR targets are hourly (on the hour).
    off_grid = (frame["start_time"].dt.minute != 0) | (frame["start_time"].dt.second != 0)
    report["off_hour_target_rows_dropped"] = int(off_grid.sum())
    frame = frame.loc[~off_grid]

    in_window = (
        (frame["start_time"] >= window.delivery_start_utc)
        & (frame["start_time"] < window.delivery_end_utc)
        & (frame["publish_time"] >= window.publish_from_utc)
        & (frame["publish_time"] <= window.publish_to_utc)
    )
    report["out_of_window_rows_dropped"] = int((~in_window).sum())
    frame = frame.loc[in_window].sort_values(["publish_time", "start_time"], kind="mergesort")

    dup_all = frame.duplicated(["publish_time", "start_time", "generation_mw"], keep="last")
    report["duplicate_rows_identical"] = int(dup_all.sum())
    frame = frame.loc[~dup_all]
    conflicts = frame.duplicated(["publish_time", "start_time"], keep="last")
    report["duplicate_rows_conflicting"] = int(conflicts.sum())
    report["conflict_examples"] = [
        f"{_iso(p)} -> {_iso(s)}"
        for p, s in frame.loc[conflicts, ["publish_time", "start_time"]]
        .head(_MAX_EXAMPLES)
        .itertuples(index=False)
    ]
    frame = frame.loc[~conflicts]
    if frame.empty:
        raise DataValidationError(f"{dataset}: no valid rows inside the ingestion window")

    lead_h = (frame["start_time"] - frame["publish_time"]) / pd.Timedelta(hours=1)
    runs = frame.groupby("publish_time")
    steps = runs["start_time"].diff().dropna()
    publish_local = pd.DatetimeIndex(runs.size().index).tz_convert(UK_TZ)
    targets = pd.date_range(
        window.delivery_start_utc, window.delivery_end_utc, freq="h", inclusive="left"
    )
    runs_per_target = frame.groupby("start_time").size().reindex(targets, fill_value=0)

    report.update(
        {
            "rows_clean": len(frame),
            "runs": int(runs.ngroups),
            "first_publish_time": _iso(frame["publish_time"].min()),
            "last_publish_time": _iso(frame["publish_time"].max()),
            "publish_times_of_day_utc": runs.size()
            .index.strftime("%H:%M")
            .value_counts()
            .sort_index()
            .to_dict(),
            "publish_times_of_day_uk": pd.Series(publish_local.strftime("%H:%M"))
            .value_counts()
            .sort_index()
            .to_dict(),
            "runs_per_uk_day": {
                str(k): int(v)
                for k, v in pd.Series(publish_local.date).value_counts().sort_index().items()
            },
            "target_resolution_minutes": sorted({int(s / pd.Timedelta(minutes=1)) for s in steps}),
            "non_future_rows": int((lead_h <= 0).sum()),
            "lead_time_h_range": [float(lead_h.min()), float(lead_h.max())],
            "target_hours_expected": len(targets),
            "target_hours_without_any_run": [
                _iso(t) for t in runs_per_target[runs_per_target == 0].index
            ],
            "min_runs_per_target_hour": int(runs_per_target.min()),
        }
    )

    clean = frame[["publish_time", "start_time", "generation_mw"]].reset_index(drop=True)
    return clean, report
