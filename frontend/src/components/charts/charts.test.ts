import { describe, expect, it } from 'vitest';

import { accuracy, decision } from '../../test/fixtures';
import { AGE_SERIES, binTone, forecastAgeOption, histogramOption } from './accuracyCharts';
import { bandSegments, buildDecisionOption, SERIES } from './decisionChart';
import { ACTUAL_SERIES, buildTimelineOption } from './timelineChart';

type Series = { name?: string; type?: string; data?: unknown[] };
type Option = { series: Series[]; legend?: { data: string[]; selected?: Record<string, boolean> } };
// Builders may wrap their option in { baseOption, media } for responsive layouts.
const optionOf = (option: unknown) =>
  (option as { baseOption?: Option }).baseOption ?? (option as Option);
const seriesOf = (option: unknown) => optionOf(option).series;
const names = (option: unknown) => seriesOf(option).map((s) => s.name);

describe('decision chart', () => {
  it('shows only decision-time information until actuals are shown', () => {
    const hidden = buildDecisionOption(decision, { reveal: false });
    expect(names(hidden)).toContain(SERIES.forecast);
    expect(names(hidden)).toContain(SERIES.earlier);
    expect(names(hidden)).not.toContain(SERIES.actual);
    expect(names(hidden)).not.toContain(SERIES.later); // post-gate runs are hindsight too

    const revealed = buildDecisionOption(decision, { reveal: true });
    expect(names(revealed)).toContain(SERIES.actual);
    expect(names(revealed)).toContain(SERIES.later);
  });

  it('keeps other runs in the legend but switched off', () => {
    const { legend } = optionOf(buildDecisionOption(decision, { reveal: true }));
    expect(legend?.data).toEqual([
      SERIES.forecast,
      SERIES.band,
      SERIES.actual,
      SERIES.earlier,
      SERIES.later,
    ]);
    expect(legend?.selected).toMatchObject({ [SERIES.earlier]: false, [SERIES.later]: false });
  });

  it('never draws the selected run twice', () => {
    const option = buildDecisionOption(decision, { reveal: true });
    expect(names(option).filter((n) => n === SERIES.forecast)).toHaveLength(1);
  });

  it('splits the uncertainty band at hours without a band', () => {
    const segments = bandSegments(decision.rows);
    expect(segments).toHaveLength(2); // hour 05 has no band
    expect(segments[0]).toHaveLength(5);
    expect(segments[1]).toHaveLength(18);
  });

  it('draws actuals with markers so they differ from the forecast by shape', () => {
    const series = seriesOf(buildDecisionOption(decision, { reveal: true }));
    const actual = series.find((s) => s.name === SERIES.actual) as { showSymbol?: boolean };
    const forecast = series.find((s) => s.name === SERIES.forecast) as { showSymbol?: boolean };
    expect(actual.showSymbol).toBe(true);
    expect(forecast.showSymbol).toBe(false);
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

  it('plots MAE and bias against forecast age and shades the gate lead times', () => {
    const option = forecastAgeOption(accuracy.by_forecast_age!, [14.5, 37.5]);
    const [mae, bias] = seriesOf(option) as (Series & {
      markArea?: { data: [{ xAxis: number; name: string }, { xAxis: number }][] };
      lineStyle: { type?: string };
    })[];
    expect(mae!.name).toBe(AGE_SERIES.mae);
    expect(mae!.data).toEqual([
      [0, 1688],
      [12, 1804],
      [24, 1948],
      [48, 2310],
    ]);
    expect(mae!.markArea?.data[0]).toEqual([
      { xAxis: 14.5, name: 'At this gate' },
      { xAxis: 37.5 },
    ]);
    // Bias differs from MAE by line style as well as colour.
    expect(bias!.lineStyle.type).toBe('dashed');
    const unshaded = seriesOf(forecastAgeOption(accuracy.by_forecast_age!, null))[0] as {
      markArea?: unknown;
    };
    expect(unshaded.markArea).toBeUndefined();
  });
});

describe('January timeline', () => {
  it('plots every hour and keeps missing forecasts as gaps', () => {
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
