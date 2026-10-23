import { describe, expect, it } from 'vitest';

import type { DecisionRow } from '../api/types';
import { parsePlanInputs, planProcurement, shortfallText } from './procurement';

const row = (h: number, forecast: number | null, p10: number | null, actual: number | null) =>
  ({
    start_time: `2026-01-16T${String(h).padStart(2, '0')}:00:00Z`,
    forecast_mw: forecast,
    band_p10_mw: p10,
    actual_mw: actual,
  }) as DecisionRow;

describe('planProcurement', () => {
  it('buys demand minus wind, per hour, with hand-computed totals', () => {
    // demand 10,000 MW; wind 6,000 / 12,000 MW; P10 4,000 / 9,000; actual 5,000 / 8,000
    const plan = planProcurement(
      [row(0, 6000, 4000, 5000), row(1, 12000, 9000, 8000)],
      10_000,
      100,
    );
    expect(plan.hours.map((h) => h.buy_forecast_mw)).toEqual([4000, 0]); // never negative
    expect(plan.hours.map((h) => h.buy_low_wind_mw)).toEqual([6000, 1000]);
    expect(plan.forecastGwh).toBeCloseTo(4);
    expect(plan.lowWindGwh).toBeCloseTo(7);
    expect(plan.uncertaintyCoverGwh).toBeCloseTo(3);
    expect(plan.peakLowWindMw).toEqual({ mw: 6000, start_time: '2026-01-16T00:00:00Z' });
    // hindsight: need 5,000 + 2,000 = 7 GWh
    expect(plan.actualNeedGwh).toBeCloseTo(7);
    expect(plan.shortfallForecastGwh).toBeCloseTo(3); // bought too little
    expect(plan.shortfallLowWindGwh).toBeCloseTo(0);
  });

  it('scales wind by the share the desk can count on', () => {
    const plan = planProcurement([row(0, 10_000, 8000, null)], 5000, 25);
    expect(plan.hours[0]!.buy_forecast_mw).toBe(2500); // 5,000 − 25% × 10,000
    expect(plan.hours[0]!.buy_low_wind_mw).toBe(3000);
    expect(plan.actualNeedGwh).toBeNull();
  });

  it('only plans hours with a forecast and flags an incomplete low-wind total', () => {
    const plan = planProcurement([row(0, 6000, null, 5000), row(1, null, null, 5000)], 10_000, 100);
    expect(plan.plannedHours).toBe(1);
    expect(plan.forecastGwh).toBeCloseTo(4);
    expect(plan.lowWindComplete).toBe(false);
    expect(plan.lowWindGwh).toBeNull();
    expect(plan.shortfallLowWindGwh).toBeNull();
    expect(plan.actualNeedGwh).toBeCloseTo(5); // hour 1 has no plan, so it is not judged
  });
});

describe('parsePlanInputs', () => {
  it('accepts sensible values and rejects the rest', () => {
    expect(parsePlanInputs('30000', '40')).toEqual({ demandMw: 30000, sharePct: 40 });
    expect(parsePlanInputs(null, null)).toEqual({ demandMw: null, sharePct: 100 });
    expect(parsePlanInputs('-5', '0')).toEqual({ demandMw: null, sharePct: 100 });
    expect(parsePlanInputs('abc', '250')).toEqual({ demandMw: null, sharePct: 100 });
    expect(parsePlanInputs('200000', '')).toEqual({ demandMw: null, sharePct: 100 });
  });
});

describe('shortfallText', () => {
  it('describes the balance against actual need in words', () => {
    expect(shortfallText(12.34)).toBe('short by 12.3 GWh');
    expect(shortfallText(-2)).toBe('over-bought by 2.0 GWh');
    expect(shortfallText(0.01)).toBe('on target');
    expect(shortfallText(null)).toBe('—');
  });
});
