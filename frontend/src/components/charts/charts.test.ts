import { describe, expect, it } from 'vitest';

import { accuracy, decision } from '../../test/fixtures';
import { binTone, histogramOption, vintageOption } from './accuracyCharts';
import { bandSegments, buildDecisionOption, SERIES } from './decisionChart';

type Series = { name?: string; type?: string; data?: unknown[] };
// Builders may wrap their option in { baseOption, media } for responsive layouts.
const seriesOf = (option: unknown) =>
  ((option as { baseOption?: { series: Series[] } }).baseOption ?? (option as { series: Series[] }))
    .series;
const names = (option: unknown) => seriesOf(option).map((s) => s.name);

describe('decision chart', () => {
  it('shows only decision-time information until actuals are revealed', () => {
    const hidden = buildDecisionOption(decision, { reveal: false, showRevisions: true });
    expect(names(hidden)).toContain(SERIES.forecast);
    expect(names(hidden)).toContain(SERIES.earlier);
    expect(names(hidden)).not.toContain(SERIES.actual);
    expect(names(hidden)).not.toContain(SERIES.later); // post-gate runs are hindsight too

    const revealed = buildDecisionOption(decision, { reveal: true, showRevisions: true });
    expect(names(revealed)).toContain(SERIES.actual);
    expect(names(revealed)).toContain(SERIES.later);
  });

  it('never draws the selected run twice and can hide revisions', () => {
    const option = buildDecisionOption(decision, { reveal: true, showRevisions: false });
    expect(names(option)).not.toContain(SERIES.earlier);
    expect(names(option).filter((n) => n === SERIES.forecast)).toHaveLength(1);
  });

  it('splits the uncertainty band at hours without a band', () => {
    const segments = bandSegments(decision.rows);
    expect(segments).toHaveLength(2); // hour 05 has no band
    expect(segments[0]).toHaveLength(5);
    expect(segments[1]).toHaveLength(18);
  });
});

describe('accuracy charts', () => {
  it('colours histogram bins by error sign', () => {
    expect(binTone({ lower_mw: -250, upper_mw: 0, count: 1 })).toBe('under');
    expect(binTone({ lower_mw: 0, upper_mw: 250, count: 1 })).toBe('over');
    expect(binTone({ lower_mw: -100, upper_mw: 150, count: 1 })).toBe('neutral');
    const data = seriesOf(histogramOption(accuracy.histogram))[0]!.data as { value: number }[];
    expect(data.map((d) => d.value)).toEqual([3, 5]);
  });

  it('distinguishes vintages available at the gate', () => {
    const data = seriesOf(vintageOption(accuracy.by_vintage))[0]!.data as {
      itemStyle: { color: string };
    }[];
    expect(new Set(data.map((d) => d.itemStyle.color)).size).toBe(2);
  });
});

describe('non-colour encodings', () => {
  it('draws actuals with markers so they differ from the forecast by shape', () => {
    const series = seriesOf(buildDecisionOption(decision, { reveal: true, showRevisions: false }));
    const actual = series.find((s) => s.name === SERIES.actual) as { showSymbol?: boolean };
    const forecast = series.find((s) => s.name === SERIES.forecast) as { showSymbol?: boolean };
    expect(actual.showSymbol).toBe(true);
    expect(forecast.showSymbol).toBe(false);
  });

  it('labels the post-gate region of the vintage chart', () => {
    const bar = seriesOf(vintageOption(accuracy.by_vintage))[0] as {
      markArea?: { data: [{ xAxis: string; name: string }, { xAxis: string }][] };
    };
    expect(bar.markArea?.data[0]?.[0]).toMatchObject({ xAxis: '22:30', name: 'After gate' });
  });
});

describe('January timeline', () => {
  it('plots every hour and keeps missing forecasts as gaps', async () => {
    const { buildTimelineOption, ACTUAL_SERIES } = await import('./timelineChart');
    const timeline = accuracy.timeline!;
    const option = buildTimelineOption(timeline, { forecastName: 'Forecast at gate' });
    const [forecast, actual] = seriesOf(option) as {
      name: string;
      data: [number, number | null][];
    }[];
    expect(forecast!.name).toBe('Forecast at gate');
    expect(actual!.name).toBe(ACTUAL_SERIES);
    expect(forecast!.data).toHaveLength(timeline.length);
    expect(forecast!.data[3]![1]).toBeNull(); // fixture hour 03 has no forecast
    expect(actual!.data[3]![1]).not.toBeNull();
  });
});
