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

export function buildHorizonOption(data: HorizonResponse): ChartOption {
  const rows = data.rows;
  const times = rows.map((r) => new Date(r.start_time).getTime());
  const start = times[0] ?? 0;
  const end = (times.at(-1) ?? 0) + HOUR_MS;
  const span = end - start;
  const byTime = new Map(rows.map((r, i) => [times[i]!, r]));
  const interval = span > 4 * DAY_MS ? DAY_MS : span > DAY_MS ? 6 * HOUR_MS : 3 * HOUR_MS;

  return {
    ...baseOption,
    grid: { left: 8, right: 16, top: 52, bottom: 56, containLabel: true },
    legend: { ...legendCommon, data: ['Forecast', 'Actual (hourly mean)'] },
    tooltip: {
      ...baseTooltip,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: C.muted, width: 1 } },
      formatter: (params: { axisValue: number }[]) => {
        const first = params[0];
        if (!first) return '';
        const row = byTime.get(Math.round(first.axisValue / HOUR_MS) * HOUR_MS);
        if (!row) return '';
        return [
          tooltipTitle(`${fmtUkDateTime(row.start_time)} UK · ${fmtHours(row.horizon_h)} ahead`),
          tooltipRow(C.forecast, 'Forecast', fmtMW(row.forecast_mw)),
          tooltipRow(C.actual, 'Actual (hourly mean)', fmtMW(row.actual_mw)),
          tooltipRow(C.neutral, 'Error', fmtSignedMW(row.error_mw), 'box'),
          row.publish_time ? tooltipTitle(`Published ${fmtUkDateTime(row.publish_time)} UK`) : '',
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
        name: 'Forecast',
        type: 'line',
        data: rows.map((r, i) => [times[i], r.forecast_mw]),
        showSymbol: false,
        lineStyle: { width: 2, color: C.forecast },
        itemStyle: { color: C.forecast },
      },
      {
        name: 'Actual (hourly mean)',
        type: 'line',
        data: rows.map((r, i) => [times[i], r.actual_mw]),
        showSymbol: false,
        lineStyle: { width: 2, color: C.actual },
        itemStyle: { color: C.actual },
      },
    ],
  };
}
