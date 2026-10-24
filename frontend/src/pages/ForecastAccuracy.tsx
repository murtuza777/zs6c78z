import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { useAccuracy, useMeta } from '../api/hooks';
import type { AccuracyResponse, MetaResponse } from '../api/types';
import { forecastAgeOption, histogramOption } from '../components/charts/accuracyCharts';
import { EChart } from '../components/charts/EChart';
import { buildTimelineOption } from '../components/charts/timelineChart';
import { C } from '../components/charts/theme';
import { DateRangeFields } from '../components/controls/DateControls';
import { GateSelector } from '../components/controls/GateSelector';
import { Card, ErrorState, Legend, PageSkeleton, StatTile } from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useUrlPatch } from '../hooks/useUrlState';
import {
  fmtGWh,
  fmtHours,
  fmtMW,
  fmtNumber,
  fmtPct,
  fmtShortDay,
  fmtSignedGWh,
  fmtSignedMW,
} from '../lib/format';
import { errorDirection, gateLeadRange } from '../lib/insights';
import { parseDateParam, parseGateParam } from '../lib/params';
import { cx } from '../lib/cx';

export function ForecastAccuracy() {
  useDocumentTitle('Accuracy');
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
        <h1 className="text-xl font-semibold text-ink">Forecast accuracy</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The forecast you had at the gate against what was generated, every hour. Error = forecast
          − actual, so positive means less wind arrived than forecast.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <GateSelector
          presets={meta.gate_presets}
          value={gate}
          onChange={(g) => patch({ gate: g })}
        />
        <DateRangeFields
          label="Decision days"
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
  const s = data.summary;
  const coverage = data.band_coverage;
  const direction = errorDirection(data.scatter);
  // Both fields are absent in responses from older API builds: hide those charts, don't crash.
  const timeline = data.timeline ?? [];
  const ages = data.by_forecast_age ?? [];
  const options = useMemo(() => {
    const points = data.timeline ?? [];
    return {
      timeline: points.length
        ? buildTimelineOption(points, { forecastName: 'Forecast at gate' })
        : null,
      ages: data.by_forecast_age?.length
        ? forecastAgeOption(data.by_forecast_age, gateLeadRange(points))
        : null,
      histogram: histogramOption(data.histogram),
    };
  }, [data]);
  const freshest = ages[0];
  // Older runs stop covering some hours; compare only ages scored on the same hours.
  const oldest = ages.filter((a) => a.n_matched === freshest?.n_matched).at(-1);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile emphasis label="Typical hourly miss (MAE)" value={fmtMW(s.mae_mw)} />
        <StatTile
          label="Bias"
          value={fmtSignedMW(s.bias_mw)}
          detail={
            s.bias_mw == null
              ? undefined
              : s.bias_mw >= 0
                ? 'forecast ran high'
                : 'forecast ran low'
          }
        />
        <StatTile
          label="9 in 10 hours missed by less than"
          value={fmtMW(s.p90_abs_error_mw)}
          detail={`worst hour ${fmtMW(s.max_abs_error_mw)}`}
        />
        <StatTile
          label="Actual inside the P10–P90 range"
          value={fmtPct(coverage.coverage_pct, 0)}
          detail={`of held-out hours, target ${fmtPct(coverage.nominal_pct, 0)}`}
        />
      </div>

      {direction && s.bias_mw != null && s.energy_error_mwh != null && (
        <p className="text-sm text-ink-secondary">
          {Math.abs(s.bias_mw) < 0.25 * (s.mae_mw ?? 0) ? (
            <>
              Errors went both ways: the forecast was high in {fmtPct(direction.overPct, 0)} of
              hours and low in {fmtPct(direction.underPct, 0)}.
            </>
          ) : (
            <>
              The forecast was{' '}
              <strong className="text-ink">
                {s.bias_mw > 0 ? 'too high' : 'too low'} in{' '}
                {fmtPct(s.bias_mw > 0 ? direction.overPct : direction.underPct, 0)} of hours
              </strong>
              . Buying on it as-is would have counted on{' '}
              {fmtGWh(Math.abs(s.energy_error_mwh) / 1000, 0)} {s.bias_mw > 0 ? 'more' : 'less'}{' '}
              wind than arrived over these {data.daily.length} days.
            </>
          )}
        </p>
      )}

      {options.timeline && (
        <Card
          title="Forecast at the gate vs actual"
          subtitle="Drag the slider or scroll to zoom. Gaps are hours without a forecast or a complete actual."
        >
          <EChart
            option={options.timeline}
            height={340}
            ariaLabel={`Hourly forecast available at ${data.gate.gate} and actual wind generation, ${timeline.length} hours`}
          />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {options.ages && (
          <Card
            title="Error vs forecast age"
            subtitle={
              freshest?.mae_mw != null && oldest?.mae_mw != null && oldest !== freshest
                ? `MAE grows from ${fmtMW(freshest.mae_mw)} with the freshest run to ${fmtMW(oldest.mae_mw)} for runs ${fmtHours(oldest.age_h)} old.`
                : 'The same delivery hours scored with older and older forecasts.'
            }
          >
            <EChart
              option={options.ages}
              height={280}
              ariaLabel="MAE and bias against minimum forecast age"
            />
          </Card>
        )}
        <Card
          title="Error distribution"
          subtitle={`Hours per ${fmtNumber(data.histogram_bin_width_mw)} MW error bin.`}
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
      </div>

      <Card title="Worst days" subtitle="Ranked by MAE. Open one to see the forecast and actuals.">
        {/* relative: keeps the visually hidden header inside the scroll box on phones */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm tabular-nums">
            <thead className="text-xs text-ink-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Delivery day</th>
                <th className="py-2 pr-3 text-right font-medium">MAE</th>
                <th className="py-2 pr-3 text-right font-medium">Bias</th>
                <th className="py-2 pr-3 text-right font-medium">Energy error</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Open</span>
                </th>
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
                      Open day →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-ink-muted">
        {s.n_matched} of {s.n_expected} hours scored
        {s.n_matched < s.n_expected &&
          ` (${s.n_missing_forecast} without a forecast at the gate, ${s.n_missing_actual} without a complete actual; never filled in)`}
        . RMSE {fmtMW(s.rmse_mw)}, WAPE {fmtPct(s.wape_pct)}.
      </p>
    </>
  );
}
