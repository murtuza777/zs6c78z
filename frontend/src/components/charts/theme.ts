// Chart tokens. Series colours validated with the dataviz palette checker on the navy chart
// surface #0f1a2e (dark mode): lightness band, chroma, CVD and normal-vision separation, contrast.

import { fmtCompact } from '../../lib/format';

export const C = {
  surface: '#0f1a2e',
  raised: '#14223a',
  grid: '#1e2a40',
  axis: '#2d3b55',
  ink: '#eef2f7',
  inkSecondary: '#c3cad6',
  muted: '#8a94a6',
  forecast: '#1aa0bf', // known at gate closure
  actual: '#c98500', // observed afterwards (hindsight)
  later: '#9085e9', // runs published after the gate
  earlier: '#5b6b85', // de-emphasised earlier runs
  under: '#3987e5', // diverging: actual above forecast
  over: '#e66767', // diverging: forecast above actual
  neutral: '#4a5568',
  band: 'rgba(26, 160, 191, 0.16)',
} as const;

export const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** One tooltip row: value leads (strong), label follows; keyed by a short line or swatch. */
export function tooltipRow(
  color: string,
  label: string,
  value: string,
  key: 'line' | 'box' = 'line',
) {
  const swatch =
    key === 'line'
      ? `<span style="display:inline-block;width:12px;height:2px;background:${color};vertical-align:middle;margin-right:8px"></span>`
      : `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:8px"></span>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;line-height:1.7">
    <span style="color:${C.inkSecondary}">${swatch}${escapeHtml(label)}</span>
    <strong style="color:${C.ink};font-variant-numeric:tabular-nums">${escapeHtml(value)}</strong></div>`;
}

export function tooltipTitle(text: string): string {
  return `<div style="color:${C.muted};font-size:11px;margin-bottom:4px">${escapeHtml(text)}</div>`;
}

export const baseTooltip = {
  backgroundColor: C.raised,
  borderColor: C.axis,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: C.ink, fontFamily: FONT, fontSize: 12 },
  extraCssText: 'box-shadow:0 8px 24px rgba(0,0,0,.35);border-radius:8px;',
};

export const axisCommon = {
  axisLine: { lineStyle: { color: C.axis } },
  axisTick: { show: false },
  axisLabel: { color: C.muted, fontFamily: FONT, fontSize: 11, hideOverlap: true },
  splitLine: { lineStyle: { color: C.grid, width: 1 } },
  nameTextStyle: { color: C.muted, fontFamily: FONT, fontSize: 11 },
};

export const mwAxis = (name = 'MW') => ({
  type: 'value' as const,
  name,
  nameGap: 12,
  ...axisCommon,
  axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => fmtCompact(v) },
});

export const legendCommon = {
  top: 0,
  left: 0,
  icon: 'roundRect',
  itemWidth: 14,
  itemHeight: 3,
  itemGap: 18,
  textStyle: { color: C.inkSecondary, fontFamily: FONT, fontSize: 12 },
  inactiveColor: C.axis,
};

/** Width (px) below which charts switch to their narrow layout. */
export const NARROW_MAX_WIDTH = 600;

/**
 * Wrap an option with an ECharts media query so phones get more room for a wrapped legend and
 * sparser axis ticks. Option builders stay pure; the chart applies the rule by container width.
 */
export function responsive<T extends Record<string, unknown>>(
  option: T,
  narrow: Record<string, unknown>,
): { baseOption: T; media: { query: { maxWidth: number }; option: Record<string, unknown> }[] } {
  return { baseOption: option, media: [{ query: { maxWidth: NARROW_MAX_WIDTH }, option: narrow }] };
}

export const baseOption = {
  backgroundColor: 'transparent',
  animationDuration: 250,
  textStyle: { fontFamily: FONT },
  // ECharts' auto aria text would overwrite each chart's own aria-label with raw values
  // (epoch timestamps); the container's role="img" + aria-label carries the description.
  aria: { enabled: false },
};
