from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import GateInfo, HalfHourActual, MetricsOut, SnapshotInfo

ActualStatus = Literal["complete", "partial", "missing"]


class DecisionRow(BaseModel):
    start_time: datetime
    end_time: datetime
    forecast_mw: float | None
    publish_time: datetime | None = Field(description="Publication time of the selected forecast")
    horizon_h: float | None = Field(description="Hours from publication to target start")
    horizon_bucket: str | None
    actual_mw: float | None = Field(description="Mean of the two half-hourly actuals in the hour")
    actual_first_half_mw: float | None = Field(description="Sensitivity: first half-hour only")
    actual_half_hours: int
    actual_status: ActualStatus
    error_mw: float | None = Field(description="forecast - actual; positive = over-forecast")
    band_p10_mw: float | None
    band_p90_mw: float | None


class ForecastSummary(BaseModel):
    primary_publish_time: datetime
    publish_times: list[datetime]
    horizon_min_h: float
    horizon_max_h: float
    hours_with_forecast: int
    hours_expected: int
    energy_gwh: float = Field(description="Forecast energy over the hours that have a forecast")
    peak_mw: float
    peak_time: datetime
    min_mw: float
    min_time: datetime
    band_p10_energy_gwh: float | None = Field(
        description="Empirical P10 of delivery-day energy (daily-error quantiles, LODO)"
    )
    band_p90_energy_gwh: float | None
    energy_band_n_days: int
    energy_band_method: str
    unchanged_since: datetime = Field(
        description="Earliest run whose delivery-day values the selected run repeats exactly"
    )
    repeated_runs: int = Field(description="Earlier consecutive runs with identical values")


class TypicalError(BaseModel):
    mae_mw: float | None
    p90_abs_error_mw: float | None
    bias_mw: float | None
    n_obs: int
    n_days: int
    horizon_buckets: list[str]
    basis: str


class BandInfo(BaseModel):
    available: bool
    nominal_coverage_pct: float
    method: str
    reason: str | None


class RevisionPoint(BaseModel):
    start_time: datetime
    forecast_mw: float


class Revision(BaseModel):
    publish_time: datetime
    available_at_decision: bool
    is_selected: bool
    n_points: int
    energy_mwh: float
    points: list[RevisionPoint]


class DataQuality(BaseModel):
    expected_hours: int
    hours_with_forecast: int
    hours_with_complete_actual: int
    expected_half_hours: int
    half_hours_present: int
    missing_forecast_hours: list[datetime]
    incomplete_actual_hours: list[datetime]


class DecisionResponse(BaseModel):
    decision_date: date
    delivery_date: date
    gate: GateInfo
    cutoff_utc: datetime
    delivery_start_utc: datetime
    delivery_end_utc: datetime
    forecast: ForecastSummary | None
    typical_error: TypicalError = Field(description="Pilot calibration over all other days")
    typical_error_known_at_gate: TypicalError = Field(
        description="Only delivery days completed before the decision day"
    )
    band: BandInfo
    hindsight_metrics: MetricsOut
    rows: list[DecisionRow]
    actuals_half_hourly: list[HalfHourActual]
    revisions: list[Revision]
    data_quality: DataQuality
    snapshot: SnapshotInfo
