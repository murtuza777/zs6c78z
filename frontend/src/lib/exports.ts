// CSV exports built from the same API rows the tables and charts render.

import type { DecisionResponse } from '../api/types';
import { toCsv } from './csv';
import { fmtUkIso } from './format';
import type { ProcurementPlan } from './procurement';

const round1 = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

export function decisionCsv(
  data: DecisionResponse,
  reveal: boolean,
  plan?: ProcurementPlan | null,
) {
  const headers = [
    'start_time_utc',
    'start_time_uk',
    'forecast_mw',
    'forecast_publish_time_utc',
    'forecast_publish_time_uk',
    'lead_time_h',
    'band_p10_mw',
    'band_p90_mw',
    ...(plan
      ? ['what_if_demand_mw', 'what_if_wind_share_pct', 'buy_if_forecast_mw', 'buy_if_p10_wind_mw']
      : []),
    ...(reveal
      ? [
          'actual_hourly_mean_mw',
          'actual_first_half_hour_mw',
          'actual_half_hours',
          'actual_status',
          'error_mw',
          ...(plan ? ['need_given_actual_mw'] : []),
        ]
      : []),
  ];
  const rows = data.rows.map((r, i) => {
    const hour = plan?.hours[i];
    return [
      r.start_time,
      fmtUkIso(r.start_time),
      r.forecast_mw,
      r.publish_time,
      fmtUkIso(r.publish_time),
      r.horizon_h,
      round1(r.band_p10_mw),
      round1(r.band_p90_mw),
      ...(plan
        ? [
            plan.demandMw,
            plan.sharePct,
            round1(hour?.buy_forecast_mw ?? null),
            round1(hour?.buy_low_wind_mw ?? null),
          ]
        : []),
      ...(reveal
        ? [
            r.actual_mw,
            r.actual_first_half_mw,
            r.actual_half_hours,
            r.actual_status,
            r.error_mw,
            ...(plan ? [round1(hour?.need_actual_mw ?? null)] : []),
          ]
        : []),
    ];
  });
  const gate = data.gate.gate.replace(':', '');
  return {
    filename: `winddesk_decision_${data.decision_date}_gate-${gate}${reveal ? '_with-actuals' : ''}.csv`,
    csv: toCsv(headers, rows),
  };
}
