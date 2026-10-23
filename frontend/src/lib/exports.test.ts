import { describe, expect, it } from 'vitest';

import { accuracy, decision } from '../test/fixtures';
import { decisionCsv } from './exports';
import { fmtUkIso } from './format';
import { errorDirection } from './insights';

const parse = (csv: string) =>
  csv
    .trimEnd()
    .split('\r\n')
    .map((line) => line.split(','));

describe('decision CSV export', () => {
  it('has one row per hourly observation and matches the API rows', () => {
    const { filename, csv } = decisionCsv(decision, true);
    const [header, ...rows] = parse(csv);
    expect(filename).toBe('winddesk_decision_2026-01-15_gate-0950_with-actuals.csv');
    expect(rows).toHaveLength(decision.rows.length);
    const col = (name: string) => header!.indexOf(name);
    rows.forEach((row, i) => {
      const source = decision.rows[i]!;
      expect(row[col('start_time_utc')]).toBe(source.start_time);
      expect(Number(row[col('forecast_mw')])).toBe(source.forecast_mw);
      expect(Number(row[col('actual_hourly_mean_mw')])).toBe(source.actual_mw);
      expect(Number(row[col('error_mw')])).toBe(source.error_mw);
    });
  });

  it('omits hindsight columns unless actuals are revealed', () => {
    const { filename, csv } = decisionCsv(decision, false);
    const [header] = parse(csv);
    expect(filename).toBe('winddesk_decision_2026-01-15_gate-0950.csv');
    expect(header).not.toContain('actual_hourly_mean_mw');
    expect(header).not.toContain('error_mw');
  });

  it('writes machine-readable UK timestamps and blanks for missing bands', () => {
    const [header, , , , , , hour5] = parse(decisionCsv(decision, false).csv);
    expect(hour5![header!.indexOf('start_time_uk')]).toBe('2026-01-16 05:00');
    expect(hour5![header!.indexOf('band_p10_mw')]).toBe('');
  });
});

describe('UK ISO timestamps', () => {
  it('converts UTC to UK local time across the BST switch', () => {
    expect(fmtUkIso('2026-01-16T09:30:00Z')).toBe('2026-01-16 09:30');
    expect(fmtUkIso('2026-07-01T23:30:00Z')).toBe('2026-07-02 00:30');
    expect(fmtUkIso(null)).toBe('');
  });
});

describe('error direction', () => {
  it('reports over- and under-forecast shares separately', () => {
    expect(errorDirection(accuracy.scatter)).toEqual({ overPct: 75, underPct: 25 });
    const exact = [{ start_time: 'x', forecast_mw: 5, actual_mw: 5 }];
    expect(errorDirection(exact)).toEqual({ overPct: 0, underPct: 0 });
    expect(errorDirection([])).toBeNull();
  });
});
