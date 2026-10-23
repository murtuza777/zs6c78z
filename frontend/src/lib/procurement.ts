// Procurement what-if: how much power to buy beyond wind for a user-entered demand.
// WindDesk has no demand, contract or price data, so demand (flat MW) and the share of national
// wind the desk can count on are inputs. Pure functions; every number traces to API rows.

import type { DecisionRow } from '../api/types';
import { fmtGWh } from './format';

export const DEMAND_MAX_MW = 100_000;

export interface ProcurementHour {
  start_time: string;
  /** Buy if wind arrives as forecast: max(0, demand − share × forecast). */
  buy_forecast_mw: number | null;
  /** Buy to cover the low-wind case: max(0, demand − share × hourly P10). */
  buy_low_wind_mw: number | null;
  /** Hindsight: max(0, demand − share × actual). */
  need_actual_mw: number | null;
}

export interface ProcurementPlan {
  demandMw: number;
  sharePct: number;
  hours: ProcurementHour[];
  /** Hours with a forecast, the ones the plan covers. */
  plannedHours: number;
  /** True when every planned hour also has a P10 band, so the low-wind total is complete. */
  lowWindComplete: boolean;
  forecastGwh: number;
  lowWindGwh: number | null;
  /** Extra energy bought to cover the low-wind case. */
  uncertaintyCoverGwh: number | null;
  peakForecastMw: { mw: number; start_time: string } | null;
  peakLowWindMw: { mw: number; start_time: string } | null;
  /** Hindsight over planned hours that have a complete actual. */
  actualNeedGwh: number | null;
  /** Actual need − plan (positive = bought too little, the rest had to be found later). */
  shortfallForecastGwh: number | null;
  shortfallLowWindGwh: number | null;
}

const buy = (demand: number, wind: number | null, share: number) =>
  wind == null ? null : Math.max(0, demand - share * wind);

function peak(hours: ProcurementHour[], key: 'buy_forecast_mw' | 'buy_low_wind_mw') {
  let best: { mw: number; start_time: string } | null = null;
  for (const h of hours) {
    const v = h[key];
    if (v != null && (best == null || v > best.mw)) best = { mw: v, start_time: h.start_time };
  }
  return best;
}

export function planProcurement(
  rows: DecisionRow[],
  demandMw: number,
  sharePct: number,
): ProcurementPlan {
  const share = sharePct / 100;
  const hours: ProcurementHour[] = rows.map((r) => ({
    start_time: r.start_time,
    buy_forecast_mw: buy(demandMw, r.forecast_mw, share),
    buy_low_wind_mw: r.forecast_mw == null ? null : buy(demandMw, r.band_p10_mw, share),
    need_actual_mw: buy(demandMw, r.actual_mw, share),
  }));
  const planned = hours.filter((h) => h.buy_forecast_mw != null);
  const lowWindComplete = planned.length > 0 && planned.every((h) => h.buy_low_wind_mw != null);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0) / 1000; // MWh -> GWh

  const forecastGwh = sum(planned.map((h) => h.buy_forecast_mw!));
  const lowWindGwh = lowWindComplete ? sum(planned.map((h) => h.buy_low_wind_mw!)) : null;

  // Hindsight compares like with like: only planned hours that have a complete actual.
  const judged = planned.filter((h) => h.need_actual_mw != null);
  const actualNeedGwh = judged.length ? sum(judged.map((h) => h.need_actual_mw!)) : null;
  const shortfallForecastGwh =
    actualNeedGwh == null ? null : actualNeedGwh - sum(judged.map((h) => h.buy_forecast_mw!));
  const shortfallLowWindGwh =
    actualNeedGwh == null || !lowWindComplete
      ? null
      : actualNeedGwh - sum(judged.map((h) => h.buy_low_wind_mw!));

  return {
    demandMw,
    sharePct,
    hours,
    plannedHours: planned.length,
    lowWindComplete,
    forecastGwh,
    lowWindGwh,
    uncertaintyCoverGwh: lowWindGwh == null ? null : lowWindGwh - forecastGwh,
    peakForecastMw: peak(planned, 'buy_forecast_mw'),
    peakLowWindMw: lowWindComplete ? peak(planned, 'buy_low_wind_mw') : null,
    actualNeedGwh,
    shortfallForecastGwh,
    shortfallLowWindGwh,
  };
}

/** Validated what-if inputs from URL params (null demand = what-if not set). */
export function parsePlanInputs(demand: string | null, share: string | null) {
  const d = demand == null || demand.trim() === '' ? NaN : Number(demand);
  const s = share == null || share.trim() === '' ? 100 : Number(share);
  return {
    demandMw: Number.isFinite(d) && d > 0 && d <= DEMAND_MAX_MW ? d : null,
    sharePct: Number.isFinite(s) && s > 0 && s <= 100 ? s : 100,
  };
}

/** Signed balance of a plan against what was actually needed, in words. */
export function shortfallText(gwh: number | null): string {
  if (gwh == null) return '—';
  if (Math.abs(gwh) < 0.05) return 'on target';
  return gwh > 0 ? `short by ${fmtGWh(gwh)}` : `over-bought by ${fmtGWh(-gwh)}`;
}
