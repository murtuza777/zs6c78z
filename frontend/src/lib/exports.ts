// CSV exports built from the same API rows the tables and charts render.

import type { DecisionResponse } from '../api/types';
import { toCsv } from './csv';
import { fmtUkIso } from './format';

const round1 = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

export function decisionCsv(data: DecisionResponse, reveal: boolean) {
  const headers = [
    'start_time_utc',
    'start_time_uk',
    'forecast_mw',
    'forecast_publish_time_utc',
    'forecast_publish_time_uk',
    'lead_time_h',
    'band_p10_mw',
    'band_p90_mw',
    ...(reveal
      ? [
          'actual_hourly_mean_mw',
          'actual_first_half_hour_mw',
          'actual_half_hours',
          'actual_status',
          'error_mw',
        ]
      : []),
  ];
  const rows = data.rows.map((r) => [
    r.start_time,
    fmtUkIso(r.start_time),
    r.forecast_mw,
    r.publish_time,
    fmtUkIso(r.publish_time),
    r.horizon_h,
    round1(r.band_p10_mw),
    round1(r.band_p90_mw),
    ...(reveal
      ? [r.actual_mw, r.actual_first_half_mw, r.actual_half_hours, r.actual_status, r.error_mw]
      : []),
  ]);
  const gate = data.gate.gate.replace(':', '');
  return {
    filename: `winddesk_decision_${data.decision_date}_gate-${gate}${reveal ? '_with-actuals' : ''}.csv`,
    csv: toCsv(headers, rows),
  };
}
