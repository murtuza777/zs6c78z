import type { DecisionResponse, DecisionRow } from '../../api/types';
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

export interface DecisionChartOptions {
  reveal: boolean;
  showRevisions: boolean;
}

export const SERIES = {
  forecast: 'Forecast at gate',
  band: 'P10–P90 band',
  actual: 'Actual (hourly mean)',
  earlier: 'Earlier runs (pre-gate)',
  later: 'Runs after gate',
} as const;

const ms = (iso: string) => new Date(iso).getTime();

function tooltipFor(row: DecisionRow, reveal: boolean): string {
  const parts = [
    tooltipTitle(
      `${fmtUkTime(row.start_time)}–${fmtUkTime(row.end_time)} UK · ${fmtHours(row.horizon_h)} ahead`,
    ),
    tooltipRow(C.forecast, SERIES.forecast, fmtMW(row.forecast_mw)),
  ];
  if (row.band_p10_mw != null && row.band_p90_mw != null) {
    parts.push(
      tooltipRow(
        C.band,
        SERIES.band,
        `${fmtMW(row.band_p10_mw).replace(' MW', '')}–${fmtMW(row.band_p90_mw)}`,
        'box',
      ),
    );
  }
  if (reveal) {
    parts.push(tooltipRow(C.actual, SERIES.actual, fmtMW(row.actual_mw)));
    parts.push(
      tooltipRow(C.neutral, 'Error (forecast − actual)', fmtSignedMW(row.error_mw), 'box'),
    );
  }
  if (row.publish_time) {
    parts.push(tooltipTitle(`Forecast published ${fmtUkDateTime(row.publish_time)} UK`));
  }
  return parts.join('');
}

/** Contiguous runs of hours that have both band edges (gaps stay gaps). */
export function bandSegments(rows: DecisionRow[]): [number, number, number][][] {
  const segments: [number, number, number][][] = [];
  let current: [number, number, number][] = [];
  for (const r of rows) {
    if (r.band_p10_mw != null && r.band_p90_mw != null) {
      current.push([ms(r.start_time), r.band_p10_mw, r.band_p90_mw]);
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

interface CustomApi {
  coord: (value: [number, number]) => [number, number];
}

// A polygon between P10 and P90. Line stacking only works on category/time axes, and this
// chart uses a numeric axis so that ticks fall on UK-local hours in any browser time zone.
function bandSeries(rows: DecisionRow[]): Record<string, unknown> {
  const segments = bandSegments(rows);
  return {
    name: SERIES.band,
    type: 'custom',
    silent: true,
    z: 2,
    itemStyle: { color: C.band },
    data: segments.flat(),
    encode: { x: 0, y: [1, 2] },
    tooltip: { show: false },
    renderItem: (params: { dataIndex: number }, api: CustomApi) => {
      if (params.dataIndex !== 0) return null; // draw every segment once
      return {
        type: 'group',
        children: segments.map((segment) => ({
          type: 'polygon',
          shape: {
            points: [
              ...segment.map(([x, , hi]) => api.coord([x, hi])),
              ...[...segment].reverse().map(([x, lo]) => api.coord([x, lo])),
            ],
          },
          style: { fill: C.band },
        })),
      };
    },
  };
}

export function buildDecisionOption(
  decision: DecisionResponse,
  { reveal, showRevisions }: DecisionChartOptions,
): ChartOption {
  const start = ms(decision.delivery_start_utc);
  const end = ms(decision.delivery_end_utc);
  const rows = decision.rows;
  const byTime = new Map(rows.map((r) => [ms(r.start_time), r]));

  const series: Record<string, unknown>[] = [];

  if (showRevisions) {
    for (const revision of decision.revisions) {
      if (revision.is_selected) continue;
      if (!revision.available_at_decision && !reveal) continue;
      const earlier = revision.available_at_decision;
      series.push({
        name: earlier ? SERIES.earlier : SERIES.later,
        type: 'line',
        data: revision.points.map((p) => [ms(p.start_time), p.forecast_mw]),
        showSymbol: false,
        silent: true,
        z: 1,
        lineStyle: {
          width: 1,
          color: earlier ? C.earlier : C.later,
          opacity: earlier ? 0.5 : 0.75,
        },
        itemStyle: { color: earlier ? C.earlier : C.later },
        emphasis: { disabled: true },
        tooltip: { show: false },
      });
    }
  }

  if (decision.band.available) {
    series.push(bandSeries(rows));
  }

  series.push({
    name: SERIES.forecast,
    type: 'line',
    data: rows.map((r) => [ms(r.start_time), r.forecast_mw]),
    showSymbol: false,
    symbolSize: 8,
    lineStyle: { width: 2, color: C.forecast, cap: 'round', join: 'round' },
    itemStyle: { color: C.forecast, borderColor: C.surface, borderWidth: 2 },
    z: 4,
  });

  if (reveal) {
    series.push({
      name: SERIES.actual,
      type: 'line',
      data: rows.map((r) => [ms(r.start_time), r.actual_mw]),
      showSymbol: false,
      symbolSize: 8,
      lineStyle: { width: 2, color: C.actual, cap: 'round', join: 'round' },
      itemStyle: { color: C.actual, borderColor: C.surface, borderWidth: 2 },
      z: 5,
    });
  }

  const legend: string[] = [SERIES.forecast];
  if (decision.band.available) legend.push(SERIES.band);
  if (reveal) legend.push(SERIES.actual);
  if (showRevisions) {
    legend.push(SERIES.earlier);
    if (reveal) legend.push(SERIES.later);
  }

  return {
    ...baseOption,
    grid: { left: 8, right: 16, top: 52, bottom: 8, containLabel: true },
    legend: { ...legendCommon, data: legend },
    tooltip: {
      ...baseTooltip,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: C.muted, width: 1 } },
      formatter: (params: { axisValue: number }[]) => {
        const first = params[0];
        if (!first) return '';
        const row = byTime.get(Math.round(first.axisValue / HOUR_MS) * HOUR_MS);
        return row ? tooltipFor(row, reveal) : '';
      },
    },
    xAxis: {
      type: 'value',
      min: start,
      max: end,
      interval: 3 * HOUR_MS,
      ...axisCommon,
      splitLine: { show: false },
      axisLabel: {
        ...axisCommon.axisLabel,
        formatter: (v: number) => (v === end ? '24:00' : fmtUkTime(v)),
      },
      axisPointer: { snap: true },
    },
    yAxis: { ...mwAxis(), min: 0 },
    series,
  };
}
