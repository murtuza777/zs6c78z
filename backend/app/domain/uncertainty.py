"""Empirical P10-P90 bands from historical forecast errors (leave-one-day-out).

Method
* Errors (``forecast - actual``) of the cutoff-selected forecasts are grouped into 6-hour
  horizon buckets (lead time from publication to target hour).
* For delivery day D the quantiles use every *other* delivery day in the pool, so a day's own
  errors never shape its own band.
* actual = forecast - error, so the band is [forecast - q90(error), forecast - q10(error)],
  clipped at 0 MW.
* A bucket with fewer than ``MIN_OBS`` observations or ``MIN_DAYS`` distinct days gets no
  band. Empty is better than a misleading interval.

This is an empirical interval, not a guaranteed confidence interval: errors are autocorrelated
within a day and one month is a short history. Held-out coverage is reported alongside it.
"""

from datetime import date

import numpy as np
import pandas as pd

BUCKET_WIDTH_H = 6
MIN_OBS = 48
MIN_DAYS = 10
LOWER_Q, UPPER_Q = 0.10, 0.90
NOMINAL_COVERAGE_PCT = 80.0
METHOD = (
    "Empirical 10th-90th percentile of historical errors in the same 6 h horizon bucket, "
    "leave-one-delivery-day-out, from cutoff-selected January forecasts."
)


def horizon_bucket(horizon_h: pd.Series) -> pd.Series:
    return np.floor(horizon_h / BUCKET_WIDTH_H) * BUCKET_WIDTH_H


def bucket_label(lower_h: float) -> str:
    return f"{lower_h:.0f}–{lower_h + BUCKET_WIDTH_H:.0f} h"


def error_pool(aligned: pd.DataFrame) -> pd.DataFrame:
    """Matched errors with their delivery day and horizon bucket."""
    matched = aligned.loc[aligned["error_mw"].notna()]
    return pd.DataFrame(
        {
            "delivery_date": matched["delivery_date"].to_numpy(),
            "bucket": horizon_bucket(matched["horizon_h"]).to_numpy(),
            "error_mw": matched["error_mw"].to_numpy(),
        }
    )


def quantile_table(pool: pd.DataFrame, exclude_day: date | None = None) -> pd.DataFrame:
    """Per-bucket error quantiles and typical absolute error, excluding ``exclude_day``."""
    data = pool if exclude_day is None else pool.loc[pool["delivery_date"] != exclude_day]
    columns = ["n_obs", "n_days", "q_lo", "q_hi", "mae_mw", "p90_abs_error_mw", "supported"]
    if data.empty:
        return pd.DataFrame(columns=columns, index=pd.Index([], name="bucket"))
    data = data.assign(abs_error_mw=data["error_mw"].abs())
    grouped = data.groupby("bucket")
    table = pd.DataFrame(
        {
            "n_obs": grouped.size(),
            "n_days": grouped["delivery_date"].nunique(),
            "q_lo": grouped["error_mw"].quantile(LOWER_Q),
            "q_hi": grouped["error_mw"].quantile(UPPER_Q),
            "mae_mw": grouped["abs_error_mw"].mean(),
            "p90_abs_error_mw": grouped["abs_error_mw"].quantile(0.9),
        }
    )
    table["supported"] = (table["n_obs"] >= MIN_OBS) & (table["n_days"] >= MIN_DAYS)
    return table[columns]


def apply_band(aligned_day: pd.DataFrame, table: pd.DataFrame) -> pd.DataFrame:
    """Return ``band_p10_mw`` / ``band_p90_mw`` columns (NaN where unsupported or no forecast)."""
    buckets = horizon_bucket(aligned_day["horizon_h"])
    stats = table.reindex(buckets.to_numpy())
    supported = stats["supported"].eq(True).to_numpy()
    forecast = aligned_day["forecast_mw"].to_numpy(dtype=float)
    p10 = np.where(
        supported, np.clip(forecast - stats["q_hi"].to_numpy(dtype=float), 0, None), np.nan
    )
    p90 = np.where(
        supported, np.clip(forecast - stats["q_lo"].to_numpy(dtype=float), 0, None), np.nan
    )
    return pd.DataFrame({"band_p10_mw": p10, "band_p90_mw": p90}, index=aligned_day.index)


def evaluate_coverage(aligned: pd.DataFrame, pool: pd.DataFrame) -> dict[str, object]:
    """Held-out coverage: share of matched hours whose actual lies inside its LODO band."""
    rows = []
    for day, day_frame in aligned.groupby("delivery_date", sort=True):
        band = apply_band(day_frame, quantile_table(pool, exclude_day=day))
        evaluated = band["band_p10_mw"].notna() & day_frame["actual_mw"].notna()
        inside = (day_frame["actual_mw"] >= band["band_p10_mw"]) & (
            day_frame["actual_mw"] <= band["band_p90_mw"]
        )
        rows.append(
            pd.DataFrame(
                {
                    "bucket": horizon_bucket(day_frame["horizon_h"]),
                    "evaluated": evaluated,
                    "inside": inside & evaluated,
                }
            )
        )
    if not rows:
        return {
            "available": False,
            "n_evaluated": 0,
            "coverage_pct": None,
            "nominal_pct": NOMINAL_COVERAGE_PCT,
            "by_bucket": [],
        }
    result = pd.concat(rows)
    n_eval = int(result["evaluated"].sum())
    by_bucket = []
    for bucket, g in result.loc[result["evaluated"]].groupby("bucket", sort=True):
        by_bucket.append(
            {
                "bucket_h": float(bucket),
                "label": bucket_label(float(bucket)),
                "n_evaluated": len(g),
                "coverage_pct": float(100.0 * g["inside"].mean()),
            }
        )
    return {
        "available": n_eval > 0,
        "n_evaluated": n_eval,
        "coverage_pct": float(100.0 * result["inside"].sum() / n_eval) if n_eval else None,
        "nominal_pct": NOMINAL_COVERAGE_PCT,
        "by_bucket": by_bucket,
    }
