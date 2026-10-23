"""Small builders for synthetic actuals / forecast runs used across tests."""

from collections.abc import Callable

import pandas as pd

from app.domain.market import UK_TZ


def ts(value: str) -> pd.Timestamp:
    return pd.Timestamp(value, tz="UTC")


def actuals(
    start: str,
    periods: int,
    value: float | Callable[[int], float] = 1000.0,
    skip: set[int] | None = None,
) -> pd.DataFrame:
    """Half-hourly WIND actuals starting at ``start`` (UTC). ``skip`` drops period indexes."""
    times = pd.date_range(ts(start), periods=periods, freq="30min")
    rows = []
    for i, t in enumerate(times):
        if skip and i in skip:
            continue
        local = t.tz_convert(UK_TZ)
        midnight = local.normalize().tz_convert("UTC")
        rows.append(
            {
                "start_time": t,
                "settlement_date": local.strftime("%Y-%m-%d"),
                "settlement_period": int((t - midnight) / pd.Timedelta(minutes=30)) + 1,
                "generation_mw": float(value(i) if callable(value) else value),
                "publish_time": t + pd.Timedelta(minutes=30),
            }
        )
    return pd.DataFrame(rows)


def run(
    publish: str, first_target: str, hours: int, value: float | Callable[[int], float] = 1000.0
) -> pd.DataFrame:
    """One WINDFOR run: hourly targets from ``first_target`` published at ``publish``."""
    targets = pd.date_range(ts(first_target), periods=hours, freq="h")
    return pd.DataFrame(
        {
            "publish_time": ts(publish),
            "start_time": targets,
            "generation_mw": [float(value(i) if callable(value) else value) for i in range(hours)],
        }
    )


def windfor_run(publish: str, value: float | Callable[[int], float] = 1000.0) -> pd.DataFrame:
    """A run shaped like the live API: 73 hourly targets from 21:00 the day before publication."""
    first = (ts(publish).normalize() - pd.Timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M")
    return run(publish, first, 73, value)


def runs(*frames: pd.DataFrame) -> pd.DataFrame:
    return pd.concat(frames, ignore_index=True)
