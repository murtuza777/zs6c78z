"""Report building blocks composed from the pure selection, alignment and metric functions."""

from collections.abc import Iterable
from datetime import date, time, timedelta

import pandas as pd

from app.domain.alignment import (
    align,
    genuine_predictions,
    select_at_horizon,
    select_latest_at_cutoff,
)
from app.domain.market import (
    UK_TZ,
    DecisionContext,
    decision_context,
    hourly_slots,
    local_day_bounds_utc,
)
from app.domain.metrics import Metrics, summarize
from app.domain.uncertainty import bucket_label, horizon_bucket


def align_decision(
    forecasts: pd.DataFrame, hourly: pd.DataFrame, ctx: DecisionContext
) -> pd.DataFrame:
    selected = select_latest_at_cutoff(
        forecasts, ctx.cutoff_utc, ctx.delivery_start_utc, ctx.delivery_end_utc
    )
    frame = align(hourly_slots(ctx.delivery_date), selected, hourly)
    frame.insert(0, "decision_date", ctx.decision_date)
    frame.insert(1, "delivery_date", ctx.delivery_date)
    return frame


def align_decisions(
    forecasts: pd.DataFrame, hourly: pd.DataFrame, dates: Iterable[date], gate: time
) -> pd.DataFrame:
    frames = [align_decision(forecasts, hourly, decision_context(d, gate)) for d in dates]
    return pd.concat(frames) if frames else pd.DataFrame()


def local_hour(index: pd.DatetimeIndex) -> pd.Series:
    return pd.Series(index.tz_convert(UK_TZ).hour, index=index)


def daily_breakdown(aligned: pd.DataFrame) -> list[dict[str, object]]:
    out = []
    for delivery, frame in aligned.groupby("delivery_date", sort=True):
        publish_times = sorted(frame["publish_time"].dropna().unique())
        out.append(
            {
                "decision_date": frame["decision_date"].iloc[0],
                "delivery_date": delivery,
                "publish_times": [pd.Timestamp(t).to_pydatetime() for t in publish_times],
                "metrics": summarize(frame),
            }
        )
    return out


def hour_of_day_breakdown(aligned: pd.DataFrame) -> list[tuple[int, Metrics]]:
    hours = local_hour(pd.DatetimeIndex(aligned.index))
    return [(int(h), summarize(g)) for h, g in aligned.groupby(hours.to_numpy(), sort=True)]


def horizon_breakdown(aligned: pd.DataFrame) -> list[tuple[float, str, Metrics]]:
    with_forecast = aligned.loc[aligned["horizon_h"].notna()]
    buckets = horizon_bucket(with_forecast["horizon_h"])
    return [
        (float(b), bucket_label(float(b)), summarize(g))
        for b, g in with_forecast.groupby(buckets.to_numpy(), sort=True)
    ]


def worst_days(daily: list[dict[str, object]], n: int = 5) -> list[dict[str, object]]:
    ranked = [d for d in daily if d["metrics"].mae_mw is not None]  # type: ignore[union-attr]
    ranked.sort(key=lambda d: d["metrics"].mae_mw, reverse=True)  # type: ignore[union-attr]
    return ranked[:n]


def scheduled_publish_slots(forecasts: pd.DataFrame, min_share: float = 0.5) -> list[time]:
    """UK-local publication times that occur on at least ``min_share`` of days with runs."""
    runs = pd.DatetimeIndex(forecasts["publish_time"].drop_duplicates()).tz_convert(UK_TZ)
    n_days = len(set(runs.date))
    counts = pd.Series(runs.strftime("%H:%M")).value_counts()
    slots = [s for s, c in counts.items() if n_days and c / n_days >= min_share]
    return sorted(time.fromisoformat(s) for s in slots)


def slot_for(publish_local: time, slots: list[time]) -> tuple[time, bool]:
    """Assign a run to the latest scheduled slot at or before it (late runs fill their slot)."""
    earlier = [s for s in slots if s <= publish_local]
    if not earlier:
        return publish_local, False
    slot = earlier[-1]
    return slot, slot == publish_local


def vintage_comparison(
    forecasts: pd.DataFrame, hourly: pd.DataFrame, delivery_dates: Iterable[date], gate: time
) -> list[dict[str, object]]:
    """Accuracy of each D-1 publication slot for delivery day D, across the given days.

    Every run published on D-1 is scored against all hourly slots of D, so a run that omits a
    target hour counts as a missing forecast rather than silently shrinking the sample.
    """
    deliveries = sorted(set(delivery_dates))
    slots = scheduled_publish_slots(forecasts)
    genuine = genuine_predictions(forecasts)
    expected = (
        pd.concat(
            [pd.DataFrame({"delivery_date": d, "start_time": hourly_slots(d)}) for d in deliveries]
        )
        if deliveries
        else pd.DataFrame()
    )
    if expected.empty:
        return []

    publish_times = pd.DatetimeIndex(genuine["publish_time"].drop_duplicates())
    runs = pd.DataFrame(
        {
            "publish_time": publish_times,
            "delivery_date": [d + timedelta(days=1) for d in publish_times.tz_convert(UK_TZ).date],
        }
    )
    runs = runs.loc[runs["delivery_date"].isin(deliveries)]
    if runs.empty:
        return []
    assigned = [
        slot_for(t, slots) for t in pd.DatetimeIndex(runs["publish_time"]).tz_convert(UK_TZ).time
    ]
    runs["slot"] = [s for s, _ in assigned]
    runs["on_schedule"] = [o for _, o in assigned]

    combined = (
        runs.merge(expected, on="delivery_date")
        .merge(
            genuine.rename(columns={"generation_mw": "forecast_mw"}),
            on=["publish_time", "start_time"],
            how="left",
        )
        .merge(hourly[["actual_mw"]], left_on="start_time", right_index=True, how="left")
    )
    out = []
    for slot, frame in combined.groupby("slot", sort=True):
        out.append(
            {
                "slot": slot.strftime("%H:%M"),
                "publish_day": "D-1",
                "available_at_gate": slot <= gate,
                "n_days": int(frame["delivery_date"].nunique()),
                "n_runs_off_schedule": int(
                    (~frame.drop_duplicates("publish_time")["on_schedule"]).sum()
                ),
                "metrics": summarize(frame),
            }
        )
    return out


def revision_history(forecasts: pd.DataFrame, ctx: DecisionContext) -> list[dict[str, object]]:
    """Every run published before delivery starts that predicts at least one delivery hour."""
    genuine = genuine_predictions(forecasts)
    runs = genuine.loc[
        (genuine["start_time"] >= ctx.delivery_start_utc)
        & (genuine["start_time"] < ctx.delivery_end_utc)
        & (genuine["publish_time"] < ctx.delivery_start_utc)
    ]
    out = []
    for publish_time, run in runs.groupby("publish_time", sort=True):
        run = run.sort_values("start_time")
        out.append(
            {
                "publish_time": pd.Timestamp(publish_time).to_pydatetime(),
                "available_at_decision": bool(publish_time <= ctx.cutoff_utc),
                "n_points": len(run),
                "energy_mwh": float(run["generation_mw"].sum()),
                "points": [
                    {"start_time": t.to_pydatetime(), "forecast_mw": float(v)}
                    for t, v in zip(run["start_time"], run["generation_mw"], strict=True)
                ],
            }
        )
    return out


def horizon_view(
    forecasts: pd.DataFrame, hourly: pd.DataFrame, from_date: date, to_date: date, horizon_h: float
) -> pd.DataFrame:
    start, _ = local_day_bounds_utc(from_date)
    _, end = local_day_bounds_utc(to_date)
    slots = pd.date_range(start, end, freq="h", inclusive="left", name="start_time")
    selected = select_at_horizon(forecasts, start, end, horizon_h)
    return align(slots, selected, hourly)
