import type {
  DailyAccuracy,
  GroupAccuracy,
  HistogramBin,
  ScatterPoint,
  VintageAccuracy,
} from '../../api/types';
import {
  fmtCompact,
  fmtMW,
  fmtNumber,
  fmtShortDay,
  fmtSignedMW,
  fmtUkDateTime,
} from '../../lib/format';
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

const BAR = { barMaxWidth: 24, itemStyle: { borderRadius: [4, 4, 0, 0] } };
const grid = { left: 8, right: 12, top: 52, bottom: 8, containLabel: true };
const categoryAxis = (data: string[], extra: Record<string, unknown> = {}) => ({
  type: 'category' as const,
  data,
  ...axisCommon,
  splitLine: { show: false },
  ...extra,
});

/** MAE bars with signed bias on the same MW axis (one scale, two measures of the same unit). */
function maeBiasOption(labels: string[], groups: GroupAccuracy[], titleFor: (i: number) => string) {
  return {
    ...baseOption,
    grid,
    legend: { ...legendCommon, data: ['MAE', 'Bias'] },
    tooltip: {
      ...baseTooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(138,148,166,0.08)' } },
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        const m = groups[i]?.metrics;
        if (!m) return '';
        return [
          tooltipTitle(titleFor(i)),
          tooltipRow(C.forecast, 'MAE', fmtMW(m.mae_mw), 'box'),
          tooltipRow(C.inkSecondary, 'Bias (forecast − actual)', fmtSignedMW(m.bias_mw)),
          tooltipRow(C.neutral, 'Matched hours', `${m.n_matched}/${m.n_expected}`, 'box'),
        ].join('');
      },
    },
    xAxis: categoryAxis(labels),
    yAxis: mwAxis(),
    series: [
      {
        name: 'MAE',
        type: 'bar',
        data: groups.map((g) => g.metrics.mae_mw),
        ...BAR,
        itemStyle: { ...BAR.itemStyle, color: C.forecast },
        emphasis: { itemStyle: { color: '#33b8d6' } },
      },
      {
        name: 'Bias',
        type: 'line',
        data: groups.map((g) => g.metrics.bias_mw),
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: false,
        lineStyle: { width: 2, color: C.inkSecondary },
        itemStyle: { color: C.inkSecondary, borderColor: C.surface, borderWidth: 2 },
      },
    ],
  };
}

export function dailyOption(daily: DailyAccuracy[]): ChartOption {
  return maeBiasOption(
    daily.map((d) => fmtShortDay(d.delivery_date)),
    daily.map((d) => ({ label: d.delivery_date, metrics: d.metrics })),
    (i) =>
      `Delivery ${fmtShortDay(daily[i]!.delivery_date)} · decided ${fmtShortDay(
        daily[i]!.decision_date,
      )} · click to open brief`,
  );
}

export function hourOption(groups: GroupAccuracy[]): ChartOption {
  return maeBiasOption(
    groups.map((g) => g.label),
    groups,
    (i) => `Delivery hour ${groups[i]!.label} UK`,
  );
}

export function horizonBucketOption(groups: GroupAccuracy[]): ChartOption {
  return maeBiasOption(
    groups.map((g) => g.label),
    groups,
    (i) => `Lead time ${groups[i]!.label}`,
  );
}

export function binTone(bin: HistogramBin): 'under' | 'over' | 'neutral' {
  if (bin.upper_mw <= 0) return 'under';
  if (bin.lower_mw >= 0) return 'over';
  return 'neutral';
}

export function histogramOption(bins: HistogramBin[]): ChartOption {
  const colour = { under: C.under, over: C.over, neutral: C.neutral };
  return {
    ...baseOption,
    grid: { ...grid, top: 32 },
    tooltip: {
      ...baseTooltip,
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const bin = bins[p.dataIndex];
        if (!bin) return '';
        const tone = binTone(bin);
        const label =
          tone === 'over' ? 'Over-forecast' : tone === 'under' ? 'Under-forecast' : 'Near zero';
        return [
          tooltipTitle(`${fmtSignedMW(bin.lower_mw)} to ${fmtSignedMW(bin.upper_mw)}`),
          tooltipRow(colour[tone], label, `${bin.count} hours`, 'box'),
        ].join('');
      },
    },
    xAxis: categoryAxis(
      bins.map((b) => fmtCompact(b.lower_mw)),
      { name: 'Error, MW', nameLocation: 'middle', nameGap: 28 },
    ),
    yAxis: { type: 'value', name: 'Hours', ...axisCommon },
    series: [
      {
        type: 'bar',
        barCategoryGap: 2,
        data: bins.map((b) => ({ value: b.count, itemStyle: { color: colour[binTone(b)] } })),
        barMaxWidth: 24,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
    ],
  };
}

export function scatterOption(points: ScatterPoint[]): ChartOption {
  const max =
    Math.ceil(Math.max(1000, ...points.flatMap((p) => [p.actual_mw, p.forecast_mw])) / 2000) * 2000;
  return {
    ...baseOption,
    grid: { ...grid, top: 32, right: 20 },
    tooltip: {
      ...baseTooltip,
      trigger: 'item',
      formatter: (p: { dataIndex: number; seriesType: string }) => {
        const point = points[p.dataIndex];
        if (!point || p.seriesType !== 'scatter') return '';
        return [
          tooltipTitle(`${fmtUkDateTime(point.start_time)} UK`),
          tooltipRow(C.forecast, 'Forecast at gate', fmtMW(point.forecast_mw), 'box'),
          tooltipRow(C.actual, 'Actual', fmtMW(point.actual_mw), 'box'),
          tooltipRow(C.neutral, 'Error', fmtSignedMW(point.forecast_mw - point.actual_mw), 'box'),
        ].join('');
      },
    },
    xAxis: { ...mwAxis('Actual MW'), min: 0, max, nameLocation: 'middle', nameGap: 28 },
    yAxis: { ...mwAxis('Forecast MW'), min: 0, max },
    series: [
      {
        type: 'scatter',
        data: points.map((p) => [p.actual_mw, p.forecast_mw]),
        symbolSize: 7,
        itemStyle: { color: C.forecast, opacity: 0.55 },
        emphasis: { itemStyle: { opacity: 1, borderColor: C.ink, borderWidth: 1 } },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: C.muted, width: 1, type: 'solid' },
          label: { color: C.muted, formatter: 'Perfect forecast', position: 'insideEndTop' },
          data: [[{ coord: [0, 0] }, { coord: [max, max] }]],
        },
      },
    ],
  };
}

export function vintageOption(vintages: VintageAccuracy[]): ChartOption {
  return {
    ...baseOption,
    grid: { ...grid, top: 32 },
    tooltip: {
      ...baseTooltip,
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const v = vintages[p.dataIndex];
        if (!v) return '';
        const late = v.n_runs_off_schedule ? ` · ${v.n_runs_off_schedule} late run(s)` : '';
        return [
          tooltipTitle(
            `${v.slot} UK on D−1 · ${v.available_at_gate ? 'available at gate' : 'after gate'}${late}`,
          ),
          tooltipRow(
            v.available_at_gate ? C.forecast : C.later,
            'MAE',
            fmtMW(v.metrics.mae_mw),
            'box',
          ),
          tooltipRow(C.inkSecondary, 'Bias', fmtSignedMW(v.metrics.bias_mw)),
          tooltipRow(C.neutral, 'Delivery days', fmtNumber(v.n_days), 'box'),
        ].join('');
      },
    },
    xAxis: categoryAxis(vintages.map((v) => v.slot)),
    yAxis: mwAxis(),
    series: [
      {
        type: 'bar',
        ...BAR,
        data: vintages.map((v) => ({
          value: v.metrics.mae_mw,
          itemStyle: {
            color: v.available_at_gate ? C.forecast : C.later,
            borderRadius: [4, 4, 0, 0],
          },
        })),
        label: {
          show: true,
          position: 'top',
          color: C.inkSecondary,
          fontSize: 11,
          formatter: (p: { value: number }) => fmtCompact(Math.round(p.value / 10) * 10),
        },
      },
    ],
  };
}
