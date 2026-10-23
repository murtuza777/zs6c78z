from datetime import date, time

import pandas as pd
import pytest

from app.domain.market import (
    NonexistentLocalTimeError,
    decision_context,
    hourly_slots,
    ingestion_window,
    local_day_bounds_utc,
    local_to_utc,
    parse_gate,
)
from tests.factories import ts


@pytest.mark.parametrize(
    "value,expected",
    [
        ("09:50", time(9, 50)),
        ("00:00", time(0, 0)),
        ("23:59", time(23, 59)),
        (" 15:30 ", time(15, 30)),
    ],
)
def test_parse_gate_accepts_hh_mm(value, expected):
    assert parse_gate(value) == expected


@pytest.mark.parametrize("value", ["9:50", "24:00", "09:60", "0950", "09:50:00", "ab:cd", ""])
def test_parse_gate_rejects_invalid(value):
    with pytest.raises(ValueError, match="HH:MM"):
        parse_gate(value)


def test_winter_decision_cutoff_and_delivery_window_are_utc():
    ctx = decision_context(date(2026, 1, 15), time(9, 50))
    assert ctx.delivery_date == date(2026, 1, 16)
    assert ctx.cutoff_utc == ts("2026-01-15T09:50")  # GMT == UTC
    assert ctx.delivery_start_utc == ts("2026-01-16T00:00")
    assert ctx.delivery_end_utc == ts("2026-01-17T00:00")


def test_summer_decision_cutoff_converts_from_bst():
    ctx = decision_context(date(2026, 7, 1), time(9, 50))
    assert ctx.cutoff_utc == ts("2026-07-01T08:50")
    assert ctx.delivery_start_utc == ts("2026-07-01T23:00")
    assert ctx.delivery_end_utc == ts("2026-07-02T23:00")


def test_spring_forward_delivery_day_has_23_hours():
    start, end = local_day_bounds_utc(date(2026, 3, 29))
    assert (end - start) == pd.Timedelta(hours=23)
    assert len(hourly_slots(date(2026, 3, 29))) == 23


def test_autumn_fall_back_delivery_day_has_25_hours():
    assert len(hourly_slots(date(2026, 10, 25))) == 25


def test_ambiguous_local_time_resolves_to_first_occurrence():
    # 01:30 happens twice on 2026-10-25; the first (BST) occurrence is 00:30 UTC.
    assert pd.Timestamp(local_to_utc(date(2026, 10, 25), time(1, 30))) == ts("2026-10-25T00:30")


def test_nonexistent_local_time_raises():
    with pytest.raises(NonexistentLocalTimeError):
        local_to_utc(date(2026, 3, 29), time(1, 30))


def test_ingestion_window_covers_exactly_the_january_decisions():
    window = ingestion_window()
    assert window.delivery_start_date == date(2026, 1, 2)
    assert window.delivery_end_date == date(2026, 2, 1)
    assert window.delivery_start_utc == ts("2026-01-02T00:00")
    assert window.delivery_end_utc == ts("2026-02-02T00:00")
    assert window.publish_from_utc == ts("2025-12-30T00:00")
    assert window.publish_to_utc == ts("2026-02-01T00:00")
