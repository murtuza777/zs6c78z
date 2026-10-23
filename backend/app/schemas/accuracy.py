from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.common import GateInfo, HalfHourActual, MetricsOut, SnapshotInfo


class DailyAccuracy(BaseModel):
    decision_date: date
    delivery_date: date
    publish_times: list[datetime]
    metrics: MetricsOut


class HourAccuracy(BaseModel):
    hour: int = Field(description="UK local hour of day (start of hour)")
    label: str
    metrics: MetricsOut


class HorizonAccuracy(BaseModel):
    bucket_h: float = Field(description="Lower bound of the 6 h lead-time bucket")
    label: str
    metrics: MetricsOut


class VintageAccuracy(BaseModel):
    slot: str = Field(description="Scheduled UK-local publication slot on D-1, HH:MM")
    publish_day: str
    available_at_gate: bool
    n_days: int
    n_runs_off_schedule: int = Field(description="Late runs assigned to this slot")
    metrics: MetricsOut


class HistogramBin(BaseModel):
    lower_mw: float
    upper_mw: float
    count: int


class ScatterPoint(BaseModel):
    start_time: datetime
    forecast_mw: float
    actual_mw: float


class BucketCoverage(BaseModel):
    bucket_h: float
    label: str
    n_evaluated: int
    coverage_pct: float


class BandCoverage(BaseModel):
    available: bool
    n_evaluated: int
    coverage_pct: float | None
    nominal_pct: float
    method: str
    by_bucket: list[BucketCoverage]


class AccuracyResponse(BaseModel):
    from_date: date = Field(description="First decision date (inclusive)")
    to_date: date = Field(description="Last decision date (inclusive)")
    gate: GateInfo
    summary: MetricsOut
    daily: list[DailyAccuracy]
    by_hour: list[HourAccuracy]
    by_horizon: list[HorizonAccuracy]
    by_vintage: list[VintageAccuracy]
    histogram: list[HistogramBin]
    histogram_bin_width_mw: float
    scatter: list[ScatterPoint]
    worst_days: list[DailyAccuracy]
    band_coverage: BandCoverage
    snapshot: SnapshotInfo


class HorizonRow(BaseModel):
    start_time: datetime
    forecast_mw: float | None
    publish_time: datetime | None
    horizon_h: float | None
    actual_mw: float | None
    actual_status: str
    error_mw: float | None


class HorizonResponse(BaseModel):
    from_date: date = Field(description="First delivery date (inclusive)")
    to_date: date = Field(description="Last delivery date (inclusive)")
    horizon_h: float
    rule: str
    metrics: MetricsOut
    rows: list[HorizonRow]
    actuals_half_hourly: list[HalfHourActual]
    snapshot: SnapshotInfo
