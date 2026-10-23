import { useCallback, useMemo } from 'react';

import { useDecision, useMeta } from '../api/hooks';
import type { DecisionResponse, MetaResponse, Revision } from '../api/types';
import { buildDecisionOption } from '../components/charts/decisionChart';
import { EChart } from '../components/charts/EChart';
import { DecisionDatePicker } from '../components/controls/DateControls';
import { GateSelector } from '../components/controls/GateSelector';
import { ProcurementWhatIf } from '../components/ProcurementWhatIf';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageSkeleton,
  StatTile,
  StatusPill,
  Tag,
  Toggle,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useUrlPatch } from '../hooks/useUrlState';
import { downloadCsv } from '../lib/csv';
import { decisionCsv } from '../lib/exports';
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
import { parsePlanInputs, planProcurement, type ProcurementPlan } from '../lib/procurement';
import { cx } from '../lib/cx';

/** Runs repeating identical values before we flag the feed as stale. */
const STALE_RUNS = 2;

export function DayAheadBrief() {
  useDocumentTitle('Day-Ahead Brief');
  const meta = useMeta();
  if (meta.isPending) return <PageSkeleton label="Loading scope…" />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  return <Brief meta={meta.data} />;
}

function Brief({ meta }: { meta: MetaResponse }) {
  const [params, patch] = useUrlPatch();
  // Default to the latest decision: it has the most completed January history behind it.
  const date = parseDateParam(
    params.get('date'),
    meta.decision_date_min,
    meta.decision_date_max,
    meta.decision_date_max,
  );
  const gate = parseGateParam(params.get('gate'), meta.default_gate);
  const reveal = params.get('reveal') === '1';
  const showRevisions = params.get('revisions') !== '0';
  const demand = params.get('demand') ?? '';
  const share = params.get('share') ?? '100';
  const query = useDecision(date, gate);
  const setWhatIf = useCallback(
    (values: { demand?: string; share?: string }) => {
      const next: Record<string, string | null> = {};
      if (values.demand !== undefined) next.demand = values.demand.trim() || null;
      if (values.share !== undefined) {
        const v = values.share.trim();
        next.share = v === '' || v === '100' ? null : v;
      }
      patch(next);
    },
    [patch],
  );

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

      {query.isPending && <PageSkeleton label="Selecting the forecast available at the gate…" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <div
          className={cx('space-y-4 transition-opacity', query.isPlaceholderData && 'opacity-60')}
        >
          <BriefBody
            data={query.data}
            reveal={reveal}
            showRevisions={showRevisions}
            demand={demand}
            share={share}
            onWhatIfChange={setWhatIf}
          />
        </div>
      )}
    </div>
  );
}

function BriefBody({
  data,
  reveal,
  showRevisions,
  demand,
  share,
  onWhatIfChange,
}: {
  data: DecisionResponse;
  reveal: boolean;
  showRevisions: boolean;
  demand: string;
  share: string;
  onWhatIfChange: (values: { demand?: string; share?: string }) => void;
}) {
  const inputs = parsePlanInputs(demand, share);
  const plan = useMemo(
    () =>
      inputs.demandMw == null ? null : planProcurement(data.rows, inputs.demandMw, inputs.sharePct),
    [data.rows, inputs.demandMw, inputs.sharePct],
  );
  const option = useMemo(
    () => buildDecisionOption(data, { reveal, showRevisions }),
    [data, reveal, showRevisions],
  );
  const {
    forecast,
    typical_error: pilot,
    typical_error_known_at_gate: known,
    hindsight_metrics: hm,
  } = data;
  const reading = readDay(data);
  const partial = forecast != null && forecast.hours_with_forecast < forecast.hours_expected;

  return (
    <>
      <Headline data={data} />

      <section aria-labelledby="known-heading">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="known-heading" className="text-sm font-semibold text-ink">
            Known at gate closure
          </h2>
          <Tag tone="decision">decision-time information</Tag>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            emphasis
            label="Forecast wind energy"
            value={fmtGWh(forecast?.energy_gwh)}
            hint={
              <>
                Sum of the hourly forecast (MW × 1 h) for the delivery day. The P10–P90 range is the
                10th–90th percentile of <em>daily</em> energy errors on other fully forecast January
                days at this gate. It is a pilot calibration that includes days after this decision,
                not a guarantee.
              </>
            }
            detail={
              partial ? (
                <span className="text-warning">
                  Partial: {forecast.hours_with_forecast} of {forecast.hours_expected} h forecast
                </span>
              ) : forecast?.band_p10_energy_gwh != null ? (
                `P10–P90 ${fmtNumber(forecast.band_p10_energy_gwh, 0)}–${fmtGWh(forecast.band_p90_energy_gwh, 0)} (${forecast.energy_band_n_days} other days)`
              ) : (
                'Daily range unavailable (too few complete days)'
              )
            }
          />
          <StatTile
            label="Peak forecast"
            value={fmtMW(forecast?.peak_mw)}
            detail={forecast ? `at ${fmtUkTime(forecast.peak_time)} UK` : undefined}
            hint="Highest hourly forecast value for the delivery day."
          />
          <StatTile
            label="Minimum forecast"
            value={fmtMW(forecast?.min_mw)}
            detail={forecast ? `at ${fmtUkTime(forecast.min_time)} UK` : undefined}
            hint="Lowest hourly forecast value for the delivery day."
          />
          <StatTile
            label="Typical error, known at gate"
            value={fmtMW(known.mae_mw)}
            hint={
              <>
                Mean absolute hourly error at the same gate and lead times, using only January
                delivery days that had ended before this decision. The second figure uses every
                other January day, including later ones. It is shown for pilot calibration only.
              </>
            }
            detail={
              known.n_days > 0
                ? `MAE over ${known.n_days} completed day${known.n_days === 1 ? '' : 's'}, bias ${fmtSignedMW(known.bias_mw)} · all other days ${fmtMW(pilot.mae_mw)}`
                : `No completed January days yet · all other days ${fmtMW(pilot.mae_mw)}`
            }
          />
        </div>
      </section>

      <ProcurementWhatIf
        data={data}
        reveal={reveal}
        plan={plan}
        demand={demand}
        share={share}
        onChange={onWhatIfChange}
      />

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
              hint="Sum of hourly mean outturn (FUELHH WIND) over hours that have both a forecast and a complete actual."
            />
            <StatTile
              label="Energy error"
              value={fmtSignedGWh(hm.energy_error_mwh != null ? hm.energy_error_mwh / 1000 : null)}
              detail={
                hm.actual_energy_mwh
                  ? `forecast − actual · ${fmtPct((100 * (hm.energy_error_mwh ?? 0)) / hm.actual_energy_mwh)} of actual`
                  : 'forecast − actual'
              }
              hint="Forecast energy minus actual energy over matched hours. Positive means more wind was forecast than arrived."
            />
            <StatTile
              label="MAE, this day"
              value={fmtMW(hm.mae_mw)}
              detail={`RMSE ${fmtMW(hm.rmse_mw)}`}
              hint="Mean absolute error: the average size of the hourly miss, ignoring direction. RMSE weights large misses more."
            />
            <StatTile
              label="Bias, this day"
              value={fmtSignedMW(hm.bias_mw)}
              detail={`max miss ${fmtMW(hm.max_abs_error_mw)}`}
              hint="Mean signed error (forecast − actual). Positive = over-forecast on average."
            />
          </div>
        </section>
      ) : (
        <EmptyState title="Actuals are hidden">
          This view shows only what was known at {data.gate.gate} UK on {fmtDay(data.decision_date)}
          . Turn on <span className="text-ink-secondary">Reveal actuals</span> to see how the
          forecast performed.
        </EmptyState>
      )}

      <Card
        title="Delivery-day wind generation (UK time)"
        subtitle={
          data.band.available
            ? 'Shaded: hourly P10–P90 from other January days’ errors at the same lead time (pilot calibration; includes later days). An empirical range, not a guarantee.'
            : (data.band.reason ?? undefined)
        }
      >
        {forecast || reveal ? (
          <EChart
            option={option}
            height={340}
            ariaLabel={`Forecast${reveal ? ' and actual' : ''} wind generation for ${data.delivery_date}`}
          />
        ) : (
          <EmptyState title="Nothing to plot">
            No forecast run published before {data.gate.gate} UK covers this delivery day. Try a
            later gate.
          </EmptyState>
        )}
      </Card>

      {showRevisions && <RevisionTable revisions={data.revisions} reveal={reveal} />}
      <ObservationTable data={data} reveal={reveal} plan={plan} />
    </>
  );
}

function Headline({ data }: { data: DecisionResponse }) {
  const { forecast, typical_error_known_at_gate: known, data_quality: dq } = data;
  const partial = forecast != null && forecast.hours_with_forecast < forecast.hours_expected;
  return (
    <Card tone="decision">
      <p className="text-base leading-relaxed text-ink-secondary">
        At{' '}
        <strong className="text-ink">
          {data.gate.gate} UK on {fmtDay(data.decision_date)}
        </strong>
        {data.gate.preset_label && (
          <span className="text-ink-muted"> ({data.gate.preset_label})</span>
        )}
        {forecast ? (
          <>
            , the latest forecast (published{' '}
            <strong className="text-ink">{fmtUkDateTime(forecast.primary_publish_time)} UK</strong>)
            expected <strong className="text-ink">{fmtGWh(forecast.energy_gwh)}</strong> of wind
            {partial &&
              ` over ${forecast.hours_with_forecast} of ${forecast.hours_expected} hours`}{' '}
            for <strong className="text-ink">{fmtDay(data.delivery_date)}</strong> (00:00–24:00 UK).
          </>
        ) : (
          <>
            , no forecast run covered{' '}
            <strong className="text-ink">{fmtDay(data.delivery_date)}</strong>.
          </>
        )}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {known.n_days > 0
          ? `On the ${known.n_days} January delivery day${known.n_days === 1 ? '' : 's'} completed before this decision, forecasts at the same lead time missed by ${fmtMW(known.mae_mw)} an hour on average (bias ${fmtSignedMW(known.bias_mw)}).`
          : 'No January delivery day had finished before this decision, so there is no error history from the pilot yet.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {forecast && (
          <Tag tone="neutral">
            lead time {fmtHours(forecast.horizon_min_h)}–{fmtHours(forecast.horizon_max_h)}
            {forecast.publish_times.length > 1 &&
              ` · ${forecast.publish_times.length} runs (fallback for some hours)`}
          </Tag>
        )}
        {forecast && forecast.repeated_runs >= STALE_RUNS && (
          <StatusPill
            status="warning"
            title="Consecutive WINDFOR runs published identical values for this delivery day, so the forecast had not been refreshed. A live version would alert the desk."
          >
            Stale feed: values unchanged since {fmtUkDateTime(forecast.unchanged_since)} UK (
            {forecast.repeated_runs} repeated runs)
          </StatusPill>
        )}
        <StatusPill
          status={dq.hours_with_forecast === dq.expected_hours ? 'good' : 'warning'}
          title={
            dq.missing_forecast_hours.length
              ? `No forecast for: ${dq.missing_forecast_hours.map((t) => fmtUkTime(t)).join(', ')} UK`
              : undefined
          }
        >
          Forecast {dq.hours_with_forecast}/{dq.expected_hours} h
        </StatusPill>
        <StatusPill
          status={dq.hours_with_complete_actual === dq.expected_hours ? 'good' : 'warning'}
          title={
            dq.incomplete_actual_hours.length
              ? `Incomplete: ${dq.incomplete_actual_hours.map((t) => fmtUkTime(t)).join(', ')} UK`
              : undefined
          }
        >
          Actuals {dq.hours_with_complete_actual}/{dq.expected_hours} h complete
        </StatusPill>
      </div>
    </Card>
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

function ObservationTable({
  data,
  reveal,
  plan,
}: {
  data: DecisionResponse;
  reveal: boolean;
  plan: ProcurementPlan | null;
}) {
  const exportCsv = () => {
    const { filename, csv } = decisionCsv(data, reveal, plan);
    downloadCsv(filename, csv);
  };

  return (
    <Card
      title="Hourly observations"
      subtitle="Actual = mean of the two half-hourly outturns in each hour. Error = forecast − actual (positive = over-forecast)."
      actions={
        <Button onClick={exportCsv} aria-label="Export hourly observations as CSV">
          Export CSV
        </Button>
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
              {plan && (
                <>
                  <th className="py-2 pr-3 text-right font-medium">Buy if forecast</th>
                  <th className="py-2 pr-3 text-right font-medium">Buy if P10 wind</th>
                </>
              )}
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
            {data.rows.map((r, i) => (
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
                {plan && (
                  <>
                    <td className="py-1.5 pr-3 text-right text-ink">
                      {fmtNumber(plan.hours[i]?.buy_forecast_mw)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink-secondary">
                      {fmtNumber(plan.hours[i]?.buy_low_wind_mw)}
                    </td>
                  </>
                )}
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
        All values in MW. Times in UK local time; the CSV has UK and UTC timestamps and matches this
        table row for row.
      </p>
    </Card>
  );
}
