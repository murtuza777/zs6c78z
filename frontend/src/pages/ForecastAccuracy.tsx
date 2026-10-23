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
import { C } from '../components/charts/theme';
import { DateRangeFields } from '../components/controls/DateControls';
import { GateSelector } from '../components/controls/GateSelector';
import {
  Card,
  ErrorState,
  Legend,
  LoadingState,
  StatTile,
  StatusPill,
  Tag,
} from '../components/ui/primitives';
import { useUrlPatch } from '../hooks/useUrlState';
import { fmtMW, fmtNumber, fmtPct, fmtShortDay, fmtSignedGWh, fmtSignedMW } from '../lib/format';
import { overForecastShare, vintageTradeOff } from '../lib/insights';
import { parseDateParam, parseGateParam } from '../lib/params';
import { cx } from '../lib/cx';

export function ForecastAccuracy() {
  const meta = useMeta();
  if (meta.isPending) return <LoadingState label="Loading scope…" />;
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
      {query.isPending && <LoadingState label="Scoring every decision…" />}
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
  const overShare = overForecastShare(data.scatter);
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
          {s.bias_mw != null && overShare != null && (
            <li>
              The forecast was <span className="text-ink">{s.bias_mw > 0 ? 'above' : 'below'}</span>{' '}
              actual output in <span className="text-ink">{fmtPct(overShare, 0)}</span> of hours.
              The average bias was <span className="text-ink">{fmtSignedMW(s.bias_mw)}</span> and
              the total energy error was{' '}
              <span className="text-ink">{fmtSignedGWh((s.energy_error_mwh ?? 0) / 1000, 0)}</span>.
              {s.bias_mw > 0 && ' Planning on the raw forecast would have overstated wind supply.'}
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
              The P10–P90 band contained the actual in{' '}
              <span className="text-ink">{fmtPct(coverage.coverage_pct)}</span> of held-out hours,
              against a nominal {fmtPct(coverage.nominal_pct, 0)}.
            </li>
          )}
        </ul>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile emphasis label="MAE" value={fmtMW(s.mae_mw)} />
        <StatTile label="RMSE" value={fmtMW(s.rmse_mw)} />
        <StatTile label="Bias (mean error)" value={fmtSignedMW(s.bias_mw)} />
        <StatTile label="WAPE" value={fmtPct(s.wape_pct)} detail="Σ|error| / Σ actual" />
        <StatTile
          label="P90 absolute error"
          value={fmtMW(s.p90_abs_error_mw)}
          detail={`P50 ${fmtMW(s.p50_abs_error_mw)}`}
        />
        <StatTile
          label="P99 / max error"
          value={fmtMW(s.p99_abs_error_mw)}
          detail={`max ${fmtMW(s.max_abs_error_mw)}`}
        />
        <StatTile label="Correlation" value={fmtNumber(s.correlation, 3)} detail="Pearson r" />
        <StatTile
          label="Matched hours"
          value={`${s.n_matched}/${s.n_expected}`}
          detail={
            <StatusPill status={s.n_matched === s.n_expected ? 'good' : 'warning'}>
              {fmtPct(s.coverage_pct)} coverage
            </StatusPill>
          }
        />
      </div>

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
              <p className="mt-3 text-xs text-ink-muted">
                This is an empirical interval from one month of data, not a confidence guarantee.
                Errors within a day are correlated.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Not enough history to evaluate a band.</p>
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
