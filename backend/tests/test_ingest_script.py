"""End-to-end ingestion safety: completeness gate, atomic publish, reproducibility."""

from datetime import date

import pytest

from app.data.elexon_client import ElexonError
from app.data.snapshot import load_snapshot
from scripts.ingest import IncompleteDataError, run
from tests.test_ingestion import day_of_actuals, forecast_row

ONE_DAY = (date(2026, 1, 1), date(2026, 1, 1))  # one decision -> delivery 2026-01-02


class FakeClient:
    def __init__(self, actuals=None, forecasts=None, fail=False):
        self.actuals = day_of_actuals() if actuals is None else actuals
        self.forecasts = (
            [forecast_row("2026-01-01T09:30:00Z", f"2026-01-02T{h:02d}:00:00Z") for h in range(24)]
            if forecasts is None
            else forecasts
        )
        self.fail = fail

    def fetch_fuelhh_wind(self, settlement_from, settlement_to):
        if self.fail:
            raise ElexonError("upstream down")
        return self.actuals

    def fetch_windfor(self, publish_from, publish_to):
        return self.forecasts


def snapshot_bytes(directory):
    return {p.name: p.read_bytes() for p in sorted(directory.iterdir())}


def no_staging_left(parent):
    return not [p for p in parent.iterdir() if p.name.startswith(".")]


def test_complete_data_is_published_and_loadable(tmp_path):
    out = tmp_path / "snapshot"
    manifest = run(out, client=FakeClient(), decision_range=ONE_DAY)
    snapshot = load_snapshot(out)
    assert snapshot.version == manifest["snapshot_version"]
    assert manifest["scope"]["decision_dates"] == ["2026-01-01", "2026-01-01"]
    assert manifest["validation"]["incomplete_accepted"] == []
    assert no_staging_left(tmp_path)


def test_incomplete_data_never_replaces_a_valid_snapshot(tmp_path):
    out = tmp_path / "snapshot"
    run(out, client=FakeClient(), decision_range=ONE_DAY)
    before = snapshot_bytes(out)

    gappy = [r for r in day_of_actuals() if r["startTime"] != "2026-01-02T10:00:00Z"]
    with pytest.raises(IncompleteDataError, match="1 missing actual half-hours"):
        run(out, client=FakeClient(actuals=gappy), decision_range=ONE_DAY)
    no_runs = [
        forecast_row("2026-01-01T09:30:00Z", f"2026-01-02T{h:02d}:00:00Z") for h in range(20)
    ]
    with pytest.raises(IncompleteDataError, match="4 delivery hours with no forecast run"):
        run(out, client=FakeClient(forecasts=no_runs), decision_range=ONE_DAY)

    assert snapshot_bytes(out) == before
    assert no_staging_left(tmp_path)


def test_incomplete_data_can_be_accepted_explicitly_and_is_recorded(tmp_path):
    out = tmp_path / "snapshot"
    gappy = [r for r in day_of_actuals() if r["startTime"] != "2026-01-02T10:00:00Z"]
    manifest = run(
        out, client=FakeClient(actuals=gappy), decision_range=ONE_DAY, allow_incomplete=True
    )
    assert manifest["validation"]["incomplete_accepted"] == ["1 missing actual half-hours"]
    assert manifest["validation"]["actuals"]["missing_periods"] == ["2026-01-02T10:00:00Z"]
    assert len(load_snapshot(out).actuals) == 47


def test_upstream_failure_leaves_the_existing_snapshot_untouched(tmp_path):
    out = tmp_path / "snapshot"
    run(out, client=FakeClient(), decision_range=ONE_DAY)
    before = snapshot_bytes(out)
    with pytest.raises(ElexonError):
        run(out, client=FakeClient(fail=True), decision_range=ONE_DAY)
    assert snapshot_bytes(out) == before


def test_same_input_produces_the_same_snapshot_version(tmp_path):
    first = run(tmp_path / "a", client=FakeClient(), decision_range=ONE_DAY)
    second = run(tmp_path / "b", client=FakeClient(), decision_range=ONE_DAY)
    assert first["snapshot_version"] == second["snapshot_version"]
    assert first["files"] == second["files"]
