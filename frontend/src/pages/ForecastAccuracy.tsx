import { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAccuracy, useMeta } from '../api/hooks';
import type { AccuracyResponse, MetaResponse } from '../api/types';
import {
  dailyOption,
  histogramOption,
  horizonBucketOption,
  hourOption,
  scatterOption,
  vintageOption,
} from '../components/charts/accuracyCharts';
import { EChart, type ChartEventHandler } from '../components/charts/EChart';
import { buildTimelineOption } from '../components/charts/timelineChart';
import { C } from '../components/charts/theme';
import { DateRangeFields } from '../components/controls/DateControls';
import { GateSelector } from '../components/controls/GateSelector';
import {
  Card,
  EmptyState,
  ErrorState,
  Legend,
  PageSkeleton,
  StatTile,
  StatusPill,
  Tag,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useUrlPatch } from '../hooks/useUrlState';
import { fmtMW, fmtNumber, fmtPct, fmtShortDay, fmtSignedGWh, fmtSignedMW } from '../lib/format';
import { errorDirection, vintageTradeOff } from '../lib/insights';
import { parseDateParam, parseGateParam } from '../lib/params';
import { cx } from '../lib/cx';

export function ForecastAccuracy() {
  useDocumentTitle('Forecast Accuracy');
  const meta = useMeta();
  if (meta.isPending) return <PageSkeleton label="Loading scope…" />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  return <Accuracy meta={meta.data} />;
}

function Accuracy({ meta }: { meta: MetaResponse }) {
  const [params, patch] = useUrlPatch();
  const min = meta.decision_date_min;
  const max = meta.decision_date_max;
  const from = parseDateParam(params.get('from'), min, max, min);
  const to = parseDateParam(params.get('to'), from, max, max);
  const gate = parseGateParam(params.get('gate'), meta.default_gate);
  const query = useAccuracy(from, to, gate);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Forecast Accuracy</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          How well the forecast available at gate closure predicted actual wind output, for every
          decision in the selected range. Error = forecast − actual: positive means more wind was
          forecast than arrived.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
        <GateSelector
          presets={meta.gate_presets}
          value={gate}
          onChange={(g) => patch({ gate: g })}
        />
        <DateRangeFields
          label="Decision dates"
          from={from}
          to={to}
          min={min}
          max={max}
          onChange={(f, t) => patch({ from: f === min ? null : f, to: t === max ? null : t })}
        />
      </div>
      {query.isPending && <PageSkeleton label="Scoring every decision…" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <div
          className={cx('space-y-4 transition-opacity', query.isPlaceholderData && 'opacity-60')}
        >
          <AccuracyBody data={query.data} gate={gate} />
        </div>
      )}
    </div>
  );
}

function AccuracyBody({ data, gate }: { data: AccuracyResponse; gate: string }) {
  const navigate = useNavigate();
  const s = data.summary;
  const options = useMemo(
    () => ({
      daily: dailyOption(data.daily),
      histogram: histogramOption(data.histogram),
      scatter: scatterOption(data.scatter),
      hour: hourOption(data.by_hour),
      horizon: horizonBucketOption(data.by_horizon),
      vintage: vintageOption(data.by_vintage),
      // Absent in responses from API builds before the timeline existed: hide, don't crash.
      timeline: data.timeline?.length
        ? buildTimelineOption(data.timeline, { forecastName: 'Forecast at gate' })
        : null,
    }),
    [data],
  );
  const openDay: ChartEventHandler = useCallback(
    (p: { dataIndex: number; seriesType: string }) => {
      const day = data.daily[p.dataIndex];
      if (day) navigate(`/brief?date=${day.decision_date}&gate=${gate}&reveal=1`);
    },
    [data.daily, gate, navigate],
  );
  const direction = errorDirection(data.scatter);
  const tradeOff = vintageTradeOff(data.by_vintage);
  const coverage = data.band_coverage;

  return (
    <>
      <Card tone="decision">
        <h2 className="text-sm font-semibold text-ink">
          Key findings, {fmtShortDay(data.from_date)} to {fmtShortDay(data.to_date)} decisions at{' '}
          {data.gate.gate} UK
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-secondary">
          {s.bias_mw != null && direction != null && (
            <li>
              The forecast was above actual output in{' '}
              <span className="text-ink">{fmtPct(direction.overPct, 0)}</span> of hours and below it
              in <span className="text-ink">{fmtPct(direction.underPct, 0)}</span>. The average bias
              was <span className="text-ink">{fmtSignedMW(s.bias_mw)}</span> and the total energy
              error was{' '}
              <span className="text-ink">{fmtSignedGWh((s.energy_error_mwh ?? 0) / 1000, 0)}</span>.
              {s.bias_mw > 0
                ? ' On balance, planning on the raw forecast would have overstated wind supply.'
                : s.bias_mw < 0
                  ? ' On balance, planning on the raw forecast would have understated wind supply.'
                  : ''}
            </li>
          )}
          <li>
            A typical hour missed by <span className="text-ink">{fmtMW(s.mae_mw)}</span> (MAE). One
            hour in ten missed by more than{' '}
            <span className="text-ink">{fmtMW(s.p90_abs_error_mw)}</span>.
          </li>
          {tradeOff && tradeOff.best.slot !== tradeOff.usable.slot && (
            <li>
              The latest run available at the gate ({tradeOff.usable.slot} UK) had an MAE of{' '}
              <span className="text-ink">{fmtMW(tradeOff.usable.metrics.mae_mw)}</span>. The{' '}
              {tradeOff.best.slot} run on D−1 was{' '}
              <span className="text-ink">{fmtPct(tradeOff.maeReductionPct, 0)}</span> more accurate
              {tradeOff.best.available_at_gate
                ? '.'
                : ', but it is published after this gate closes.'}
            </li>
          )}
          {coverage.available && coverage.coverage_pct != null && (
            <li>
              The hourly P10–P90 band contained the actual in{' '}
              <span className="text-ink">{fmtPct(coverage.coverage_pct)}</span> of held-out hours
              {coverage.daily_energy.coverage_pct != null && (
                <>
                  {' '}
                  and the daily energy range in{' '}
                  <span className="text-ink">
                    {fmtPct(coverage.daily_energy.coverage_pct, 0)}
                  </span>{' '}
                  of days
                </>
              )}
              , against a nominal {fmtPct(coverage.nominal_pct, 0)}.
            </li>
          )}
        </ul>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          emphasis
          label="MAE"
          value={fmtMW(s.mae_mw)}
          hint="Mean absolute error: the average size of the hourly miss, ignoring direction."
        />
        <StatTile
          label="RMSE"
          value={fmtMW(s.rmse_mw)}
          hint="Root mean squared error. Penalises large misses more than MAE; RMSE well above MAE means occasional big misses."
        />
        <StatTile
          label="Bias (mean error)"
          value={fmtSignedMW(s.bias_mw)}
          detail="forecast − actual"
          hint="Average signed error. Positive = the forecast expected more wind than arrived (over-forecast)."
        />
        <StatTile
          label="WAPE"
          value={fmtPct(s.wape_pct)}
          detail="Σ|error| / Σ actual"
          hint="Weighted absolute percentage error: total absolute error as a share of total actual output. Used instead of MAPE, which explodes when wind output is low."
        />
        <StatTile
          label="P90 absolute error"
          value={fmtMW(s.p90_abs_error_mw)}
          detail={`P50 ${fmtMW(s.p50_abs_error_mw)}`}
          hint="Nine hours in ten missed by less than this; one in ten missed by more. P50 is the median miss."
        />
        <StatTile
          label="P99 / max error"
          value={fmtMW(s.p99_abs_error_mw)}
          detail={`max ${fmtMW(s.max_abs_error_mw)}`}
          hint="Tail risk: the 99th percentile and the single largest hourly miss in the range."
        />
        <StatTile
          label="Correlation"
          value={fmtNumber(s.correlation, 3)}
          detail="Pearson r, unitless"
          hint="How well the forecast tracks the shape of actual output (1 = perfect). A high r with a large bias means the shape is right but the level is off."
        />
        <StatTile
          label="Matched hours"
          hint="Hours with both a forecast available at the gate and a complete hourly actual. All statistics use matched hours only."
          value={`${s.n_matched}/${s.n_expected}`}
          detail={
            <StatusPill status={s.n_matched === s.n_expected ? 'good' : 'warning'}>
              {fmtPct(s.coverage_pct)} coverage
            </StatusPill>
          }
        />
      </div>

      {options.timeline && (
        <Card
          title="Forecast at the gate vs actual, every hour"
          subtitle={`For each delivery hour: the forecast that was available at ${data.gate.gate} UK on the decision day, and what was generated. Drag the slider or scroll to zoom; gaps are hours without a forecast or a complete actual.`}
        >
          <EChart
            option={options.timeline}
            height={360}
            ariaLabel={`Hourly forecast available at ${data.gate.gate} and actual wind generation, ${data.timeline?.length ?? 0} hours`}
          />
        </Card>
      )}

      <Card
        title="Daily MAE and bias by delivery day"
        subtitle="Click a bar to open that day's Day-Ahead Brief with actuals revealed."
      >
        <EChart
          option={options.daily}
          height={300}
          ariaLabel="Daily MAE and bias"
          onClick={openDay}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Error distribution"
          subtitle={`Hourly errors in ${fmtNumber(data.histogram_bin_width_mw)} MW bins.`}
          actions={
            <Legend
              items={[
                { color: C.under, label: 'Under-forecast' },
                { color: C.over, label: 'Over-forecast' },
              ]}
            />
          }
        >
          <EChart
            option={options.histogram}
            height={280}
            ariaLabel="Histogram of forecast errors"
          />
        </Card>
        <Card
          title="Forecast vs actual"
          subtitle="Each point is one hour. Points above the diagonal are over-forecasts."
        >
          <EChart
            option={options.scatter}
            height={280}
            ariaLabel="Scatter of forecast against actual"
          />
        </Card>
        <Card
          title="Error by delivery hour (UK)"
          subtitle="Which hours of the delivery day are hardest to forecast."
        >
          <EChart option={options.hour} height={260} ariaLabel="MAE and bias by hour of day" />
        </Card>
        <Card
          title="Error by lead time"
          subtitle="Lead time = hours from publication to the target hour. At a fixed gate, lead time and hour of day move together."
        >
          <EChart
            option={options.horizon}
            height={260}
            ariaLabel="MAE and bias by lead-time bucket"
          />
        </Card>
      </div>

      <Card
        title="Forecast vintage comparison: runs published on D−1"
        subtitle="MAE of each scheduled WINDFOR run for the following delivery day, over the same days. It shows what waiting for a later run would gain."
        actions={
          <Legend
            items={[
              { color: C.forecast, label: 'Available at gate' },
              { color: C.later, label: 'Published after gate' },
            ]}
          />
        }
      >
        <EChart
          option={options.vintage}
          height={260}
          ariaLabel="MAE by forecast publication slot"
        />
        {data.by_vintage.some((v) => v.n_runs_off_schedule) && (
          <p className="mt-2 text-xs text-ink-muted">
            Late runs are counted in the slot they replaced (e.g. a run published at 12:25 instead
            of 11:30).
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Worst five delivery days" subtitle="Ranked by MAE" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm tabular-nums">
              <thead className="text-xs text-ink-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">Delivery day</th>
                  <th className="py-2 pr-3 text-right font-medium">MAE</th>
                  <th className="py-2 pr-3 text-right font-medium">Bias</th>
                  <th className="py-2 pr-3 text-right font-medium">Energy error</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.worst_days.map((d) => (
                  <tr key={d.delivery_date} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-3 text-ink">{fmtShortDay(d.delivery_date)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtMW(d.metrics.mae_mw)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink-secondary">
                      {fmtSignedMW(d.metrics.bias_mw)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink-secondary">
                      {fmtSignedGWh((d.metrics.energy_error_mwh ?? 0) / 1000)}
                    </td>
                    <td className="py-1.5 text-right">
                      <Link
                        to={`/brief?date=${d.decision_date}&gate=${gate}&reveal=1`}
                        className="text-xs text-accent hover:underline"
                      >
                        Open brief →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Uncertainty band check" subtitle="Held-out (leave-one-day-out) coverage">
          {coverage.available && coverage.coverage_pct != null ? (
            <>
              <div className="text-3xl font-semibold text-ink">{fmtPct(coverage.coverage_pct)}</div>
              <p className="mt-1 text-xs text-ink-secondary">
                of {fmtNumber(coverage.n_evaluated)} hours fell inside P10–P90 (nominal{' '}
                {fmtPct(coverage.nominal_pct, 0)}).
              </p>
              <ul className="mt-3 space-y-1 text-xs text-ink-secondary">
                {coverage.by_bucket.map((b) => (
                  <li key={b.label} className="flex justify-between tabular-nums">
                    <span>{b.label}</span>
                    <span>
                      {fmtPct(b.coverage_pct, 0)}{' '}
                      <span className="text-ink-muted">({b.n_evaluated} h)</span>
                    </span>
                  </li>
                ))}
              </ul>
              {coverage.daily_energy.coverage_pct != null && (
                <p className="mt-3 text-xs text-ink-secondary">
                  Daily energy range: {fmtPct(coverage.daily_energy.coverage_pct, 0)} of{' '}
                  {coverage.daily_energy.n_days} days inside P10–P90.
                </p>
              )}
              <p className="mt-3 text-xs text-ink-muted">
                Empirical intervals from one month of data, not a confidence guarantee. Errors
                within a day, and across neighbouring days, are correlated, so coverage on new data
                may be lower.
              </p>
            </>
          ) : (
            <EmptyState title="Not enough history to evaluate a band" />
          )}
        </Card>
      </div>

      <Card title="Data coverage">
        <div className="flex flex-wrap gap-2">
          <StatusPill status={s.n_missing_forecast === 0 ? 'good' : 'warning'}>
            {s.n_missing_forecast} hours without an eligible forecast
          </StatusPill>
          <StatusPill status={s.n_missing_actual === 0 ? 'good' : 'warning'}>
            {s.n_missing_actual} hours without a complete actual
          </StatusPill>
          <Tag tone="neutral">{data.daily.length} delivery days</Tag>
          <Tag tone="neutral">snapshot {data.snapshot.version}</Tag>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Unmatched hours are excluded from every statistic and never filled in.
        </p>
      </Card>
    </>
  );
}
