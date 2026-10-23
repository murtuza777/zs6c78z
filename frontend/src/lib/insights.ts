// Plain-language findings derived only from API data (never hard-coded numbers).

import type { AccuracyResponse, DecisionResponse, VintageAccuracy } from '../api/types';

export function overForecastShare(scatter: AccuracyResponse['scatter']): number | null {
  if (!scatter.length) return null;
  const over = scatter.filter((p) => p.forecast_mw > p.actual_mw).length;
  return (100 * over) / scatter.length;
}

/** Best run usable at the gate vs. the best run overall on D-1 (the value of waiting). */
export function vintageTradeOff(vintages: VintageAccuracy[]): {
  usable: VintageAccuracy;
  best: VintageAccuracy;
  maeReductionPct: number;
} | null {
  const scored = vintages.filter((v) => v.metrics.mae_mw != null);
  const usable = scored
    .filter((v) => v.available_at_gate)
    .sort((a, b) => b.slot.localeCompare(a.slot))[0];
  const best = [...scored].sort((a, b) => a.metrics.mae_mw! - b.metrics.mae_mw!)[0];
  if (!usable || !best || usable.metrics.mae_mw == null || best.metrics.mae_mw == null) return null;
  const maeReductionPct =
    (100 * (usable.metrics.mae_mw - best.metrics.mae_mw)) / usable.metrics.mae_mw;
  return { usable, best, maeReductionPct };
}

export interface DayReading {
  label: string;
  tone: 'over' | 'under' | 'neutral';
}

/** Hindsight characterisation of one delivery day's forecast miss. */
export function readDay(decision: DecisionResponse): DayReading | null {
  const { bias_mw: bias, mae_mw: mae } = decision.hindsight_metrics;
  if (bias == null || mae == null) return null;
  if (Math.abs(bias) < 0.25 * mae) return { label: 'Errors in both directions', tone: 'neutral' };
  return bias > 0
    ? { label: 'Over-forecast: less wind arrived than planned', tone: 'over' }
    : { label: 'Under-forecast: more wind arrived than planned', tone: 'under' };
}
