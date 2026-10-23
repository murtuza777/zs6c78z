import { describe, expect, it } from 'vitest';

import { accuracy, decision } from '../test/fixtures';
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
import { overForecastShare, readDay, vintageTradeOff } from './insights';
import {
  addDays,
  daysBetween,
  isIsoDate,
  isValidGate,
  parseDateParam,
  parseNumberParam,
} from './params';

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
    expect(daysBetween('2026-01-02', '2026-02-01')).toBe(30);
  });

  it('bounds numeric params', () => {
    expect(parseNumberParam('24', 0, 48, 12)).toBe(24);
    expect(parseNumberParam('60', 0, 48, 12)).toBe(12);
    expect(parseNumberParam('abc', 0, 48, 12)).toBe(12);
    expect(parseNumberParam('', 0, 48, 12)).toBe(12);
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
  it('measures the share of over-forecast hours', () => {
    expect(overForecastShare(accuracy.scatter)).toBe(75);
    expect(overForecastShare([])).toBeNull();
  });

  it('compares the latest usable vintage with the best one', () => {
    const t = vintageTradeOff(accuracy.by_vintage)!;
    expect(t.usable.slot).toBe('09:30');
    expect(t.best.slot).toBe('22:30');
    expect(t.maeReductionPct).toBeCloseTo(10);
  });

  it('reads a day dominated by over-forecasting', () => {
    expect(readDay(decision)?.tone).toBe('over');
  });
});
