"""Application service: snapshot-backed analytics with per-gate memoisation.

The snapshot is immutable, so selections/alignments are computed once per gate and reused.
Cached frames are never mutated; callers take copies before adding columns.
"""

import math
import threading
from datetime import date, time, timedelta
from typing import Any

import pandas as pd

from app.data.snapshot import Snapshot
from app.domain import reports
from app.domain.alignment import hourly_actuals
from app.domain.market import (
    DECISION_END,
    DECISION_START,
    DEFAULT_GATE,
    GATE_PRESETS,
    UK_TZ,
    decision_context,
    decision_dates,
    format_gate,
    preset_for,
)
from app.domain.metrics import Metrics, error_histogram, summarize
from app.domain.uncertainty import (
    BUCKET_WIDTH_H,
    METHOD,
    MIN_DAYS,
    MIN_OBS,
    NOMINAL_COVERAGE_PCT,
    apply_band,
    bucket_label,
    error_pool,
    evaluate_coverage,
    horizon_bucket,
    quantile_table,
)

HORIZON_H_MAX = 48.0
HISTOGRAM_BIN_MW = 250.0
MAX_HORIZON_RANGE_DAYS = 31


class RequestError(ValueError):
    """A syntactically valid request that is outside the supported scope."""

    def __init__(self, detail: str, field: str | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.field = field


def _clean(value: Any) -> Any:
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "item"):  # numpy scalar
        return _clean(value.item())
    return value


def _metrics(m: Metrics) -> dict[str, Any]:
    return m.to_dict()


def _gate_info(gate: time) -> dict[str, Any]:
    preset = preset_for(gate)
    return {
        "gate": format_gate(gate),
        "preset_id": preset.id if preset else None,
        "preset_label": preset.label if preset else None,
    }


class AnalyticsService:
    def __init__(self, snapshot: Snapshot) -> None:
        self.snapshot = snapshot
        self.actuals = snapshot.actuals
        self.forecasts = snapshot.forecasts
        self.hourly = hourly_actuals(snapshot.actuals)
        self.delivery_min = DECISION_START + timedelta(days=1)
        self.delivery_max = DECISION_END + timedelta(days=1)
        self._lock = threading.Lock()
        self._aligned: dict[time, pd.DataFrame] = {}
        self._pools: dict[time, pd.DataFrame] = {}
        self._vintages: dict[tuple[date, date], list[dict[str, Any]]] = {}
        self._coverage: dict[tuple[date, date, time], dict[str, Any]] = {}

    # ----------------------------------------------------------------- caches
    @property
    def snapshot_info(self) -> dict[str, Any]:
        manifest = self.snapshot.manifest
        return {"version": self.snapshot.version, "created_at": manifest["created_at"]}

    def aligned_for_gate(self, gate: time) -> pd.DataFrame:
        with self._lock:
            if gate not in self._aligned:
                self._aligned[gate] = reports.align_decisions(
                    self.forecasts, self.hourly, decision_dates(), gate
                )
            return self._aligned[gate]

    def pool_for_gate(self, gate: time) -> pd.DataFrame:
        aligned = self.aligned_for_gate(gate)
        with self._lock:
            if gate not in self._pools:
                self._pools[gate] = error_pool(aligned)
            return self._pools[gate]

    def _vintage_rows(self, from_date: date, to_date: date) -> list[dict[str, Any]]:
        key = (from_date, to_date)
        with self._lock:
            if key not in self._vintages:
                deliveries = [d + timedelta(days=1) for d in decision_dates(from_date, to_date)]
                self._vintages[key] = reports.vintage_comparison(
                    self.forecasts, self.hourly, deliveries, time(23, 59)
                )
            return self._vintages[key]

    def _coverage_for(
        self, from_date: date, to_date: date, gate: time, aligned: pd.DataFrame
    ) -> dict[str, Any]:
        key = (from_date, to_date, gate)
        pool = self.pool_for_gate(gate)
        with self._lock:
            if key not in self._coverage:
                self._coverage[key] = evaluate_coverage(aligned, pool)
            return self._coverage[key]

    # ------------------------------------------------------------- validation
    def _check_decision_date(self, value: date, field: str) -> None:
        if not DECISION_START <= value <= DECISION_END:
            raise RequestError(
                f"{field} must be a decision date between {DECISION_START} and {DECISION_END}",
                field,
            )

    # ---------------------------------------------------------------- decision
    def decision(self, decision_date: date, gate: time) -> dict[str, Any]:
        self._check_decision_date(decision_date, "decision_date")
        ctx = decision_context(decision_date, gate)
        aligned = self.aligned_for_gate(gate)
        day = aligned.loc[aligned["delivery_date"] == ctx.delivery_date].copy()
        pool = self.pool_for_gate(gate)
        table = quantile_table(pool, exclude_day=ctx.delivery_date)
        day = day.join(apply_band(day, table))
        day["horizon_bucket"] = horizon_bucket(day["horizon_h"])

        rows = [
            {
                "start_time": start.to_pydatetime(),
                "end_time": (start + pd.Timedelta(hours=1)).to_pydatetime(),
                "forecast_mw": _clean(r.forecast_mw),
                "publish_time": _clean(r.publish_time),
                "horizon_h": _clean(r.horizon_h),
                "horizon_bucket": None
                if pd.isna(r.horizon_bucket)
                else bucket_label(r.horizon_bucket),
                "actual_mw": _clean(r.actual_mw),
                "actual_first_half_mw": _clean(r.actual_first_half_mw),
                "actual_half_hours": int(r.actual_half_hours),
                "actual_status": r.actual_status,
                "error_mw": _clean(r.error_mw),
                "band_p10_mw": _clean(r.band_p10_mw),
                "band_p90_mw": _clean(r.band_p90_mw),
            }
            for start, r in zip(day.index, day.itertuples(index=False), strict=True)
        ]

        with_forecast = day.loc[day["forecast_mw"].notna()]
        forecast_summary = None
        if not with_forecast.empty:
            publish_times = sorted(with_forecast["publish_time"].unique())
            band_complete = with_forecast["band_p10_mw"].notna().all()
            stale_since, repeated_runs = reports.unchanged_since(
                self.forecasts, pd.Timestamp(publish_times[-1]), ctx
            )
            forecast_summary = {
                "primary_publish_time": pd.Timestamp(publish_times[-1]).to_pydatetime(),
                "unchanged_since": stale_since.to_pydatetime(),
                "repeated_runs": repeated_runs,
                "publish_times": [pd.Timestamp(t).to_pydatetime() for t in publish_times],
                "horizon_min_h": float(with_forecast["horizon_h"].min()),
                "horizon_max_h": float(with_forecast["horizon_h"].max()),
                "hours_with_forecast": len(with_forecast),
                "energy_gwh": float(with_forecast["forecast_mw"].sum() / 1000),
                "peak_mw": float(with_forecast["forecast_mw"].max()),
                "peak_time": with_forecast["forecast_mw"].idxmax().to_pydatetime(),
                "min_mw": float(with_forecast["forecast_mw"].min()),
                "min_time": with_forecast["forecast_mw"].idxmin().to_pydatetime(),
                "band_p10_energy_gwh": float(with_forecast["band_p10_mw"].sum() / 1000)
                if band_complete
                else None,
                "band_p90_energy_gwh": float(with_forecast["band_p90_mw"].sum() / 1000)
                if band_complete
                else None,
            }

        day_buckets = sorted(set(day["horizon_bucket"].dropna()))
        other = pool.loc[
            (pool["delivery_date"] != ctx.delivery_date) & pool["bucket"].isin(day_buckets)
        ]
        abs_err = other["error_mw"].abs()
        typical = {
            "mae_mw": _clean(abs_err.mean()) if len(other) else None,
            "p90_abs_error_mw": _clean(abs_err.quantile(0.9)) if len(other) else None,
            "bias_mw": _clean(other["error_mw"].mean()) if len(other) else None,
            "n_obs": len(other),
            "n_days": int(other["delivery_date"].nunique()),
            "horizon_buckets": [bucket_label(b) for b in day_buckets],
            "basis": "All other January delivery days at the same gate and lead-time buckets "
            "(leave-one-day-out).",
        }

        band_available = bool(day["band_p10_mw"].notna().any())
        band = {
            "available": band_available,
            "nominal_coverage_pct": NOMINAL_COVERAGE_PCT,
            "method": METHOD,
            "reason": None
            if band_available
            else (
                "No forecast available at this gate."
                if with_forecast.empty
                else f"Fewer than {MIN_OBS} historical errors or {MIN_DAYS} days at this lead time."
            ),
        }

        half_hours = self.actuals.loc[
            (self.actuals["start_time"] >= ctx.delivery_start_utc)
            & (self.actuals["start_time"] < ctx.delivery_end_utc)
        ]
        selected = {pd.Timestamp(t) for t in day["publish_time"].dropna()}
        revisions = reports.revision_history(self.forecasts, ctx)
        for revision in revisions:
            revision["is_selected"] = pd.Timestamp(revision["publish_time"]) in selected

        return {
            "decision_date": ctx.decision_date,
            "delivery_date": ctx.delivery_date,
            "gate": _gate_info(gate),
            "cutoff_utc": ctx.cutoff_utc.to_pydatetime(),
            "delivery_start_utc": ctx.delivery_start_utc.to_pydatetime(),
            "delivery_end_utc": ctx.delivery_end_utc.to_pydatetime(),
            "forecast": forecast_summary,
            "typical_error": typical,
            "band": band,
            "hindsight_metrics": _metrics(summarize(day)),
            "rows": rows,
            "actuals_half_hourly": [
                {
                    "start_time": t.to_pydatetime(),
                    "generation_mw": float(g),
                    "settlement_period": int(sp),
                }
                for t, g, sp in zip(
                    half_hours["start_time"],
                    half_hours["generation_mw"],
                    half_hours["settlement_period"],
                    strict=True,
                )
            ],
            "revisions": revisions,
            "data_quality": {
                "expected_hours": len(day),
                "hours_with_forecast": len(with_forecast),
                "hours_with_complete_actual": int((day["actual_status"] == "complete").sum()),
                "expected_half_hours": int(
                    (ctx.delivery_end_utc - ctx.delivery_start_utc) / pd.Timedelta(minutes=30)
                ),
                "half_hours_present": len(half_hours),
                "missing_forecast_hours": [
                    t.to_pydatetime() for t in day.index[day["forecast_mw"].isna()]
                ],
                "incomplete_actual_hours": [
                    t.to_pydatetime() for t in day.index[day["actual_status"] != "complete"]
                ],
            },
            "snapshot": self.snapshot_info,
        }

    # ---------------------------------------------------------------- accuracy
    def accuracy(self, from_date: date, to_date: date, gate: time) -> dict[str, Any]:
        self._check_decision_date(from_date, "from")
        self._check_decision_date(to_date, "to")
        if from_date > to_date:
            raise RequestError("from must be on or before to", "from")
        aligned = self.aligned_for_gate(gate)
        sub = aligned.loc[
            (aligned["decision_date"] >= from_date) & (aligned["decision_date"] <= to_date)
        ]

        daily = [
            {**d, "metrics": _metrics(d["metrics"])}  # type: ignore[arg-type]
            for d in reports.daily_breakdown(sub)
        ]
        worst = sorted(
            (d for d in daily if d["metrics"]["mae_mw"] is not None),
            key=lambda d: d["metrics"]["mae_mw"],
            reverse=True,
        )[:5]
        vintages = [
            {
                **v,
                "available_at_gate": time.fromisoformat(v["slot"]) <= gate,
                "metrics": _metrics(v["metrics"]),
            }
            for v in self._vintage_rows(from_date, to_date)
        ]
        matched = sub.loc[sub["error_mw"].notna()]
        coverage = self._coverage_for(from_date, to_date, gate, sub)

        return {
            "from_date": from_date,
            "to_date": to_date,
            "gate": _gate_info(gate),
            "summary": _metrics(summarize(sub)),
            "daily": daily,
            "by_hour": [
                {"hour": h, "label": f"{h:02d}:00", "metrics": _metrics(m)}
                for h, m in reports.hour_of_day_breakdown(sub)
            ],
            "by_horizon": [
                {"bucket_h": b, "label": label, "metrics": _metrics(m)}
                for b, label, m in reports.horizon_breakdown(sub)
            ],
            "by_vintage": vintages,
            "histogram": error_histogram(sub["error_mw"], HISTOGRAM_BIN_MW),
            "histogram_bin_width_mw": HISTOGRAM_BIN_MW,
            "scatter": [
                {"start_time": t.to_pydatetime(), "forecast_mw": float(fc), "actual_mw": float(ac)}
                for t, fc, ac in zip(
                    matched.index, matched["forecast_mw"], matched["actual_mw"], strict=True
                )
            ],
            "worst_days": worst,
            "band_coverage": {**coverage, "method": METHOD},
            "snapshot": self.snapshot_info,
        }

    # ----------------------------------------------------------------- horizon
    def horizon(self, from_date: date, to_date: date, horizon_h: float) -> dict[str, Any]:
        for value, field in ((from_date, "from"), (to_date, "to")):
            if not self.delivery_min <= value <= self.delivery_max:
                raise RequestError(
                    f"{field} must be a delivery date between "
                    f"{self.delivery_min} and {self.delivery_max}",
                    field,
                )
        if from_date > to_date:
            raise RequestError("from must be on or before to", "from")
        if (to_date - from_date).days + 1 > MAX_HORIZON_RANGE_DAYS:
            raise RequestError(f"range must be at most {MAX_HORIZON_RANGE_DAYS} days", "to")
        if not 0 <= horizon_h <= HORIZON_H_MAX:
            raise RequestError(f"horizon_h must be between 0 and {HORIZON_H_MAX:g}", "horizon_h")

        view = reports.horizon_view(self.forecasts, self.hourly, from_date, to_date, horizon_h)
        start, end = view.index.min(), view.index.max() + pd.Timedelta(hours=1)
        half_hours = self.actuals.loc[
            (self.actuals["start_time"] >= start) & (self.actuals["start_time"] < end)
        ]
        return {
            "from_date": from_date,
            "to_date": to_date,
            "horizon_h": horizon_h,
            "rule": f"For each target hour T: latest forecast with publishTime <= "
            f"T - {horizon_h:g} h and publishTime < T.",
            "metrics": _metrics(summarize(view)),
            "rows": [
                {
                    "start_time": t.to_pydatetime(),
                    "forecast_mw": _clean(r.forecast_mw),
                    "publish_time": _clean(r.publish_time),
                    "horizon_h": _clean(r.horizon_h),
                    "actual_mw": _clean(r.actual_mw),
                    "actual_status": r.actual_status,
                    "error_mw": _clean(r.error_mw),
                }
                for t, r in zip(view.index, view.itertuples(index=False), strict=True)
            ],
            "actuals_half_hourly": [
                {
                    "start_time": t.to_pydatetime(),
                    "generation_mw": float(g),
                    "settlement_period": int(sp),
                }
                for t, g, sp in zip(
                    half_hours["start_time"],
                    half_hours["generation_mw"],
                    half_hours["settlement_period"],
                    strict=True,
                )
            ],
            "snapshot": self.snapshot_info,
        }

    # -------------------------------------------------------------------- meta
    def meta(self) -> dict[str, Any]:
        validation = self.snapshot.manifest.get("validation", {})
        actual_report = validation.get("actuals", {})
        slots = reports.scheduled_publish_slots(self.forecasts)
        run_times = pd.DatetimeIndex(self.forecasts["publish_time"].drop_duplicates())
        local_times = run_times.tz_convert(UK_TZ).time
        off_schedule = [
            t.to_pydatetime()
            for t, lt in zip(run_times, local_times, strict=True)
            if lt not in slots
        ]
        return {
            "decision_date_min": DECISION_START,
            "decision_date_max": DECISION_END,
            "delivery_date_min": self.delivery_min,
            "delivery_date_max": self.delivery_max,
            "default_gate": format_gate(DEFAULT_GATE),
            "gate_presets": [
                {
                    "id": p.id,
                    "label": p.label,
                    "gate": format_gate(p.gate),
                    "description": p.description,
                    "source": p.source,
                    "source_url": p.source_url,
                    "verified_on": p.verified_on,
                }
                for p in GATE_PRESETS
            ],
            "publish_slots_uk": [s.strftime("%H:%M") for s in slots],
            "horizon_h_max": HORIZON_H_MAX,
            "horizon_bucket_h": float(BUCKET_WIDTH_H),
            "timezone": "Europe/London",
            "units": {"power": "MW", "energy": "MWh (GWh in summaries)", "time": "ISO-8601 UTC"},
            "error_convention": "error_mw = forecast_mw - actual_mw (positive = over-forecast)",
            "coverage": {
                "actual_half_hours": len(self.actuals),
                "actual_half_hours_expected": int(
                    actual_report.get("expected_periods", len(self.actuals))
                ),
                "missing_actual_periods": list(actual_report.get("missing_periods", [])),
                "forecast_rows": len(self.forecasts),
                "forecast_runs": len(run_times),
                "first_publish_time": run_times.min().to_pydatetime(),
                "last_publish_time": run_times.max().to_pydatetime(),
                "off_schedule_runs": off_schedule,
            },
            "snapshot": self.snapshot_info,
        }

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "snapshot_version": self.snapshot.version,
            "actual_rows": len(self.actuals),
            "forecast_rows": len(self.forecasts),
        }
