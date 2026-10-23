from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.domain.uncertainty import MIN_OBS, apply_band, evaluate_coverage, quantile_table


def pool_for(days: int, per_day: int, bucket: float = 12.0, error=lambda d, i: float(i)):
    rows = [
        {
            "delivery_date": date(2026, 1, 2) + timedelta(days=d),
            "bucket": bucket,
            "error_mw": error(d, i),
        }
        for d in range(days)
        for i in range(per_day)
    ]
    return pd.DataFrame(rows)


def test_leave_one_day_out_excludes_the_evaluated_day():
    pool = pool_for(20, 6, error=lambda d, i: 1_000_000.0 if d == 0 else float(i))
    held_out = quantile_table(pool, exclude_day=date(2026, 1, 2))
    assert held_out.loc[12.0, "mae_mw"] < 10
    assert held_out.loc[12.0, "n_days"] == 19
    assert quantile_table(pool).loc[12.0, "mae_mw"] > 1000


def test_band_is_forecast_minus_error_quantiles_and_clipped_at_zero():
    table = pd.DataFrame(
        {
            "n_obs": [100],
            "n_days": [20],
            "q_lo": [-100.0],
            "q_hi": [200.0],
            "mae_mw": [1.0],
            "p90_abs_error_mw": [1.0],
            "supported": [True],
        },
        index=pd.Index([12.0], name="bucket"),
    )
    day = pd.DataFrame({"forecast_mw": [1000.0, 150.0], "horizon_h": [14.5, 15.5]})
    band = apply_band(day, table)
    assert band["band_p10_mw"].tolist() == [800.0, 0.0]
    assert band["band_p90_mw"].tolist() == [1100.0, 250.0]


def test_band_is_withheld_when_history_is_too_thin():
    pool = pool_for(5, 2)  # 10 observations, below MIN_OBS and MIN_DAYS
    table = quantile_table(pool)
    assert len(pool) < MIN_OBS
    assert not table.loc[12.0, "supported"]
    band = apply_band(pd.DataFrame({"forecast_mw": [1000.0], "horizon_h": [14.5]}), table)
    assert np.isnan(band["band_p10_mw"].iloc[0])


def test_band_is_empty_for_hours_without_forecast():
    table = quantile_table(pool_for(20, 6))
    band = apply_band(pd.DataFrame({"forecast_mw": [np.nan], "horizon_h": [np.nan]}), table)
    assert band.isna().all().all()


def test_held_out_coverage_is_near_nominal_for_well_behaved_errors():
    rng = np.random.default_rng(7)
    days = [date(2026, 1, 2) + timedelta(days=d) for d in range(30)]
    aligned = pd.DataFrame(
        {
            "delivery_date": np.repeat(days, 24),
            "horizon_h": np.tile(np.arange(14.5, 17.5, 0.125)[:24], 30),
            "forecast_mw": 5000.0,
        }
    )
    errors = rng.normal(0, 500, len(aligned))
    aligned["actual_mw"] = aligned["forecast_mw"] - errors
    aligned["error_mw"] = errors
    pool = pd.DataFrame(
        {"delivery_date": aligned["delivery_date"], "bucket": 12.0, "error_mw": errors}
    )
    result = evaluate_coverage(aligned, pool)
    assert result["available"] and result["n_evaluated"] == 720
    assert 72 <= result["coverage_pct"] <= 88
