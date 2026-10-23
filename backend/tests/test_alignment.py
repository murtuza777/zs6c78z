import math

import pandas as pd
import pytest

from app.domain.alignment import align, hourly_actuals, select_at_horizon, select_latest_at_cutoff
from tests import factories as f
from tests.factories import ts

WINDOW = (ts("2026-01-16T00:00"), ts("2026-01-17T00:00"))


def test_hourly_actual_is_mean_of_both_half_hours():
    hh = f.actuals("2026-01-16T00:00", 4, value=lambda i: [100, 300, 500, 700][i])
    hourly = hourly_actuals(hh)
    assert hourly.loc[ts("2026-01-16T00:00"), "actual_mw"] == 200
    assert hourly.loc[ts("2026-01-16T01:00"), "actual_mw"] == 600
    assert hourly.loc[ts("2026-01-16T00:00"), "actual_first_half_mw"] == 100
    assert (hourly["actual_status"] == "complete").all()


def test_hour_with_one_missing_half_is_partial_and_not_estimated():
    hh = f.actuals("2026-01-16T00:00", 4, value=500, skip={3})
    hourly = hourly_actuals(hh)
    row = hourly.loc[ts("2026-01-16T01:00")]
    assert row["actual_status"] == "partial"
    assert row["actual_half_hours"] == 1
    assert math.isnan(row["actual_mw"])
    assert row["actual_first_half_mw"] == 500


def test_duplicate_actual_periods_are_rejected():
    hh = f.actuals("2026-01-16T00:00", 2)
    with pytest.raises(ValueError, match="unique"):
        hourly_actuals(pd.concat([hh, hh]))


def test_forecast_published_after_cutoff_is_excluded():
    forecasts = f.runs(
        f.run("2026-01-15T07:30", "2026-01-16T00:00", 24, 700),
        f.run("2026-01-15T09:30", "2026-01-16T00:00", 24, 930),
        f.run("2026-01-15T11:30", "2026-01-16T00:00", 24, 1130),  # after the 09:50 gate
    )
    selected = select_latest_at_cutoff(forecasts, ts("2026-01-15T09:50"), *WINDOW)
    assert len(selected) == 24
    assert (selected["forecast_mw"] == 930).all()
    assert (selected["publish_time"] == ts("2026-01-15T09:30")).all()
    assert (selected["publish_time"] <= ts("2026-01-15T09:50")).all()


def test_forecast_published_exactly_at_cutoff_is_eligible():
    forecasts = f.run("2026-01-15T09:50", "2026-01-16T00:00", 24, 1)
    selected = select_latest_at_cutoff(forecasts, ts("2026-01-15T09:50"), *WINDOW)
    assert len(selected) == 24


def test_non_future_targets_are_never_selected():
    # A run published at 10:30 on the delivery day repeats hours 00:00-10:00 (past) - those rows
    # must not count as forecasts, even though they are the latest publication.
    forecasts = f.runs(
        f.run("2026-01-15T09:30", "2026-01-16T00:00", 24, 1),
        f.run("2026-01-16T10:30", "2026-01-16T00:00", 24, 2),
    )
    selected = select_latest_at_cutoff(forecasts, ts("2026-01-16T23:00"), *WINDOW)
    past = selected.loc[selected.index <= ts("2026-01-16T10:30")]
    future = selected.loc[selected.index > ts("2026-01-16T10:30")]
    assert (past["forecast_mw"] == 1).all()
    assert (future["forecast_mw"] == 2).all()
    assert (selected["horizon_h"] > 0).all()


def test_latest_run_missing_a_target_falls_back_to_previous_run_for_that_hour():
    forecasts = f.runs(
        f.run("2026-01-15T07:30", "2026-01-16T00:00", 24, 730),
        f.run("2026-01-15T09:30", "2026-01-16T00:00", 20, 930),  # no forecast for 20:00-23:00
    )
    selected = select_latest_at_cutoff(forecasts, ts("2026-01-15T09:50"), *WINDOW)
    assert selected.loc[ts("2026-01-16T19:00"), "publish_time"] == ts("2026-01-15T09:30")
    assert selected.loc[ts("2026-01-16T20:00"), "publish_time"] == ts("2026-01-15T07:30")
    assert selected.loc[ts("2026-01-16T20:00"), "forecast_mw"] == 730


def test_duplicate_publications_yield_one_row_per_target():
    one = f.run("2026-01-15T09:30", "2026-01-16T00:00", 24, 930)
    selected = select_latest_at_cutoff(f.runs(one, one), ts("2026-01-15T09:50"), *WINDOW)
    assert len(selected) == 24
    assert selected.index.is_unique


def test_selection_respects_half_open_delivery_window():
    forecasts = f.run("2026-01-15T09:30", "2026-01-15T23:00", 26, 1)  # 23:00 D-1 .. 00:00 D+2
    selected = select_latest_at_cutoff(forecasts, ts("2026-01-15T09:50"), *WINDOW)
    assert selected.index.min() == ts("2026-01-16T00:00")
    assert selected.index.max() == ts("2026-01-16T23:00")


def test_horizon_is_hours_between_publication_and_target():
    forecasts = f.run("2026-01-15T09:30", "2026-01-16T00:00", 24)
    selected = select_latest_at_cutoff(forecasts, ts("2026-01-15T09:50"), *WINDOW)
    assert selected["horizon_h"].iloc[0] == 14.5
    assert selected["horizon_h"].iloc[-1] == 37.5


def test_select_at_horizon_uses_latest_run_at_least_h_hours_before_target():
    forecasts = f.runs(
        f.run("2026-01-15T09:30", "2026-01-16T00:00", 24, 1),
        f.run("2026-01-15T22:30", "2026-01-16T00:00", 24, 2),
    )
    selected = select_at_horizon(forecasts, *WINDOW, horizon_h=12)
    # Target 10:00: 22:30 run is 11.5 h before -> too late; 09:30 run (24.5 h) is used.
    assert selected.loc[ts("2026-01-16T10:00"), "forecast_mw"] == 1
    # Target 11:00: 22:30 run is 12.5 h before -> eligible and latest.
    assert selected.loc[ts("2026-01-16T11:00"), "forecast_mw"] == 2
    assert (selected["horizon_h"] >= 12).all()


def test_select_at_horizon_rejects_negative_horizon():
    with pytest.raises(ValueError):
        select_at_horizon(f.run("2026-01-15T09:30", "2026-01-16T00:00", 24), *WINDOW, horizon_h=-1)


def test_select_at_horizon_returns_empty_when_nothing_is_old_enough():
    forecasts = f.run("2026-01-15T09:30", "2026-01-16T00:00", 24)
    assert select_at_horizon(forecasts, *WINDOW, horizon_h=48).empty


def test_align_reports_missing_forecasts_and_actuals_without_imputation():
    slots = pd.date_range(*WINDOW, freq="h", inclusive="left")
    forecasts = f.run("2026-01-15T09:30", "2026-01-16T00:00", 22, 1000)  # 22:00, 23:00 missing
    hh = f.actuals("2026-01-16T00:00", 48, 900, skip={0, 1, 5})  # hour 0 missing, hour 2 partial
    aligned = align(
        slots,
        select_latest_at_cutoff(forecasts, ts("2026-01-15T09:50"), *WINDOW),
        hourly_actuals(hh),
    )
    assert len(aligned) == 24
    assert aligned.loc[ts("2026-01-16T00:00"), "actual_status"] == "missing"
    assert aligned.loc[ts("2026-01-16T02:00"), "actual_status"] == "partial"
    assert aligned["forecast_mw"].isna().sum() == 2
    assert aligned.loc[ts("2026-01-16T03:00"), "error_mw"] == 100
    assert aligned["error_mw"].notna().sum() == 20
