from datetime import date, time

from app.domain import reports
from app.domain.alignment import hourly_actuals
from app.domain.market import decision_context
from tests import factories as f
from tests.factories import ts


def january_runs():
    # Runs on the 13th-16th at 07:30 / 09:30 / 11:30, except the 15th's 11:30 run came at 12:25.
    return f.runs(
        f.windfor_run("2026-01-15T07:30", 730),
        f.windfor_run("2026-01-15T09:30", 930),
        f.windfor_run("2026-01-15T12:25", 1130),  # late 11:30 run
        f.windfor_run("2026-01-16T09:30", 999),  # published on the delivery day itself
        f.windfor_run("2026-01-14T09:30", 500),  # D-2 run: covers delivery day only until 20:00
        *(
            f.windfor_run(f"2026-01-{d}T{t}", 1)
            for d, t in [
                ("13", "07:30"),
                ("13", "09:30"),
                ("13", "11:30"),
                ("14", "07:30"),
                ("14", "11:30"),
                ("16", "07:30"),
                ("16", "11:30"),
            ]
        ),
    )


def test_align_decision_uses_only_pre_gate_forecasts():
    hourly = hourly_actuals(f.actuals("2026-01-16T00:00", 48, 900))
    ctx = decision_context(date(2026, 1, 15), time(9, 50))
    aligned = reports.align_decision(january_runs(), hourly, ctx)
    assert len(aligned) == 24
    assert (aligned["publish_time"] == ts("2026-01-15T09:30")).all()
    assert (aligned["error_mw"] == 30).all()
    assert (aligned["delivery_date"] == date(2026, 1, 16)).all()


def test_scheduled_slots_ignore_one_off_late_runs_and_assign_them_to_their_slot():
    slots = reports.scheduled_publish_slots(january_runs())
    assert slots == [time(7, 30), time(9, 30), time(11, 30)]
    assert reports.slot_for(time(12, 25), slots) == (time(11, 30), False)
    assert reports.slot_for(time(9, 30), slots) == (time(9, 30), True)


def test_vintage_comparison_flags_availability_at_gate():
    hourly = hourly_actuals(f.actuals("2026-01-16T00:00", 48, 900))
    rows = reports.vintage_comparison(january_runs(), hourly, [date(2026, 1, 16)], time(9, 50))
    by_slot = {r["slot"]: r for r in rows}
    assert by_slot["09:30"]["available_at_gate"] is True
    assert by_slot["11:30"]["available_at_gate"] is False
    assert by_slot["11:30"]["n_runs_off_schedule"] == 1
    assert by_slot["11:30"]["metrics"].bias_mw == 230  # the 12:25 run, value 1130 vs 900
    assert by_slot["07:30"]["metrics"].mae_mw == 170


def test_revision_history_lists_pre_delivery_runs_with_availability():
    ctx = decision_context(date(2026, 1, 15), time(9, 50))
    history = reports.revision_history(january_runs(), ctx)
    published = [h["publish_time"] for h in history]
    assert ts("2026-01-16T09:30").to_pydatetime() not in published  # after delivery start
    flags = {h["publish_time"].strftime("%m-%d %H:%M"): h["available_at_decision"] for h in history}
    assert flags["01-15 09:30"] is True
    assert flags["01-15 12:25"] is False
    assert flags["01-14 09:30"] is True
    partial = next(h for h in history if h["publish_time"].strftime("%m-%d %H:%M") == "01-14 09:30")
    assert partial["n_points"] == 22  # D-2 run stops at 20:00 on delivery day


def test_unchanged_since_detects_repeated_runs():
    forecasts = f.runs(
        f.windfor_run("2026-01-14T22:30", 800),
        f.windfor_run("2026-01-15T02:30", 900),
        f.windfor_run("2026-01-15T07:30", 900),
        f.windfor_run("2026-01-15T09:30", 900),
    )
    ctx = decision_context(date(2026, 1, 15), time(9, 50))
    since, repeated = reports.unchanged_since(forecasts, ts("2026-01-15T09:30"), ctx)
    assert since == ts("2026-01-15T02:30")
    assert repeated == 2


def test_unchanged_since_is_the_run_itself_when_values_changed():
    forecasts = f.runs(f.windfor_run("2026-01-15T07:30", 1), f.windfor_run("2026-01-15T09:30", 2))
    ctx = decision_context(date(2026, 1, 15), time(9, 50))
    assert reports.unchanged_since(forecasts, ts("2026-01-15T09:30"), ctx) == (
        ts("2026-01-15T09:30"),
        0,
    )


def test_horizon_view_never_uses_forecasts_newer_than_target_minus_h():
    hourly = hourly_actuals(f.actuals("2026-01-16T00:00", 48, 900))
    view = reports.horizon_view(january_runs(), hourly, date(2026, 1, 16), date(2026, 1, 16), 20)
    lead = (view.index.to_series() - view["publish_time"]).dt.total_seconds() / 3600
    assert (lead.dropna() >= 20).all()
    assert len(view) == 24


def test_vintage_availability_follows_actual_publish_times_of_late_runs():
    hourly = hourly_actuals(f.actuals("2026-01-16T00:00", 48, 900))
    rows = reports.vintage_comparison(january_runs(), hourly, [date(2026, 1, 16)], time(12, 0))
    late_slot = {r["slot"]: r for r in rows}["11:30"]
    assert late_slot["latest_publish_uk"] == "12:25"
    assert late_slot["available_at_gate"] is False  # the 12:25 run was not out by 12:00
    rows = reports.vintage_comparison(january_runs(), hourly, [date(2026, 1, 16)], time(12, 30))
    assert {r["slot"]: r for r in rows}["11:30"]["available_at_gate"] is True
