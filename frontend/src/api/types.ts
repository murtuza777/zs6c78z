// Mirrors backend/app/schemas. Timestamps are ISO-8601 UTC strings; dates are YYYY-MM-DD.

export type Iso = string;

export interface Metrics {
  n_expected: number;
  n_matched: number;
  coverage_pct: number | null;
  n_missing_forecast: number;
  n_missing_actual: number;
  mae_mw: number | null;
  rmse_mw: number | null;
  bias_mw: number | null;
  wape_pct: number | null;
  p50_abs_error_mw: number | null;
  p90_abs_error_mw: number | null;
  p95_abs_error_mw: number | null;
  p99_abs_error_mw: number | null;
  max_abs_error_mw: number | null;
  correlation: number | null;
  forecast_energy_mwh: number | null;
  actual_energy_mwh: number | null;
  energy_error_mwh: number | null;
}

export interface SnapshotInfo {
  version: string;
  created_at: Iso;
}

export interface GateInfo {
  gate: string;
  preset_id: string | null;
  preset_label: string | null;
}

export interface HalfHourActual {
  start_time: Iso;
  generation_mw: number;
  settlement_period: number;
}

export type ActualStatus = 'complete' | 'partial' | 'missing';

export interface DecisionRow {
  start_time: Iso;
  end_time: Iso;
  forecast_mw: number | null;
  publish_time: Iso | null;
  horizon_h: number | null;
  horizon_bucket: string | null;
  actual_mw: number | null;
  actual_first_half_mw: number | null;
  actual_half_hours: number;
  actual_status: ActualStatus;
  error_mw: number | null;
  band_p10_mw: number | null;
  band_p90_mw: number | null;
}

export interface ForecastSummary {
  primary_publish_time: Iso;
  publish_times: Iso[];
  horizon_min_h: number;
  horizon_max_h: number;
  hours_with_forecast: number;
  energy_gwh: number;
  peak_mw: number;
  peak_time: Iso;
  min_mw: number;
  min_time: Iso;
  band_p10_energy_gwh: number | null;
  band_p90_energy_gwh: number | null;
}

export interface TypicalError {
  mae_mw: number | null;
  p90_abs_error_mw: number | null;
  bias_mw: number | null;
  n_obs: number;
  n_days: number;
  horizon_buckets: string[];
  basis: string;
}

export interface BandInfo {
  available: boolean;
  nominal_coverage_pct: number;
  method: string;
  reason: string | null;
}

export interface Revision {
  publish_time: Iso;
  available_at_decision: boolean;
  is_selected: boolean;
  n_points: number;
  energy_mwh: number;
  points: { start_time: Iso; forecast_mw: number }[];
}

export interface DataQuality {
  expected_hours: number;
  hours_with_forecast: number;
  hours_with_complete_actual: number;
  expected_half_hours: number;
  half_hours_present: number;
  missing_forecast_hours: Iso[];
  incomplete_actual_hours: Iso[];
}

export interface DecisionResponse {
  decision_date: string;
  delivery_date: string;
  gate: GateInfo;
  cutoff_utc: Iso;
  delivery_start_utc: Iso;
  delivery_end_utc: Iso;
  forecast: ForecastSummary | null;
  typical_error: TypicalError;
  band: BandInfo;
  hindsight_metrics: Metrics;
  rows: DecisionRow[];
  actuals_half_hourly: HalfHourActual[];
  revisions: Revision[];
  data_quality: DataQuality;
  snapshot: SnapshotInfo;
}

export interface DailyAccuracy {
  decision_date: string;
  delivery_date: string;
  publish_times: Iso[];
  metrics: Metrics;
}

export interface GroupAccuracy {
  label: string;
  metrics: Metrics;
}

export interface VintageAccuracy {
  slot: string;
  publish_day: string;
  available_at_gate: boolean;
  n_days: number;
  n_runs_off_schedule: number;
  metrics: Metrics;
}

export interface HistogramBin {
  lower_mw: number;
  upper_mw: number;
  count: number;
}

export interface ScatterPoint {
  start_time: Iso;
  forecast_mw: number;
  actual_mw: number;
}

export interface BandCoverage {
  available: boolean;
  n_evaluated: number;
  coverage_pct: number | null;
  nominal_pct: number;
  method: string;
  by_bucket: { bucket_h: number; label: string; n_evaluated: number; coverage_pct: number }[];
}

export interface AccuracyResponse {
  from_date: string;
  to_date: string;
  gate: GateInfo;
  summary: Metrics;
  daily: DailyAccuracy[];
  by_hour: (GroupAccuracy & { hour: number })[];
  by_horizon: (GroupAccuracy & { bucket_h: number })[];
  by_vintage: VintageAccuracy[];
  histogram: HistogramBin[];
  histogram_bin_width_mw: number;
  scatter: ScatterPoint[];
  worst_days: DailyAccuracy[];
  band_coverage: BandCoverage;
  snapshot: SnapshotInfo;
}

export interface HorizonRow {
  start_time: Iso;
  forecast_mw: number | null;
  publish_time: Iso | null;
  horizon_h: number | null;
  actual_mw: number | null;
  actual_status: ActualStatus;
  error_mw: number | null;
}

export interface HorizonResponse {
  from_date: string;
  to_date: string;
  horizon_h: number;
  rule: string;
  metrics: Metrics;
  rows: HorizonRow[];
  actuals_half_hourly: HalfHourActual[];
  snapshot: SnapshotInfo;
}

export interface GatePreset {
  id: string;
  label: string;
  gate: string;
  description: string;
  source: string;
  source_url: string;
  verified_on: string;
}

export interface MetaResponse {
  decision_date_min: string;
  decision_date_max: string;
  delivery_date_min: string;
  delivery_date_max: string;
  default_gate: string;
  gate_presets: GatePreset[];
  publish_slots_uk: string[];
  horizon_h_max: number;
  horizon_bucket_h: number;
  timezone: string;
  units: Record<string, string>;
  error_convention: string;
  coverage: {
    actual_half_hours: number;
    actual_half_hours_expected: number;
    missing_actual_periods: string[];
    forecast_rows: number;
    forecast_runs: number;
    first_publish_time: Iso;
    last_publish_time: Iso;
    off_schedule_runs: Iso[];
  };
  snapshot: SnapshotInfo;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}
