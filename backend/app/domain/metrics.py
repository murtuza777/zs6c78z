"""Forecast accuracy metrics on aligned hourly observations.

Conventions
* ``error_mw = forecast_mw - actual_mw``: positive = over-forecast, negative = under-forecast.
* A row is *matched* when both the forecast and the (complete) hourly actual exist. Every
  error statistic uses matched rows only; denominators are the matched count.
* WAPE = sum(|error|) / sum(actual) over matched rows, in %. Undefined (None) if the actual sum
  is not positive. MAPE is deliberately not offered: it explodes when wind output is low.
* Percentiles use NumPy's default linear interpolation.
* Energy: each matched hourly MW value represents one hour, so MWh = sum(MW * 1 h), computed on
  matched hours only so forecast and actual energy cover identical periods.
"""

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Metrics:
    n_expected: int
    n_matched: int
    coverage_pct: float | None
    n_missing_forecast: int
    n_missing_actual: int
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None
    wape_pct: float | None
    p50_abs_error_mw: float | None
    p90_abs_error_mw: float | None
    p95_abs_error_mw: float | None
    p99_abs_error_mw: float | None
    max_abs_error_mw: float | None
    correlation: float | None
    forecast_energy_mwh: float | None
    actual_energy_mwh: float | None
    energy_error_mwh: float | None

    def to_dict(self) -> dict[str, float | int | None]:
        return asdict(self)


def _f(value: float) -> float | None:
    return None if value is None or not np.isfinite(value) else float(value)


def summarize(frame: pd.DataFrame) -> Metrics:
    """Metrics for rows with ``forecast_mw`` and ``actual_mw`` columns (NaN = missing)."""
    n_expected = len(frame)
    has_forecast = frame["forecast_mw"].notna()
    has_actual = frame["actual_mw"].notna()
    matched = frame.loc[has_forecast & has_actual]
    n = len(matched)
    coverage = _f(100.0 * n / n_expected) if n_expected else None
    base = {
        "n_expected": n_expected,
        "n_matched": n,
        "coverage_pct": coverage,
        "n_missing_forecast": int((~has_forecast).sum()),
        "n_missing_actual": int((~has_actual).sum()),
    }
    if n == 0:
        return Metrics(
            **base,
            **dict.fromkeys(
                [
                    "mae_mw",
                    "rmse_mw",
                    "bias_mw",
                    "wape_pct",
                    "p50_abs_error_mw",
                    "p90_abs_error_mw",
                    "p95_abs_error_mw",
                    "p99_abs_error_mw",
                    "max_abs_error_mw",
                    "correlation",
                    "forecast_energy_mwh",
                    "actual_energy_mwh",
                    "energy_error_mwh",
                ]
            ),
        )

    forecast = matched["forecast_mw"].to_numpy(dtype=float)
    actual = matched["actual_mw"].to_numpy(dtype=float)
    error = forecast - actual
    abs_error = np.abs(error)
    actual_sum = actual.sum()
    p50, p90, p95, p99 = np.percentile(abs_error, [50, 90, 95, 99])

    correlation = None
    if n >= 3 and np.std(forecast) > 0 and np.std(actual) > 0:
        correlation = _f(np.corrcoef(forecast, actual)[0, 1])

    return Metrics(
        **base,
        mae_mw=_f(abs_error.mean()),
        rmse_mw=_f(np.sqrt(np.mean(error**2))),
        bias_mw=_f(error.mean()),
        wape_pct=_f(100.0 * abs_error.sum() / actual_sum) if actual_sum > 0 else None,
        p50_abs_error_mw=_f(p50),
        p90_abs_error_mw=_f(p90),
        p95_abs_error_mw=_f(p95),
        p99_abs_error_mw=_f(p99),
        max_abs_error_mw=_f(abs_error.max()),
        correlation=correlation,
        forecast_energy_mwh=_f(forecast.sum()),
        actual_energy_mwh=_f(actual_sum),
        energy_error_mwh=_f(error.sum()),
    )


def summarize_groups(frame: pd.DataFrame, key: str | pd.Series) -> list[tuple[object, Metrics]]:
    """Metrics per group, in sorted key order."""
    return [(k, summarize(g)) for k, g in frame.groupby(key, sort=True)]


def error_histogram(errors: pd.Series, bin_width_mw: float = 250.0) -> list[dict[str, float]]:
    """Fixed-width histogram of matched errors, bins aligned to multiples of ``bin_width_mw``."""
    values = errors.dropna().to_numpy(dtype=float)
    if values.size == 0:
        return []
    lo = np.floor(values.min() / bin_width_mw) * bin_width_mw
    hi = np.ceil(values.max() / bin_width_mw) * bin_width_mw
    if hi <= lo:
        hi = lo + bin_width_mw
    edges = np.arange(lo, hi + bin_width_mw / 2, bin_width_mw)
    counts, edges = np.histogram(values, bins=edges)
    return [
        {"lower_mw": float(a), "upper_mw": float(b), "count": int(c)}
        for a, b, c in zip(edges[:-1], edges[1:], counts, strict=True)
    ]
