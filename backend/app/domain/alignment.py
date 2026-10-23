"""Forecast selection and temporal alignment (pure pandas, no I/O).

Verified data semantics (live API, 2026-10-23):
* FUELHH WIND ``generation`` is the average MW over a 30-minute settlement period that starts at
  ``startTime``.
* WINDFOR targets are hourly (``startTime`` on the hour). Each run also repeats some past hours
  (``startTime <= publishTime``); those are not genuine predictions and are never selected.

Primary comparison: the hourly forecast at ``H`` is compared with the mean of the two
half-hourly actuals starting at ``H`` and ``H+30min``. If either half-hour is missing the hourly
actual is left empty (status ``partial``), never estimated from one half.
"""

import pandas as pd

HOUR = pd.Timedelta(hours=1)

ALIGNED_COLUMNS = [
    "forecast_mw",
    "publish_time",
    "horizon_h",
    "actual_mw",
    "actual_first_half_mw",
    "actual_half_hours",
    "actual_status",
    "error_mw",
]


def hourly_actuals(actuals: pd.DataFrame) -> pd.DataFrame:
    """Aggregate half-hourly actuals to hour-start rows. Input must have unique ``start_time``."""
    if actuals["start_time"].duplicated().any():
        raise ValueError("actuals must have unique start_time values")
    frame = actuals[["start_time", "generation_mw"]].copy()
    frame["hour"] = frame["start_time"].dt.floor("h")
    grouped = frame.groupby("hour")["generation_mw"]
    out = pd.DataFrame({"actual_half_hours": grouped.size(), "mean_mw": grouped.mean()})
    first_half = frame.loc[frame["start_time"] == frame["hour"]].set_index("hour")["generation_mw"]
    out["actual_first_half_mw"] = first_half.reindex(out.index)
    complete = out["actual_half_hours"] == 2
    out["actual_mw"] = out["mean_mw"].where(complete)
    out["actual_status"] = complete.map({True: "complete", False: "partial"})
    out.index.name = "start_time"
    return out.drop(columns="mean_mw")


def _latest_per_target(candidates: pd.DataFrame) -> pd.DataFrame:
    """For each target ``start_time`` keep the row with the latest ``publish_time``.

    A stable sort makes the choice deterministic if a (publish_time, start_time) pair repeats.
    """
    ordered = candidates.sort_values(["start_time", "publish_time"], kind="mergesort")
    latest = ordered.drop_duplicates("start_time", keep="last").copy()
    latest["horizon_h"] = (latest["start_time"] - latest["publish_time"]) / HOUR
    return latest.set_index("start_time")[["generation_mw", "publish_time", "horizon_h"]].rename(
        columns={"generation_mw": "forecast_mw"}
    )


def genuine_predictions(forecasts: pd.DataFrame) -> pd.DataFrame:
    """Drop rows whose target is not strictly after publication (past hours repeated by a run)."""
    return forecasts.loc[forecasts["start_time"] > forecasts["publish_time"]]


def select_latest_at_cutoff(
    forecasts: pd.DataFrame,
    cutoff_utc: pd.Timestamp,
    window_start: pd.Timestamp,
    window_end: pd.Timestamp,
) -> pd.DataFrame:
    """Latest forecast per target in [window_start, window_end) published at or before cutoff."""
    eligible = genuine_predictions(forecasts)
    eligible = eligible.loc[
        (eligible["publish_time"] <= cutoff_utc)
        & (eligible["start_time"] >= window_start)
        & (eligible["start_time"] < window_end)
    ]
    return _latest_per_target(eligible)


def select_at_horizon(
    forecasts: pd.DataFrame,
    window_start: pd.Timestamp,
    window_end: pd.Timestamp,
    horizon_h: float,
) -> pd.DataFrame:
    """For each target T, the latest forecast with ``publish_time <= T - horizon_h``."""
    if horizon_h < 0:
        raise ValueError("horizon_h must be >= 0")
    eligible = genuine_predictions(forecasts)
    eligible = eligible.loc[
        (eligible["start_time"] >= window_start) & (eligible["start_time"] < window_end)
    ]
    eligible = eligible.loc[
        eligible["publish_time"] <= eligible["start_time"] - pd.Timedelta(hours=horizon_h)
    ]
    return _latest_per_target(eligible)


def align(slots: pd.DatetimeIndex, selected: pd.DataFrame, hourly: pd.DataFrame) -> pd.DataFrame:
    """One row per expected hourly slot, with forecast, actual and error (NaN when unmatched)."""
    frame = pd.DataFrame(index=pd.DatetimeIndex(slots, name="start_time"))
    frame = frame.join(selected[["forecast_mw", "publish_time", "horizon_h"]])
    frame = frame.join(
        hourly[["actual_mw", "actual_first_half_mw", "actual_half_hours", "actual_status"]]
    )
    frame["actual_half_hours"] = frame["actual_half_hours"].fillna(0).astype(int)
    frame["actual_status"] = frame["actual_status"].fillna("missing")
    frame["error_mw"] = frame["forecast_mw"] - frame["actual_mw"]
    return frame[ALIGNED_COLUMNS]
