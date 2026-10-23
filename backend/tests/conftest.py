import math

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.config import get_settings
from app.data.snapshot import write_snapshot
from tests import factories as f

SYNTHETIC_BIAS_MW = 500.0
SLOTS = ["02:30", "04:30", "07:30", "09:30", "11:30", "15:30", "18:30", "22:30"]
MISSING_HALF_HOUR = pd.Timestamp("2026-01-10T12:30", tz="UTC")


def synthetic_actual(t: pd.Timestamp) -> float:
    hours = (t - pd.Timestamp("2026-01-01", tz="UTC")) / pd.Timedelta(hours=1)
    return 8000.0 + 3000.0 * math.sin(hours / 9.0)


@pytest.fixture(scope="session")
def synthetic_snapshot(tmp_path_factory) -> pd.DataFrame:
    """Full January scope; forecasts = true hourly mean + 500 MW; one actual half-hour missing."""
    directory = tmp_path_factory.mktemp("snapshot")
    hh = f.actuals("2026-01-02T00:00", 31 * 48)
    hh["generation_mw"] = [synthetic_actual(t) for t in hh["start_time"]]
    hourly_truth = hh.groupby(hh["start_time"].dt.floor("h"))["generation_mw"].mean()
    actuals = hh.loc[hh["start_time"] != MISSING_HALF_HOUR].reset_index(drop=True)

    frames = []
    for day in pd.date_range("2025-12-31", "2026-01-31", freq="D"):
        for slot in SLOTS:
            run = f.windfor_run(f"{day:%Y-%m-%d}T{slot}")
            run["generation_mw"] = run["start_time"].map(hourly_truth) + SYNTHETIC_BIAS_MW
            frames.append(run.dropna())
    forecasts = f.runs(*frames)
    write_snapshot(
        directory,
        actuals,
        forecasts,
        {
            "scope": {},
            "validation": {
                "actuals": {
                    "expected_periods": 31 * 48,
                    "missing_periods": [MISSING_HALF_HOUR.strftime("%Y-%m-%dT%H:%M:%SZ")],
                }
            },
        },
    )
    return directory


@pytest.fixture
def client(synthetic_snapshot, monkeypatch):
    from app.main import create_app

    monkeypatch.setenv("WINDDESK_SNAPSHOT_DIR", str(synthetic_snapshot))
    monkeypatch.setenv("WINDDESK_LOG_JSON", "false")
    get_settings.cache_clear()
    deps.reset_service()
    with TestClient(create_app()) as test_client:
        yield test_client
    deps.reset_service()
    get_settings.cache_clear()
