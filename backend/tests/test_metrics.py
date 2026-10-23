import math

import numpy as np
import pandas as pd
import pytest

from app.domain.metrics import error_histogram, summarize


def frame(forecast, actual):
    return pd.DataFrame({"forecast_mw": forecast, "actual_mw": actual}, dtype=float)


def test_metrics_match_hand_computed_values():
    # errors = [-10, 20, -30, 0]; |errors| = [10, 20, 30, 0]
    m = summarize(frame([100, 200, 300, 400], [110, 180, 330, 400]))
    assert m.n_matched == 4 and m.coverage_pct == 100.0
    assert m.mae_mw == 15.0
    assert m.rmse_mw == pytest.approx(math.sqrt(350))
    assert m.bias_mw == -5.0
    assert m.wape_pct == pytest.approx(100 * 60 / 1020)
    assert m.p50_abs_error_mw == 15.0
    assert m.p90_abs_error_mw == pytest.approx(27.0)  # linear: 20 + 0.7 * 10
    assert m.max_abs_error_mw == 30.0
    assert m.forecast_energy_mwh == 1000.0
    assert m.actual_energy_mwh == 1020.0
    assert m.energy_error_mwh == -20.0
    assert m.correlation == pytest.approx(
        np.corrcoef([100, 200, 300, 400], [110, 180, 330, 400])[0, 1]
    )


def test_positive_bias_means_overforecast():
    assert summarize(frame([110, 110], [100, 100])).bias_mw == 10.0


def test_unmatched_rows_are_excluded_and_counted():
    m = summarize(frame([100, np.nan, 300, 400], [110, 200, np.nan, 400]))
    assert m.n_expected == 4
    assert m.n_matched == 2
    assert m.coverage_pct == 50.0
    assert m.n_missing_forecast == 1
    assert m.n_missing_actual == 1
    assert m.mae_mw == 5.0
    assert m.forecast_energy_mwh == 500.0  # matched hours only
    assert m.actual_energy_mwh == 510.0


def test_wape_is_undefined_when_actual_total_is_zero():
    m = summarize(frame([10, 20], [0, 0]))
    assert m.wape_pct is None
    assert m.mae_mw == 15.0


def test_correlation_is_undefined_for_constant_series_or_tiny_samples():
    assert summarize(frame([5, 5, 5], [1, 2, 3])).correlation is None
    assert summarize(frame([1, 2], [1, 2])).correlation is None


def test_empty_input_returns_counts_and_no_statistics():
    m = summarize(frame([], []))
    assert m.n_expected == 0 and m.n_matched == 0
    assert m.coverage_pct is None and m.mae_mw is None and m.wape_pct is None


def test_all_unmatched_returns_no_statistics():
    m = summarize(frame([np.nan, 1.0], [2.0, np.nan]))
    assert m.n_matched == 0 and m.coverage_pct == 0.0 and m.rmse_mw is None


def test_error_histogram_uses_aligned_fixed_width_bins():
    bins = error_histogram(pd.Series([-260.0, -10.0, 0.0, 240.0, np.nan]), bin_width_mw=250)
    assert bins[0]["lower_mw"] == -500 and bins[-1]["upper_mw"] == 250
    assert sum(b["count"] for b in bins) == 4
    assert all(b["upper_mw"] - b["lower_mw"] == 250 for b in bins)


def test_error_histogram_of_nothing_is_empty():
    assert error_histogram(pd.Series([np.nan])) == []
