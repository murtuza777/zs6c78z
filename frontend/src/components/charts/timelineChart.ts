import type { HorizonResponse } from '../../api/types';
import { fmtHours, fmtMW, fmtSignedMW, fmtUkDateTime, fmtUkTime } from '../../lib/format';
import type { ChartOption } from './EChart';
import {
  axisCommon,
  baseOption,
  baseTooltip,
  C,
  legendCommon,
  mwAxis,
  responsive,
  tooltipRow,
  tooltipTitle,
} from './theme';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const dayLabel = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
});

/** One hourly point: the forecast that was selected for it and the hourly-mean actual. */
export interface TimelinePointLike {
  start_time: string;
  forecast_mw: number | null;
  actual_mw: number | null;
  publish_time: string | null;
}

export const ACTUAL_SERIES = 'Actual (hourly mean)';

/**
 * Forecast-vs-actual over many hours with zoom. Null values stay gaps (no line is drawn
 * across hours without a forecast or a complete actual).
 */
export function buildTimelineOption(
  points: TimelinePointLike[],
  { forecastName }: { forecastName: string },
): ChartOption {
  const times = points.map((p) => new Date(p.start_time).getTime());
  const start = times[0] ?? 0;
  const end = (times.at(-1) ?? 0) + HOUR_MS;
  const span = end - start;
  const byTime = new Map(points.map((p, i) => [times[i]!, p]));
  const interval =
    span > 16 * DAY_MS
      ? 2 * DAY_MS
      : span > 4 * DAY_MS
        ? DAY_MS
        : span > DAY_MS
          ? 6 * HOUR_MS
          : 3 * HOUR_MS;

  const option = {
    ...baseOption,
    grid: { left: 8, right: 16, top: 52, bottom: 56, containLabel: true },
    legend: { ...legendCommon, data: [forecastName, ACTUAL_SERIES] },
    tooltip: {
      ...baseTooltip,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: C.muted, width: 1 } },
      formatter: (params: { axisValue: number }[]) => {
        const first = params[0];
        if (!first) return '';
        const point = byTime.get(Math.round(first.axisValue / HOUR_MS) * HOUR_MS);
        if (!point) return '';
        const error =
          point.forecast_mw != null && point.actual_mw != null
            ? point.forecast_mw - point.actual_mw
            : null;
        const lead = point.publish_time
          ? (new Date(point.start_time).getTime() - new Date(point.publish_time).getTime()) /
            HOUR_MS
          : null;
        return [
          tooltipTitle(`${fmtUkDateTime(point.start_time)} UK · ${fmtHours(lead)} ahead`),
          tooltipRow(C.forecast, forecastName, fmtMW(point.forecast_mw)),
          tooltipRow(C.actual, ACTUAL_SERIES, fmtMW(point.actual_mw)),
          tooltipRow(C.neutral, 'Error (forecast − actual)', fmtSignedMW(error), 'box'),
          point.publish_time
            ? tooltipTitle(`Published ${fmtUkDateTime(point.publish_time)} UK`)
            : '',
        ].join('');
      },
    },
    xAxis: {
      type: 'value',
      min: start,
      max: end,
      interval,
      ...axisCommon,
      splitLine: { show: false },
      axisLabel: {
        ...axisCommon.axisLabel,
        formatter: (v: number) => (interval >= DAY_MS ? dayLabel.format(v) : fmtUkTime(v)),
      },
    },
    yAxis: { ...mwAxis(), min: 0 },
    dataZoom: [
      { type: 'inside', filterMode: 'none' },
      {
        type: 'slider',
        height: 22,
        bottom: 8,
        borderColor: C.axis,
        fillerColor: 'rgba(26,160,191,0.15)',
        backgroundColor: C.surface,
        dataBackground: { lineStyle: { color: C.axis }, areaStyle: { color: C.grid } },
        handleStyle: { color: C.inkSecondary, borderColor: C.axis },
        textStyle: { color: C.muted },
        labelFormatter: (v: number) => dayLabel.format(v),
      },
    ],
    series: [
      {
        name: forecastName,
        type: 'line',
        data: points.map((p, i) => [times[i], p.forecast_mw]),
        showSymbol: false,
        lineStyle: { width: 2, color: C.forecast },
        itemStyle: { color: C.forecast },
      },
      {
        name: ACTUAL_SERIES,
        type: 'line',
        data: points.map((p, i) => [times[i], p.actual_mw]),
        // Markers on short ranges give actuals a non-colour cue; too dense for a month.
        showSymbol: points.length <= 96,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, color: C.actual },
        itemStyle: { color: C.actual },
      },
    ],
  };
  return responsive(option, {
    grid: { top: 72 },
    xAxis: { interval: interval >= DAY_MS ? 7 * DAY_MS : 2 * interval },
  });
}

export function buildHorizonOption(data: HorizonResponse): ChartOption {
  return buildTimelineOption(data.rows, { forecastName: 'Forecast' });
}
