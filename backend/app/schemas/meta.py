from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.common import SnapshotInfo


class GatePresetOut(BaseModel):
    id: str
    label: str
    gate: str
    description: str
    source: str
    source_url: str
    verified_on: date


class DataCoverage(BaseModel):
    actual_half_hours: int
    actual_half_hours_expected: int
    missing_actual_periods: list[str]
    forecast_rows: int
    forecast_runs: int
    first_publish_time: datetime
    last_publish_time: datetime
    off_schedule_runs: list[datetime]


class BandSettings(BaseModel):
    lower_quantile: float
    upper_quantile: float
    bucket_h: float
    min_obs: int
    min_days: int
    min_energy_days: int
    method: str
    energy_method: str


class MetaResponse(BaseModel):
    decision_date_min: date
    decision_date_max: date
    delivery_date_min: date
    delivery_date_max: date
    default_gate: str
    gate_presets: list[GatePresetOut]
    publish_slots_uk: list[str]
    horizon_h_max: float
    horizon_bucket_h: float
    band: BandSettings
    timezone: str
    units: dict[str, str]
    error_convention: str
    coverage: DataCoverage
    snapshot: SnapshotInfo


class HealthResponse(BaseModel):
    status: str
    snapshot_version: str
    build: str = Field(description="Fingerprint of the backend code serving this response")
    actual_rows: int
    forecast_rows: int
