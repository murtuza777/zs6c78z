import { BarChart, CustomChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.EChartsCoreOption;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartEventHandler = (params: any) => void;

interface Props {
  option: ChartOption;
  ariaLabel: string;
  height?: number;
  onClick?: ChartEventHandler;
}

/** Thin, lifecycle-safe wrapper around an ECharts instance. */
export function EChart({ option, ariaLabel, height = 320, onClick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = echarts.init(element, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || !onClick) return;
    instance.on('click', onClick);
    return () => {
      instance.off('click', onClick);
    };
  }, [onClick]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
      className="w-full"
      data-testid="echart"
    />
  );
}
