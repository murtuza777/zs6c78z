import type { ForecastAgePoint, HistogramBin } from '../../api/types';
import { fmtCompact, fmtHours, fmtMW, fmtNumber, fmtSignedMW } from '../../lib/format';
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

const grid = { left: 8, right: 12, top: 52, bottom: 8, containLabel: true };

export const AGE_SERIES = { mae: 'MAE', bias: 'Bias' } as const;

/**
 * Error vs forecast age: MAE and bias when every delivery hour uses the latest forecast at least
 * H hours old. The span of lead times the gate actually uses is shaded and labelled.
 */
export function forecastAgeOption(
  points: ForecastAgePoint[],
  gateLeads: [number, number] | null,
): ChartOption {
  const byAge = new Map(points.map((p) => [p.age_h, p]));
  return {
    ...baseOption,
    grid: { ...grid, bottom: 28 },
    legend: { ...legendCommon, data: [AGE_SERIES.mae, AGE_SERIES.bias] },
    tooltip: {
      ...baseTooltip,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: C.muted, width: 1 } },
      formatter: (params: { axisValue: number }[]) => {
        const p = byAge.get(params[0]?.axisValue ?? -1);
        if (!p) return '';
        return [
          tooltipTitle(`Forecasts at least ${fmtHours(p.age_h)} old`),
          tooltipRow(C.forecast, AGE_SERIES.mae, fmtMW(p.mae_mw)),
          tooltipRow(C.over, 'Bias (forecast − actual)', fmtSignedMW(p.bias_mw)),
          tooltipRow(C.neutral, 'Matched hours', `${p.n_matched}/${p.n_expected}`, 'box'),
        ].join('');
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: points.at(-1)?.age_h ?? 48,
      interval: 6,
      name: 'Forecast age at delivery, h',
      nameLocation: 'middle',
      nameGap: 26,
      ...axisCommon,
      splitLine: { show: false },
    },
    yAxis: { ...mwAxis(), min: 0 },
    series: [
      {
        name: AGE_SERIES.mae,
        type: 'line',
        data: points.map((p) => [p.age_h, p.mae_mw]),
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2, color: C.forecast },
        itemStyle: { color: C.forecast, borderColor: C.surface, borderWidth: 1 },
        markArea: gateLeads
          ? {
              silent: true,
              itemStyle: { color: 'rgba(26, 160, 191, 0.08)' },
              label: { show: true, color: C.muted, fontSize: 11, position: 'insideTop' },
              data: [[{ xAxis: gateLeads[0], name: 'At this gate' }, { xAxis: gateLeads[1] }]],
            }
          : undefined,
      },
      {
        name: AGE_SERIES.bias,
        type: 'line',
        data: points.map((p) => [p.age_h, p.bias_mw]),
        symbol: 'diamond',
        symbolSize: 7,
        lineStyle: { width: 2, color: C.over, type: 'dashed' },
        itemStyle: { color: C.over },
      },
    ],
  };
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
    grid: { ...grid, top: 32, bottom: 28 },
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
          tooltipRow(colour[tone], label, `${fmtNumber(bin.count)} hours`, 'box'),
        ].join('');
      },
    },
    xAxis: {
      type: 'category',
      data: bins.map((b) => fmtCompact(b.lower_mw)),
      name: 'Error (forecast − actual), MW',
      nameLocation: 'middle',
      nameGap: 26,
      ...axisCommon,
      splitLine: { show: false },
    },
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
