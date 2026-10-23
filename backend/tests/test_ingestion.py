"""Validation, Elexon client retry behaviour and snapshot round-trip."""

import json
from datetime import date

import httpx
import pytest

from app.data.elexon_client import ElexonClient, ElexonError
from app.data.snapshot import MANIFEST_FILE, SnapshotError, load_snapshot, write_snapshot
from app.data.validation import DataValidationError, clean_actuals, clean_forecasts
from app.domain.market import ingestion_window

WINDOW = ingestion_window(date(2026, 1, 1), date(2026, 1, 1))  # delivery day 2026-01-02


def actual_row(start: str, gen=1000, sp=None, fuel="WIND", publish=None):
    hh, mm = int(start[11:13]), int(start[14:16])
    return {
        "dataset": "FUELHH",
        "startTime": start,
        "settlementDate": start[:10],
        "settlementPeriod": sp or hh * 2 + mm // 30 + 1,
        "fuelType": fuel,
        "generation": gen,
        "publishTime": publish or start,
    }


def day_of_actuals(day="2026-01-02"):
    return [actual_row(f"{day}T{h:02d}:{m:02d}:00Z") for h in range(24) for m in (0, 30)]


def forecast_row(publish: str, start: str, gen=1000):
    return {"dataset": "WINDFOR", "publishTime": publish, "startTime": start, "generation": gen}


def test_clean_actuals_accepts_a_complete_day():
    frame, report = clean_actuals(day_of_actuals(), WINDOW)
    assert len(frame) == 48
    assert report["missing_periods"] == []
    assert report["settlement_period_mismatches"] == 0
    assert str(frame["start_time"].dt.tz) == "UTC"


def test_clean_actuals_reports_gaps_without_filling_them():
    rows = [r for r in day_of_actuals() if r["startTime"] != "2026-01-02T10:00:00Z"]
    frame, report = clean_actuals(rows, WINDOW)
    assert len(frame) == 47
    assert report["missing_periods"] == ["2026-01-02T10:00:00Z"]


def test_clean_actuals_filters_fuel_and_resolves_duplicates():
    rows = day_of_actuals()
    rows.append(actual_row("2026-01-02T00:00:00Z", fuel="CCGT"))
    rows.append(actual_row("2026-01-02T00:30:00Z"))  # identical duplicate
    rows.append(actual_row("2026-01-02T01:00:00Z", gen=1234, publish="2026-01-02T03:00:00Z"))
    frame, report = clean_actuals(rows, WINDOW)
    assert report["non_wind_rows_dropped"] == 1
    assert report["duplicate_rows_identical"] == 1
    assert report["duplicate_rows_conflicting"] == 1
    kept = frame.loc[frame["start_time"] == "2026-01-02T01:00:00Z", "generation_mw"]
    assert kept.tolist() == [1234.0]  # latest revision wins


def test_clean_actuals_drops_and_counts_non_numeric_generation():
    rows = day_of_actuals()
    rows[3]["generation"] = "n/a"
    _, report = clean_actuals(rows, WINDOW)
    assert report["invalid_generation_rows_dropped"] == 1
    assert len(report["missing_periods"]) == 1


def test_clean_actuals_rejects_missing_fields_and_bad_timestamps():
    with pytest.raises(DataValidationError, match="missing required fields"):
        clean_actuals([{"startTime": "2026-01-02T00:00:00Z"}], WINDOW)
    rows = day_of_actuals()
    rows[0]["startTime"] = "yesterday"
    with pytest.raises(DataValidationError, match="parse"):
        clean_actuals(rows, WINDOW)
    with pytest.raises(DataValidationError, match="no rows"):
        clean_actuals([], WINDOW)


def test_clean_forecasts_dedupes_and_profiles_runs():
    run = [forecast_row("2026-01-01T09:30:00Z", f"2026-01-02T{h:02d}:00:00Z") for h in range(24)]
    off_hour = forecast_row("2026-01-01T09:30:00Z", "2026-01-02T05:30:00Z")
    outside = forecast_row("2026-01-01T09:30:00Z", "2026-01-03T00:00:00Z")
    frame, report = clean_forecasts([*run, run[0], off_hour, outside], WINDOW)
    assert len(frame) == 24
    assert report["duplicate_rows_identical"] == 1
    assert report["off_hour_target_rows_dropped"] == 1
    assert report["out_of_window_rows_dropped"] == 1
    assert report["runs"] == 1
    assert report["target_resolution_minutes"] == [60]
    assert report["target_hours_without_any_run"] == []


def _client(handler, retries=2) -> ElexonClient:
    return ElexonClient(
        "https://example.test/api",
        max_retries=retries,
        backoff_s=0,
        transport=httpx.MockTransport(handler),
    )


def test_client_retries_transient_errors_then_succeeds():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] < 3 else httpx.Response(200, json=[{"a": 1}])

    with _client(handler) as client:
        assert client.get_rows("/x", {}) == [{"a": 1}]
    assert calls["n"] == 3


def test_client_gives_up_after_max_retries():
    with (
        _client(lambda r: httpx.Response(503), retries=1) as client,
        pytest.raises(ElexonError, match="HTTP 503"),
    ):
        client.get_rows("/x", {})


def test_client_fails_fast_on_client_errors_and_bad_payloads():
    with (
        _client(lambda r: httpx.Response(400, text="bad date")) as client,
        pytest.raises(ElexonError, match="HTTP 400"),
    ):
        client.get_rows("/x", {})
    with (
        _client(lambda r: httpx.Response(200, json={"data": []})) as client,
        pytest.raises(ElexonError, match="JSON array"),
    ):
        client.get_rows("/x", {})


def test_client_retries_timeouts():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with _client(handler, retries=1) as client, pytest.raises(ElexonError, match="network"):
        client.get_rows("/x", {})


def test_snapshot_round_trip_and_tamper_detection(tmp_path):
    actuals, _ = clean_actuals(day_of_actuals(), WINDOW)
    forecasts, _ = clean_forecasts(
        [forecast_row("2026-01-01T09:30:00Z", f"2026-01-02T{h:02d}:00:00Z") for h in range(24)],
        WINDOW,
    )
    manifest = write_snapshot(tmp_path, actuals, forecasts, {"scope": {}})
    snapshot = load_snapshot(tmp_path)
    assert snapshot.version == manifest["snapshot_version"]
    assert len(snapshot.actuals) == 48 and len(snapshot.forecasts) == 24
    assert snapshot.actuals["start_time"].equals(actuals["start_time"])

    again = write_snapshot(tmp_path / "again", actuals, forecasts, {"scope": {}})
    assert again["files"] == manifest["files"]  # byte-identical output for identical input

    (tmp_path / "forecasts_wind.csv.gz").write_bytes(b"tampered")
    with pytest.raises(SnapshotError, match="Checksum"):
        load_snapshot(tmp_path)


def test_missing_snapshot_has_actionable_error(tmp_path):
    with pytest.raises(SnapshotError, match="ingest"):
        load_snapshot(tmp_path)
    (tmp_path / MANIFEST_FILE).write_text(json.dumps({"schema_version": 99}))
    with pytest.raises(SnapshotError, match="schema"):
        load_snapshot(tmp_path)
