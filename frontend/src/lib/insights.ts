// Plain-language findings derived only from API data (never hard-coded numbers).

import type { AccuracyResponse, TimelinePoint } from '../api/types';

const HOUR_MS = 3_600_000;

/** Share of matched hours that were over- vs under-forecast (exact hits count in neither). */
export function errorDirection(
  scatter: AccuracyResponse['scatter'],
): { overPct: number; underPct: number } | null {
  if (!scatter.length) return null;
  const over = scatter.filter((p) => p.forecast_mw > p.actual_mw).length;
  const under = scatter.filter((p) => p.forecast_mw < p.actual_mw).length;
  return { overPct: (100 * over) / scatter.length, underPct: (100 * under) / scatter.length };
}

/** Shortest and longest lead time (h) of the forecasts actually selected at the gate. */
export function gateLeadRange(points: TimelinePoint[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (!p.publish_time) continue;
    const lead = (Date.parse(p.start_time) - Date.parse(p.publish_time)) / HOUR_MS;
    lo = Math.min(lo, lead);
    hi = Math.max(hi, lead);
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}
