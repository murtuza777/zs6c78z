"""Checks against the committed January 2026 snapshot (the data the deployed app serves)."""

from datetime import time

import pytest

from app.config import BACKEND_DIR
from app.data.snapshot import load_snapshot
from app.domain import reports
from app.domain.alignment import hourly_actuals
from app.domain.market import GATE_PRESETS, decision_context, decision_dates

SNAPSHOT_DIR = BACKEND_DIR / "data" / "snapshot"
pytestmark = pytest.mark.skipif(
    not (SNAPSHOT_DIR / "manifest.json").exists(), reason="snapshot not generated"
)


@pytest.fixture(scope="module")
def snapshot():
    return load_snapshot(SNAPSHOT_DIR)


def test_snapshot_scope_and_integrity(snapshot):
    manifest = snapshot.manifest
    assert manifest["scope"]["decision_dates"] == ["2026-01-01", "2026-01-31"]
    assert manifest["scope"]["delivery_dates"] == ["2026-01-02", "2026-02-01"]
    assert snapshot.actuals["start_time"].is_monotonic_increasing
    assert snapshot.actuals["generation_mw"].ge(0).all()
    assert (
        len(snapshot.actuals) + len(manifest["validation"]["actuals"]["missing_periods"])
        == manifest["validation"]["actuals"]["expected_periods"]
    )


@pytest.mark.parametrize("gate", [time(h, m) for h in range(0, 24, 2) for m in (0, 25, 50)])
def test_no_selected_forecast_is_published_after_the_cutoff(snapshot, gate):
    """Look-ahead guard: for every January decision and many gates, publish <= cutoff < target."""
    hourly = hourly_actuals(snapshot.actuals)
    for day in decision_dates():
        ctx = decision_context(day, gate)
        aligned = reports.align_decision(snapshot.forecasts, hourly, ctx)
        selected = aligned.dropna(subset=["publish_time"])
        assert (selected["publish_time"] <= ctx.cutoff_utc).all()
        assert (selected.index > selected["publish_time"]).all()
        assert (selected.index >= ctx.delivery_start_utc).all()
        assert (selected.index < ctx.delivery_end_utc).all()


@pytest.mark.parametrize("preset", GATE_PRESETS, ids=lambda p: p.id)
def test_every_january_decision_is_fully_matched_at_preset_gates(snapshot, preset):
    hourly = hourly_actuals(snapshot.actuals)
    aligned = reports.align_decisions(snapshot.forecasts, hourly, decision_dates(), preset.gate)
    assert len(aligned) == 31 * 24
    assert aligned["error_mw"].notna().all()
