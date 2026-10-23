"""HTTP contract tests against a synthetic snapshot with known answers."""

import pytest

from app.schemas.accuracy import AccuracyResponse, HorizonResponse
from app.schemas.decisions import DecisionResponse
from app.schemas.meta import MetaResponse
from tests.conftest import SYNTHETIC_BIAS_MW

PROBLEM = "application/problem+json"


def test_health_is_not_cached(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]


def test_meta_describes_scope_presets_and_schedule(client):
    body = MetaResponse.model_validate(client.get("/api/v1/meta").json())
    assert str(body.decision_date_min) == "2026-01-01"
    assert str(body.delivery_date_max) == "2026-02-01"
    assert {p.id for p in body.gate_presets} == {"n2ex", "epex-60", "epex-30"}
    assert body.publish_slots_uk == [
        "02:30",
        "04:30",
        "07:30",
        "09:30",
        "11:30",
        "15:30",
        "18:30",
        "22:30",
    ]
    assert body.coverage.missing_actual_periods == ["2026-01-10T12:30:00Z"]


def test_decision_selects_latest_pre_gate_forecast(client):
    response = client.get("/api/v1/decisions/2026-01-15", params={"gate": "09:50"})
    assert response.status_code == 200
    body = DecisionResponse.model_validate(response.json())
    assert str(body.delivery_date) == "2026-01-16"
    assert body.cutoff_utc.isoformat() == "2026-01-15T09:50:00+00:00"
    assert body.gate.preset_id == "n2ex"
    assert len(body.rows) == 24
    assert all(r.publish_time <= body.cutoff_utc for r in body.rows)
    assert body.forecast.primary_publish_time.isoformat() == "2026-01-15T09:30:00+00:00"
    assert body.forecast.horizon_min_h == 14.5
    assert body.hindsight_metrics.bias_mw == pytest.approx(SYNTHETIC_BIAS_MW)
    assert body.typical_error.n_days == 30  # leave-one-day-out
    assert body.band.available
    assert any(r.available_at_decision is False for r in body.revisions)
    assert sum(r.is_selected for r in body.revisions) == 1
    assert body.data_quality.hours_with_complete_actual == 24
    assert len(body.actuals_half_hourly) == 48


def test_decision_gate_changes_the_selected_run(client):
    late = client.get("/api/v1/decisions/2026-01-15", params={"gate": "15:30"}).json()
    early = client.get("/api/v1/decisions/2026-01-15", params={"gate": "09:29"}).json()
    assert late["forecast"]["primary_publish_time"] == "2026-01-15T15:30:00Z"
    assert early["forecast"]["primary_publish_time"] == "2026-01-15T07:30:00Z"
    assert late["gate"]["preset_id"] == "epex-30" and early["gate"]["preset_id"] is None


def test_decision_reports_partial_actual_hour_without_imputing(client):
    body = client.get("/api/v1/decisions/2026-01-09").json()
    noon = next(r for r in body["rows"] if r["start_time"] == "2026-01-10T12:00:00Z")
    assert noon["actual_status"] == "partial"
    assert noon["actual_mw"] is None and noon["error_mw"] is None
    assert body["data_quality"]["incomplete_actual_hours"] == ["2026-01-10T12:00:00Z"]
    assert body["hindsight_metrics"]["n_matched"] == 23


def test_accuracy_contract_and_known_answers(client):
    response = client.get("/api/v1/accuracy", params={"gate": "09:50"})
    assert response.status_code == 200
    body = AccuracyResponse.model_validate(response.json())
    assert body.summary.n_expected == 31 * 24
    assert body.summary.n_missing_actual == 1
    assert body.summary.bias_mw == pytest.approx(SYNTHETIC_BIAS_MW)
    assert body.summary.mae_mw == pytest.approx(SYNTHETIC_BIAS_MW)
    assert len(body.daily) == 31 and len(body.worst_days) == 5
    assert [h.hour for h in body.by_hour] == list(range(24))
    assert {v.slot for v in body.by_vintage} >= {"07:30", "09:30", "15:30"}
    assert {v.slot: v.available_at_gate for v in body.by_vintage}["11:30"] is False
    assert sum(b.count for b in body.histogram) == body.summary.n_matched
    assert len(body.scatter) == body.summary.n_matched
    assert body.band_coverage.available


def test_accuracy_subrange(client):
    body = client.get("/api/v1/accuracy", params={"from": "2026-01-05", "to": "2026-01-07"}).json()
    assert body["summary"]["n_expected"] == 72
    assert [d["delivery_date"] for d in body["daily"]] == ["2026-01-06", "2026-01-07", "2026-01-08"]


def test_horizon_respects_minimum_lead_time(client):
    response = client.get(
        "/api/v1/horizon", params={"from": "2026-01-10", "to": "2026-01-11", "horizon_h": 30}
    )
    body = HorizonResponse.model_validate(response.json())
    assert len(body.rows) == 48
    assert all(r.horizon_h >= 30 for r in body.rows if r.horizon_h is not None)
    assert body.metrics.bias_mw == pytest.approx(SYNTHETIC_BIAS_MW)


@pytest.mark.parametrize(
    "url,field",
    [
        ("/api/v1/decisions/2026-02-01", "decision_date"),
        ("/api/v1/decisions/2025-12-31", "decision_date"),
        ("/api/v1/decisions/2026-01-15?gate=25:00", "gate"),
        ("/api/v1/decisions/2026-01-15?gate=0950", "gate"),
        ("/api/v1/accuracy?from=2026-01-20&to=2026-01-10", "from"),
        ("/api/v1/accuracy?from=2026-03-01", "from"),
        ("/api/v1/horizon?from=2026-01-01&to=2026-01-05", "from"),
        ("/api/v1/horizon?from=2026-01-05&to=2026-01-02", "from"),
    ],
)
def test_out_of_scope_parameters_return_problem_json(client, url, field):
    response = client.get(url)
    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM
    body = response.json()
    assert body["status"] == 422 and body["detail"]
    assert body["errors"][0]["loc"][-1] == field


@pytest.mark.parametrize(
    "url",
    [
        "/api/v1/decisions/not-a-date",
        "/api/v1/horizon?from=2026-01-05&to=2026-01-06&horizon_h=60",
        "/api/v1/horizon?from=2026-01-05&to=2026-01-06&horizon_h=-1",
        "/api/v1/horizon?to=2026-01-06",
    ],
)
def test_malformed_parameters_return_problem_json(client, url):
    response = client.get(url)
    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM
    assert response.json()["title"] == "Invalid request parameters"


def test_unknown_route_is_problem_json_404(client):
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM


def test_historical_responses_are_cacheable_with_etag(client):
    first = client.get("/api/v1/decisions/2026-01-15")
    assert "s-maxage" in first.headers["cache-control"]
    etag = first.headers["etag"]
    second = client.get("/api/v1/decisions/2026-01-15", headers={"If-None-Match": etag})
    assert second.status_code == 304
    other = client.get("/api/v1/decisions/2026-01-16")
    assert other.headers["etag"] != etag


def test_openapi_documents_all_routes(client):
    paths = client.get("/api/openapi.json").json()["paths"]
    assert {
        "/api/v1/health",
        "/api/v1/meta",
        "/api/v1/decisions/{decision_date}",
        "/api/v1/accuracy",
        "/api/v1/horizon",
    } <= set(paths)


def test_decision_separates_known_at_gate_error_from_pilot_calibration(client):
    mid = client.get("/api/v1/decisions/2026-01-15").json()
    assert mid["typical_error"]["n_days"] == 30
    assert mid["typical_error_known_at_gate"]["n_days"] == 13  # deliveries 2..14 Jan
    assert "Includes days after this decision" in mid["typical_error"]["basis"]
    first = client.get("/api/v1/decisions/2026-01-01").json()
    assert first["typical_error_known_at_gate"]["n_days"] == 0
    assert first["typical_error_known_at_gate"]["mae_mw"] is None


def test_daily_energy_band_uses_daily_errors_and_needs_full_coverage(client):
    body = client.get("/api/v1/decisions/2026-01-15").json()["forecast"]
    assert body["hours_expected"] == 24 and body["energy_band_n_days"] >= 10
    assert body["band_p10_energy_gwh"] <= body["band_p90_energy_gwh"]
    # Gate 00:00 on 1 Jan: only Dec 31 runs exist, which stop at 21:00 on the delivery day.
    partial = client.get("/api/v1/decisions/2026-01-01", params={"gate": "00:00"}).json()
    assert partial["forecast"]["hours_with_forecast"] == 22
    assert partial["forecast"]["band_p10_energy_gwh"] is None
    assert partial["data_quality"]["missing_forecast_hours"] == [
        "2026-01-02T22:00:00Z",
        "2026-01-02T23:00:00Z",
    ]


def test_accuracy_reports_daily_energy_band_coverage(client):
    coverage = client.get("/api/v1/accuracy").json()["band_coverage"]
    assert coverage["daily_energy"]["n_days"] >= 10
    assert coverage["daily_energy"]["coverage_pct"] is not None


def test_meta_exposes_band_settings_used_by_the_methodology_page(client):
    band = client.get("/api/v1/meta").json()["band"]
    assert band == {
        **band,
        "min_obs": 48,
        "min_days": 10,
        "lower_quantile": 0.1,
        "upper_quantile": 0.9,
    }


def test_caches_stay_bounded_under_many_custom_gates(client):
    from app.api.deps import get_service

    for minute in range(40):
        assert (
            client.get("/api/v1/accuracy", params={"gate": f"10:{minute:02d}"}).status_code == 200
        )
    service = get_service()
    assert len(service._aligned) <= 16 and len(service._coverage) <= 64
