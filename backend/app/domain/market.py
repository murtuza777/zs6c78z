"""Market timing: decision scope, gate-closure presets, and UK-local <-> UTC conversion.

All internal timestamps are timezone-aware UTC. Europe/London is used only to interpret
market-local concepts (decision date, gate-closure wall-clock time, delivery day).
"""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

UK_TZ = ZoneInfo("Europe/London")

# Challenge scope: procurement decisions made 1-31 January 2026 (UK local dates).
DECISION_START = date(2026, 1, 1)
DECISION_END = date(2026, 1, 31)

# WINDFOR runs reach ~66.5 h ahead (verified on the live API), so a 72 h look-back before the
# first delivery period captures every run that could have targeted it.
FORECAST_LOOKBACK_H = 72


class NonexistentLocalTimeError(ValueError):
    """Raised when a wall-clock time falls inside the spring-forward DST gap."""


@dataclass(frozen=True)
class GatePreset:
    id: str
    label: str
    gate: time
    description: str
    source: str
    source_url: str
    verified_on: date


GATE_PRESETS: tuple[GatePreset, ...] = (
    GatePreset(
        id="n2ex",
        label="N2EX day-ahead (Nord Pool)",
        gate=time(9, 50),
        description="Nord Pool GB day-ahead auction; gate closure 09:50 UK time, "
        "results by 10:00 UK time.",
        source="Nord Pool support: 'About the Day-ahead GB auction'",
        source_url="https://support.nordpoolgroup.com/support/solutions/articles/"
        "8000088463-about-the-day-ahead-gb-auction",
        verified_on=date(2026, 10, 23),
    ),
    GatePreset(
        id="epex-60",
        label="EPEX GB hourly auction",
        gate=time(9, 20),
        description="EPEX SPOT GB 60-minute day-ahead auction; closes 09:20 UK time "
        "(moved from 11:00 after Brexit, effective trading day 31 Dec 2020).",
        source="EPEX SPOT trading brochure; S&P Global Platts subscriber note (Dec 2020)",
        source_url="https://www.spglobal.com/commodity-insights/en/pricing-benchmarks/"
        "our-methodology/subscriber-notes/120920-platts-to-amend-uk-day-ahead-power-"
        "assessments-timing-from-jan-4",
        verified_on=date(2026, 10, 23),
    ),
    GatePreset(
        id="epex-30",
        label="EPEX GB half-hourly auction",
        gate=time(15, 30),
        description="EPEX SPOT GB 30-minute day-ahead auction held at 15:30 UK time.",
        source="EPEX SPOT trading brochure",
        source_url="https://www.epexspot.com/sites/default/files/2024-07/"
        "Trading%20brochure%20July%202024.pdf",
        verified_on=date(2026, 10, 23),
    ),
)
DEFAULT_GATE = GATE_PRESETS[0].gate

_GATE_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def parse_gate(value: str) -> time:
    """Parse a strict 24-hour ``HH:MM`` gate-closure time."""
    match = _GATE_RE.match(value.strip())
    if not match:
        raise ValueError(f"gate must be a 24-hour HH:MM time, got {value!r}")
    return time(int(match.group(1)), int(match.group(2)))


def format_gate(gate: time) -> str:
    return gate.strftime("%H:%M")


def preset_for(gate: time) -> GatePreset | None:
    return next((p for p in GATE_PRESETS if p.gate == gate), None)


def local_to_utc(day: date, wall_time: time) -> datetime:
    """Convert a UK wall-clock time on ``day`` to an unambiguous UTC instant.

    * Ambiguous times (autumn fall-back hour) resolve to the first occurrence (BST), i.e. the
      earlier instant. For a gate closure this is the conservative choice.
    * Nonexistent times (spring-forward gap) raise ``NonexistentLocalTimeError``.
    """
    naive = datetime.combine(day, wall_time)
    candidate = naive.replace(tzinfo=UK_TZ, fold=0).astimezone(UTC)
    if candidate.astimezone(UK_TZ).replace(tzinfo=None) != naive:
        raise NonexistentLocalTimeError(
            f"{wall_time:%H:%M} does not exist in Europe/London on {day.isoformat()} "
            "(clocks go forward)"
        )
    return candidate


def to_local(ts: datetime | pd.Timestamp) -> datetime:
    return pd.Timestamp(ts).tz_convert(UK_TZ).to_pydatetime()


def local_day_bounds_utc(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC [start, end) of a UK local calendar day. Handles 23 h and 25 h DST days."""
    start = local_to_utc(day, time(0, 0))
    end = local_to_utc(day + timedelta(days=1), time(0, 0))
    return pd.Timestamp(start), pd.Timestamp(end)


def hourly_slots(day: date) -> pd.DatetimeIndex:
    """UTC hour-start timestamps covering a UK local day (UK offsets are whole hours)."""
    start, end = local_day_bounds_utc(day)
    return pd.date_range(start, end, freq="h", inclusive="left", name="start_time")


def half_hour_slots(day: date) -> pd.DatetimeIndex:
    start, end = local_day_bounds_utc(day)
    return pd.date_range(start, end, freq="30min", inclusive="left", name="start_time")


@dataclass(frozen=True)
class DecisionContext:
    decision_date: date
    delivery_date: date
    gate: time
    cutoff_utc: pd.Timestamp
    delivery_start_utc: pd.Timestamp
    delivery_end_utc: pd.Timestamp


def decision_context(decision_date: date, gate: time) -> DecisionContext:
    """A day-ahead decision on D (local) at gate G buys power for delivery day D+1 (local)."""
    delivery = decision_date + timedelta(days=1)
    start, end = local_day_bounds_utc(delivery)
    return DecisionContext(
        decision_date=decision_date,
        delivery_date=delivery,
        gate=gate,
        cutoff_utc=pd.Timestamp(local_to_utc(decision_date, gate)),
        delivery_start_utc=start,
        delivery_end_utc=end,
    )


def decision_dates(start: date = DECISION_START, end: date = DECISION_END) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


@dataclass(frozen=True)
class IngestionWindow:
    delivery_start_date: date
    delivery_end_date: date  # inclusive
    delivery_start_utc: pd.Timestamp
    delivery_end_utc: pd.Timestamp  # exclusive
    publish_from_utc: pd.Timestamp
    publish_to_utc: pd.Timestamp  # inclusive: latest possible January decision cutoff


def ingestion_window(start: date = DECISION_START, end: date = DECISION_END) -> IngestionWindow:
    """The minimal data needed to evaluate every decision made between ``start`` and ``end``.

    * Actuals: every settlement period of every delivery day (D+1 for each decision day D).
    * Forecasts: runs published from 72 h before the first delivery period up to the last
      instant of the last decision day, restricted to delivery-window target times.
    """
    first_delivery = start + timedelta(days=1)
    last_delivery = end + timedelta(days=1)
    delivery_start, _ = local_day_bounds_utc(first_delivery)
    _, delivery_end = local_day_bounds_utc(last_delivery)
    _, last_decision_end = local_day_bounds_utc(end)
    return IngestionWindow(
        delivery_start_date=first_delivery,
        delivery_end_date=last_delivery,
        delivery_start_utc=delivery_start,
        delivery_end_utc=delivery_end,
        publish_from_utc=delivery_start - pd.Timedelta(hours=FORECAST_LOOKBACK_H),
        publish_to_utc=last_decision_end,
    )
