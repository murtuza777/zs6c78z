"""Shared response models. All timestamps are UTC (serialised with a trailing ``Z``)."""

from datetime import datetime

from pydantic import BaseModel, Field


class MetricsOut(BaseModel):
    """Accuracy statistics over matched hourly observations (``error = forecast - actual``)."""

    n_expected: int = Field(description="Hourly slots in scope")
    n_matched: int = Field(description="Slots with both a selected forecast and a complete actual")
    coverage_pct: float | None = Field(description="n_matched / n_expected, %")
    n_missing_forecast: int
    n_missing_actual: int
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None = Field(description="Mean signed error; positive = over-forecast")
    wape_pct: float | None = Field(description="sum|error| / sum(actual), %; null if sum is 0")
    p50_abs_error_mw: float | None
    p90_abs_error_mw: float | None
    p95_abs_error_mw: float | None
    p99_abs_error_mw: float | None
    max_abs_error_mw: float | None
    correlation: float | None = Field(description="Pearson r; null if undefined")
    forecast_energy_mwh: float | None = Field(description="Sum over matched hours of MW x 1 h")
    actual_energy_mwh: float | None
    energy_error_mwh: float | None


class SnapshotInfo(BaseModel):
    version: str
    created_at: datetime


class GateInfo(BaseModel):
    gate: str = Field(description="Gate-closure wall-clock time, UK local, HH:MM")
    preset_id: str | None = Field(description="Matching preset, if any")
    preset_label: str | None


class HalfHourActual(BaseModel):
    start_time: datetime
    generation_mw: float
    settlement_period: int


class Problem(BaseModel):
    """RFC 9457 problem details."""

    type: str
    title: str
    status: int
    detail: str
    instance: str | None = None
    errors: list[dict] | None = None
