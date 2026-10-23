import { useMemo } from 'react';

import { useDecision, useMeta } from '../api/hooks';
import type { DecisionResponse, MetaResponse, Revision } from '../api/types';
import { buildDecisionOption } from '../components/charts/decisionChart';
import { EChart } from '../components/charts/EChart';
import { DecisionDatePicker } from '../components/controls/DateControls';
import { GateSelector } from '../components/controls/GateSelector';
import {
  Card,
  ErrorState,
  LoadingState,
  StatTile,
  StatusPill,
  Tag,
  Toggle,
} from '../components/ui/primitives';
import { useUrlPatch } from '../hooks/useUrlState';
import { downloadCsv, toCsv } from '../lib/csv';
import {
  fmtDay,
  fmtGWh,
  fmtHours,
  fmtMW,
  fmtNumber,
  fmtPct,
  fmtSignedGWh,
  fmtSignedMW,
  fmtUkDateTime,
  fmtUkTime,
} from '../lib/format';
import { readDay } from '../lib/insights';
import { parseDateParam, parseGateParam } from '../lib/params';
import { cx } from '../lib/cx';

/** Runs repeating identical values before we flag the feed as stale. */
const STALE_RUNS = 2;

export function DayAheadBrief() {
  const meta = useMeta();
  if (meta.isPending) return <LoadingState label="Loading scope…" />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  return <Brief meta={meta.data} />;
}

function Brief({ meta }: { meta: MetaResponse }) {
  const [params, patch] = useUrlPatch();
  const date = parseDateParam(
    params.get('date'),
    meta.decision_date_min,
    meta.decision_date_max,
    meta.decision_date_min,
  );
  const gate = parseGateParam(params.get('gate'), meta.default_gate);
  const reveal = params.get('reveal') === '1';
  const showRevisions = params.get('revisions') !== '0';
  const query = useDecision(date, gate);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Day-Ahead Brief</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          The latest wind forecast that was available at gate closure, with its expected error. Turn
          on <em>Reveal actuals</em> to compare it with what was actually generated.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
        <DecisionDatePicker
          value={date}
          min={meta.decision_date_min}
          max={meta.decision_date_max}
          onChange={(d) => patch({ date: d })}
        />
        <GateSelector
          presets={meta.gate_presets}
          value={gate}
          onChange={(g) => patch({ gate: g })}
        />
        <div className="flex flex-wrap items-center gap-5 pb-1">
          <Toggle
            checked={reveal}
            onChange={(v) => patch({ reveal: v ? '1' : null })}
            label="Reveal actuals"
            description="hindsight"
            tone="hindsight"
          />
          <Toggle
            checked={showRevisions}
            onChange={(v) => patch({ revisions: v ? null : '0' })}
            label="Forecast revisions"
          />
        </div>
      </div>

      {query.isPending && <LoadingState label="Selecting the forecast available at the gate…" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <div
          className={cx('space-y-4 transition-opacity', query.isPlaceholderData && 'opacity-60')}
        >
          <BriefBody data={query.data} reveal={reveal} showRevisions={showRevisions} />
        </div>
      )}
    </div>
  );
}

function BriefBody({
  data,
  reveal,
  showRevisions,
}: {
  data: DecisionResponse;
  reveal: boolean;
  showRevisions: boolean;
}) {
  const option = useMemo(
    () => buildDecisionOption(data, { reveal, showRevisions }),
    [data, reveal, showRevisions],
  );
  const { forecast, typical_error: typical, data_quality: dq, hindsight_metrics: hm } = data;
  const reading = readDay(data);

  return (
    <>
      <Card tone="decision">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-ink-muted">Decision</span>{' '}
            <span className="font-medium text-ink">{fmtDay(data.decision_date)}</span>
            <span className="text-ink-muted">, gate {data.gate.gate} UK</span>
            {data.gate.preset_label && (
              <span className="text-ink-muted"> ({data.gate.preset_label})</span>
            )}
          </div>
          <div aria-hidden className="text-ink-muted">
            →
          </div>
          <div>
            <span className="text-ink-muted">Delivery</span>{' '}
            <span className="font-medium text-ink">{fmtDay(data.delivery_date)}</span>
            <span className="text-ink-muted">, 00:00–24:00 UK</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {forecast ? (
            <span className="text-ink-secondary">
              Forecast used: published{' '}
              <span className="text-ink">{fmtUkDateTime(forecast.primary_publish_time)} UK</span>
              {forecast.publish_times.length > 1 &&
                ` (+${forecast.publish_times.length - 1} earlier runs for some hours)`}{' '}
              · lead time {fmtHours(forecast.horizon_min_h)}–{fmtHours(forecast.horizon_max_h)}
            </span>
          ) : (
            <span className="text-warning">No forecast had been published before this gate.</span>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            {forecast && forecast.repeated_runs >= STALE_RUNS && (
              <StatusPill
                status="warning"
                title="Consecutive WINDFOR runs published identical values for this delivery day, so the forecast had not been refreshed. A live version would alert the desk."
              >
                Stale feed: values unchanged since {fmtUkDateTime(forecast.unchanged_since)} UK (
                {forecast.repeated_runs} repeated runs)
              </StatusPill>
            )}
            <StatusPill status={dq.hours_with_forecast === dq.expected_hours ? 'good' : 'warning'}>
              Forecast {dq.hours_with_forecast}/{dq.expected_hours} h
            </StatusPill>
            <StatusPill
              status={dq.hours_with_complete_actual === dq.expected_hours ? 'good' : 'warning'}
              title={
                dq.incomplete_actual_hours.length
                  ? `Incomplete: ${dq.incomplete_actual_hours.map((t) => fmtUkTime(t)).join(', ')}`
                  : undefined
              }
            >
              Actuals {dq.hours_with_complete_actual}/{dq.expected_hours} h complete
            </StatusPill>
          </span>
        </div>
      </Card>

      <section aria-labelledby="known-heading">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="known-heading" className="text-sm font-semibold text-ink">
            Known at gate closure
          </h2>
          <Tag tone="decision">decision-time information</Tag>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            emphasis
            label="Forecast wind energy, delivery day"
            value={fmtGWh(forecast?.energy_gwh)}
            detail={
              forecast?.band_p10_energy_gwh != null
                ? `P10–P90: ${fmtNumber(forecast.band_p10_energy_gwh, 0)}–${fmtGWh(forecast.band_p90_energy_gwh, 0)}`
                : 'Uncertainty band unavailable'
            }
          />
          <StatTile
            label="Peak forecast"
            value={fmtMW(forecast?.peak_mw)}
            detail={forecast ? `at ${fmtUkTime(forecast.peak_time)} UK` : undefined}
          />
          <StatTile
            label="Minimum forecast"
            value={fmtMW(forecast?.min_mw)}
            detail={forecast ? `at ${fmtUkTime(forecast.min_time)} UK` : undefined}
          />
          <StatTile
            label="Typical error at this lead time"
            value={fmtMW(typical.mae_mw)}
            detail={`MAE · P90 ${fmtMW(typical.p90_abs_error_mw)} · bias ${fmtSignedMW(typical.bias_mw)} (${typical.n_days} other days)`}
          />
        </div>
      </section>

      {reveal ? (
        <section aria-labelledby="hindsight-heading">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id="hindsight-heading" className="text-sm font-semibold text-ink">
              What actually happened
            </h2>
            <Tag tone="hindsight">hindsight, not available at decision time</Tag>
            {reading && <span className="text-xs text-ink-secondary">{reading.label}</span>}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Actual wind energy"
              value={fmtGWh(hm.actual_energy_mwh != null ? hm.actual_energy_mwh / 1000 : null)}
              detail={`over ${hm.n_matched} matched hours`}
            />
            <StatTile
              label="Energy error (forecast − actual)"
              value={fmtSignedGWh(hm.energy_error_mwh != null ? hm.energy_error_mwh / 1000 : null)}
              detail={
                hm.actual_energy_mwh
                  ? `${fmtPct((100 * (hm.energy_error_mwh ?? 0)) / hm.actual_energy_mwh)} of actual`
                  : undefined
              }
            />
            <StatTile
              label="MAE, this day"
              value={fmtMW(hm.mae_mw)}
              detail={`RMSE ${fmtMW(hm.rmse_mw)}`}
            />
            <StatTile
              label="Bias, this day"
              value={fmtSignedMW(hm.bias_mw)}
              detail={`max miss ${fmtMW(hm.max_abs_error_mw)}`}
            />
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-edge px-4 py-3 text-sm text-ink-muted">
          Actuals are hidden. This view shows only what was known at {data.gate.gate} UK on{' '}
          {fmtDay(data.decision_date)}. Turn on{' '}
          <span className="text-ink-secondary">Reveal actuals</span> to see how the forecast
          performed.
        </div>
      )}

      <Card
        title="Delivery-day wind generation (UK time)"
        subtitle={
          data.band.available
            ? 'Shaded: P10–P90 range from other January days’ errors at the same lead time. It is an empirical range, not a guarantee.'
            : (data.band.reason ?? undefined)
        }
      >
        <EChart
          option={option}
          height={340}
          ariaLabel={`Forecast${reveal ? ' and actual' : ''} wind generation for ${data.delivery_date}`}
        />
      </Card>

      {showRevisions && <RevisionTable revisions={data.revisions} reveal={reveal} />}
      <ObservationTable data={data} reveal={reveal} />
    </>
  );
}

function RevisionTable({ revisions, reveal }: { revisions: Revision[]; reveal: boolean }) {
  const selected = revisions.find((r) => r.is_selected);
  const visible = revisions.filter((r) => r.available_at_decision || reveal);
  return (
    <Card
      title="Forecast revision history"
      subtitle="Every WINDFOR run published before delivery that covers the delivery day. Runs after the gate appear only with Reveal actuals."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm tabular-nums">
          <thead className="text-xs text-ink-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-4 font-medium">Published (UK)</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 text-right font-medium">Hours covered</th>
              <th className="py-2 pr-4 text-right font-medium">Energy (covered hours)</th>
              <th className="py-2 text-right font-medium">vs. selected, same hours</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const delta = selected && !r.is_selected ? diffEnergy(r, selected) : null;
              return (
                <tr key={r.publish_time} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-4 text-ink">{fmtUkDateTime(r.publish_time)}</td>
                  <td className="py-1.5 pr-4">
                    {r.is_selected ? (
                      <Tag tone="decision">selected at gate</Tag>
                    ) : r.available_at_decision ? (
                      <Tag tone="neutral">earlier, available</Tag>
                    ) : (
                      <Tag tone="later">after gate</Tag>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-ink-secondary">{r.n_points}</td>
                  <td className="py-1.5 pr-4 text-right text-ink-secondary">
                    {fmtGWh(r.energy_mwh / 1000)}
                  </td>
                  <td className="py-1.5 text-right text-ink-secondary">
                    {delta == null ? '—' : fmtSignedGWh(delta / 1000)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Energy difference (MWh) between two runs over the hours both cover. */
function diffEnergy(run: Revision, reference: Revision): number | null {
  const ref = new Map(reference.points.map((p) => [p.start_time, p.forecast_mw]));
  let sum = 0;
  let n = 0;
  for (const p of run.points) {
    const other = ref.get(p.start_time);
    if (other != null) {
      sum += p.forecast_mw - other;
      n += 1;
    }
  }
  return n ? sum : null;
}

function ObservationTable({ data, reveal }: { data: DecisionResponse; reveal: boolean }) {
  const exportCsv = () => {
    const headers = [
      'start_time_utc',
      'start_time_uk',
      'forecast_mw',
      'forecast_publish_time_utc',
      'lead_time_h',
      'band_p10_mw',
      'band_p90_mw',
      ...(reveal
        ? ['actual_hourly_mean_mw', 'actual_first_half_hour_mw', 'actual_status', 'error_mw']
        : []),
    ];
    const rows = data.rows.map((r) => [
      r.start_time,
      fmtUkDateTime(r.start_time),
      r.forecast_mw,
      r.publish_time,
      r.horizon_h,
      r.band_p10_mw?.toFixed(1),
      r.band_p90_mw?.toFixed(1),
      ...(reveal ? [r.actual_mw, r.actual_first_half_mw, r.actual_status, r.error_mw] : []),
    ]);
    downloadCsv(
      `winddesk_decision_${data.decision_date}_gate-${data.gate.gate.replace(':', '')}${reveal ? '_with-actuals' : ''}.csv`,
      toCsv(headers, rows),
    );
  };

  return (
    <Card
      title="Hourly observations"
      subtitle="Actual = mean of the two half-hourly outturns in each hour. Error = forecast − actual (positive = over-forecast)."
      actions={
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-md bg-raised px-3 py-1.5 text-xs text-ink ring-1 ring-edge hover:bg-edge"
        >
          Export CSV
        </button>
      }
    >
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[720px] text-left text-sm tabular-nums">
          <thead className="sticky top-0 bg-surface text-xs text-ink-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Hour (UK)</th>
              <th className="py-2 pr-3 text-right font-medium text-[#7fd6ea]">Forecast</th>
              <th className="py-2 pr-3 font-medium">Published (UK)</th>
              <th className="py-2 pr-3 text-right font-medium">Lead</th>
              <th className="py-2 pr-3 text-right font-medium">P10–P90</th>
              {reveal && (
                <>
                  <th className="py-2 pr-3 text-right font-medium text-[#f0c36b]">Actual</th>
                  <th className="py-2 pr-3 text-right font-medium text-[#f0c36b]">Error</th>
                  <th className="py-2 font-medium text-[#f0c36b]">Actual status</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.start_time} className="border-b border-line/50 last:border-0">
                <td className="py-1.5 pr-3 text-ink">
                  {fmtUkTime(r.start_time)}–{fmtUkTime(r.end_time)}
                </td>
                <td className="py-1.5 pr-3 text-right text-ink">{fmtNumber(r.forecast_mw)}</td>
                <td className="py-1.5 pr-3 text-ink-secondary">{fmtUkDateTime(r.publish_time)}</td>
                <td className="py-1.5 pr-3 text-right text-ink-secondary">
                  {fmtHours(r.horizon_h)}
                </td>
                <td className="py-1.5 pr-3 text-right text-ink-secondary">
                  {r.band_p10_mw == null
                    ? '—'
                    : `${fmtNumber(r.band_p10_mw)}–${fmtNumber(r.band_p90_mw)}`}
                </td>
                {reveal && (
                  <>
                    <td className="py-1.5 pr-3 text-right text-ink">{fmtNumber(r.actual_mw)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">
                      {fmtSignedMW(r.error_mw).replace(' MW', '')}
                    </td>
                    <td className="py-1.5 text-ink-secondary">
                      {r.actual_status === 'complete'
                        ? 'complete'
                        : `${r.actual_status} (${r.actual_half_hours}/2 half-hours)`}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        All values in MW. Timestamps in UK local time; the API and CSV also give UTC.
      </p>
    </Card>
  );
}
