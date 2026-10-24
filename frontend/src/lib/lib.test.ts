import { describe, expect, it } from 'vitest';

import { accuracy } from '../test/fixtures';
import { toCsv } from './csv';
import {
  fmtCompact,
  fmtDay,
  fmtNumber,
  fmtSignedGWh,
  fmtSignedMW,
  fmtUkDateTime,
  fmtUkTime,
} from './format';
import { errorDirection, gateLeadRange } from './insights';
import { addDays, isIsoDate, isValidGate, parseDateParam } from './params';

describe('format', () => {
  it('signs errors explicitly with a true minus sign', () => {
    expect(fmtSignedMW(1729.9)).toBe('+1,730 MW');
    expect(fmtSignedMW(-12.4)).toBe('−12 MW');
    expect(fmtSignedMW(0.2)).toBe('0 MW');
    expect(fmtSignedMW(null)).toBe('—');
    expect(fmtSignedGWh(-129.04)).toBe('−129.0 GWh');
  });

  it('never prints negative zero', () => {
    expect(fmtNumber(-0.2)).toBe('0');
  });

  it('formats UTC instants as UK local time across the BST switch', () => {
    expect(fmtUkTime('2026-01-15T09:30:00Z')).toBe('09:30');
    expect(fmtUkTime('2026-07-01T08:50:00Z')).toBe('09:50');
    expect(fmtUkDateTime('2026-01-15T09:30:00Z')).toBe('Thu 15 Jan 09:30');
  });

  it('formats calendar dates without a timezone shift', () => {
    expect(fmtDay('2026-01-16')).toBe('Fri 16 Jan 2026');
  });

  it('compacts axis ticks', () => {
    expect(fmtCompact(12000)).toBe('12k');
    expect(fmtCompact(-2500)).toBe('−2.5k');
    expect(fmtCompact(250)).toBe('250');
  });
});

describe('url params', () => {
  it('validates gates strictly', () => {
    expect(isValidGate('09:50')).toBe(true);
    expect(isValidGate('9:50')).toBe(false);
    expect(isValidGate('24:00')).toBe(false);
  });

  it('rejects impossible or out-of-scope dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(parseDateParam('2026-02-01', '2026-01-01', '2026-01-31', '2026-01-01')).toBe(
      '2026-01-01',
    );
    expect(parseDateParam('2026-01-20', '2026-01-01', '2026-01-31', '2026-01-01')).toBe(
      '2026-01-20',
    );
    expect(parseDateParam(null, '2026-01-01', '2026-01-31', '2026-01-05')).toBe('2026-01-05');
  });

  it('does date arithmetic in UTC', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('csv', () => {
  it('quotes delimiters and neutralises formula injection', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        ['x,y', '=HYPERLINK("bad")'],
        [null, -5],
      ],
    );
    expect(csv).toBe('a,b\r\n"x,y","\'=HYPERLINK(""bad"")"\r\n,-5\r\n');
  });
});

describe('insights', () => {
  it('splits matched hours into over- and under-forecast', () => {
    expect(errorDirection(accuracy.scatter)).toEqual({ overPct: 75, underPct: 25 });
    expect(errorDirection([])).toBeNull();
  });

  it('finds the lead times of the forecasts selected at the gate', () => {
    // Fixture hours 00-23 from the 09:30 run (hour 03 has none): 14.5 h to 37.5 h.
    expect(gateLeadRange(accuracy.timeline!)).toEqual([14.5, 37.5]);
    expect(gateLeadRange([])).toBeNull();
  });
});
