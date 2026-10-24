import { useCallback, useMemo } from 'react';

import { useDecision, useMeta } from '../api/hooks';
import type { DecisionResponse, MetaResponse } from '../api/types';
import { buildDecisionOption } from '../components/charts/decisionChart';
import { EChart } from '../components/charts/EChart';
import { DecisionDatePicker } from '../components/controls/DateControls';
import { GateSelector } from '../components/controls/GateSelector';
import { ProcurementWhatIf } from '../components/ProcurementWhatIf';
import { Button, Card, ErrorState, PageSkeleton, Toggle } from '../components/ui/primitives';
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
  fmtSignedMW,
  fmtUkDateTime,
  fmtUkTime,
} from '../lib/format';
import { parseDateParam, parseGateParam } from '../lib/params';
import { parsePlanInputs, planProcurement, type ProcurementPlan } from '../lib/procurement';
import { cx } from '../lib/cx';

/** Runs repeating identical values before we flag the feed as stale. */
const STALE_RUNS = 2;
/** What-if demand shown until the user enters their own (an empty `demand=` turns it off). */
const DEFAULT_DEMAND = '30000';

export function DayAheadBrief() {
  useDocumentTitle('Day-Ahead');
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
  const demand = params.get('demand') ?? DEFAULT_DEMAND;
  const share = params.get('share') ?? '100';
  const query = useDecision(date, gate);
  const setWhatIf = useCallback(
    (values: { demand?: string; share?: string }) => {
      const next: Record<string, string | null> = {};
      if (values.demand !== undefined) {
        const v = values.demand.trim();
        next.demand = v === DEFAULT_DEMAND ? null : v;
      }
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
        <h1 className="text-xl font-semibold text-ink">Day-ahead wind</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The latest wind forecast you had when the day-ahead purchase was due, and how far to trust
          it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
        <Toggle
          checked={reveal}
          onChange={(v) => patch({ reveal: v ? '1' : null })}
          label="Show actuals"
          tone="hindsight"
        />
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
  demand,
  share,
  onWhatIfChange,
}: {
  data: DecisionResponse;
  reveal: boolean;
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
  const option = useMemo(() => buildDecisionOption(data, { reveal }), [data, reveal]);

  return (
    <>
      <Headline data={data} reveal={reveal} />

      <Card>
        {data.forecast || reveal ? (
          <EChart
            option={option}
            height={340}
            ariaLabel={`Forecast${reveal ? ' and actual' : ''} wind generation for ${data.delivery_date}`}
          />
        ) : (
          <p className="py-16 text-center text-sm text-ink-muted">
            Nothing to plot before delivery. Try a later gate.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          {data.band.available
            ? 'Shaded: P10–P90, from how forecasts at the same lead time missed on other January days. '
            : data.band.reason
              ? `${data.band.reason} `
              : ''}
          Earlier runs can be switched on in the legend.
        </p>
      </Card>

      <ProcurementWhatIf
        plan={plan}
        totalHours={data.rows.length}
        reveal={reveal}
        demand={demand}
        share={share}
        onChange={onWhatIfChange}
      />

      <HourlyData data={data} reveal={reveal} plan={plan} />
    </>
  );
}

function Headline({ data, reveal }: { data: DecisionResponse; reveal: boolean }) {
  const { forecast, typical_error_known_at_gate: known, typical_error: pilot } = data;
  const hm = data.hindsight_metrics;
  const partial = forecast != null && forecast.hours_with_forecast < forecast.hours_expected;
  const stale = forecast != null && forecast.repeated_runs >= STALE_RUNS;
  const missingActuals =
    data.data_quality.expected_hours - data.data_quality.hours_with_complete_actual;

  return (
    <section
      aria-label="Forecast at gate closure"
      className="rounded-xl border border-line bg-surface p-4 sm:p-5"
    >
      <p className="text-xs text-ink-muted">
        Delivery {fmtDay(data.delivery_date)}, 00:00–24:00 UK · as known at {data.gate.gate} UK on{' '}
        {fmtDay(data.decision_date)}
      </p>

      {forecast ? (
        <>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums text-ink">
              {fmtGWh(forecast.energy_gwh)}
            </span>
            <span className="text-ink-secondary">of wind expected</span>
            {forecast.band_p10_energy_gwh != null && forecast.band_p90_energy_gwh != null && (
              <span
                className="text-sm text-ink-muted"
                title={`P10–P90 of daily energy errors on ${forecast.energy_band_n_days} other fully forecast January days at this gate`}
              >
                likely {fmtNumber(forecast.band_p10_energy_gwh, 0)}–
                {fmtGWh(forecast.band_p90_energy_gwh, 0)}
              </span>
            )}
          </p>
          <p className="mt-2 text-sm text-ink-secondary">
            Run published {fmtUkDateTime(forecast.primary_publish_time)} UK,{' '}
            {fmtNumber(forecast.horizon_min_h, 1)}–{fmtHours(forecast.horizon_max_h)} ahead. Peak{' '}
            {fmtMW(forecast.peak_mw)} at {fmtUkTime(forecast.peak_time)}, low{' '}
            {fmtMW(forecast.min_mw)} at {fmtUkTime(forecast.min_time)}.
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-lg font-semibold text-ink">
          No forecast run published before {data.gate.gate} UK covered this day.
        </p>
      )}

      <p className="mt-1 text-sm text-ink-secondary">
        {known.n_days > 0 ? (
          <>
            Typical miss at this lead time:{' '}
            <strong className="text-ink">{fmtMW(known.mae_mw)}</strong> an hour
            {known.bias_mw != null && known.mae_mw != null && (
              <>, {biasWords(known.bias_mw, known.mae_mw)}</>
            )}{' '}
            <span className="text-ink-muted">
              ({known.n_days} January day{known.n_days === 1 ? '' : 's'} completed before this
              decision)
            </span>
          </>
        ) : (
          <>
            No January day had finished before this decision, so there is no error history yet (rest
            of January: {fmtMW(pilot.mae_mw)} an hour).
          </>
        )}
      </p>

      {(partial || stale) && (
        <ul className="mt-3 space-y-1 text-sm text-warning">
          {partial && (
            <li>
              ! The forecast covers only {forecast.hours_with_forecast} of {forecast.hours_expected}{' '}
              hours at this gate.
            </li>
          )}
          {stale && (
            <li>
              ! Stale feed: the last {forecast.repeated_runs} runs repeated the values published{' '}
              {fmtUkDateTime(forecast.unchanged_since)} UK, so this forecast had not been refreshed.
            </li>
          )}
        </ul>
      )}

      {reveal && (
        <p className="mt-3 border-t border-line pt-3 text-sm text-ink-secondary">
          <span className="text-actual">Actual:</span>{' '}
          {hm.actual_energy_mwh != null && hm.energy_error_mwh != null ? (
            <>
              <strong className="text-ink">{fmtGWh(hm.actual_energy_mwh / 1000)}</strong>
              {hm.n_matched < hm.n_expected && ` over ${hm.n_matched} matched hours`}. The forecast
              was {fmtGWh(Math.abs(hm.energy_error_mwh) / 1000)}
              {hm.actual_energy_mwh > 0 &&
                ` (${fmtPct((100 * Math.abs(hm.energy_error_mwh)) / hm.actual_energy_mwh, 0)})`}{' '}
              {hm.energy_error_mwh >= 0 ? 'too high' : 'too low'}; hourly miss averaged{' '}
              {fmtMW(hm.mae_mw)}.
            </>
          ) : (
            'no hour has both a forecast and a complete actual.'
          )}
          {missingActuals > 0 && hm.actual_energy_mwh != null && (
            <span className="text-ink-muted">
              {' '}
              {missingActuals} hour{missingActuals === 1 ? '' : 's'} without a complete actual are
              left out.
            </span>
          )}
        </p>
      )}
    </section>
  );
}

/** Direction of the error in words; small biases relative to the miss are called mixed. */
function biasWords(bias: number, mae: number): string {
  if (Math.abs(bias) < 0.25 * mae) return 'no consistent direction';
  return `running ${fmtSignedMW(bias).replace(/^[+−]/, '')} ${bias > 0 ? 'high' : 'low'} on average`;
}

function HourlyData({
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
  const th = 'py-2 pr-3 text-right font-medium';
  const td = 'py-1.5 pr-3 text-right';

  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink sm:px-5">
        <span aria-hidden className="text-ink-muted transition-transform group-open:rotate-90">
          ›
        </span>
        Hourly data
        <span className="font-normal text-ink-muted">({data.rows.length} hours, CSV)</span>
      </summary>
      <div className="border-t border-line px-4 pb-4 pt-3 sm:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-muted">
            MW, UK time. Actual = mean of the two half-hours; error = forecast − actual.
          </p>
          <Button onClick={exportCsv} aria-label="Export hourly data as CSV">
            Export CSV
          </Button>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[560px] text-left text-sm tabular-nums">
            <thead className="sticky top-0 bg-surface text-xs text-ink-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Hour</th>
                <th className={th}>Forecast</th>
                <th className={th}>P10–P90</th>
                <th className={th}>Lead</th>
                {plan && <th className={th}>Buy (forecast)</th>}
                {plan && <th className={th}>Buy (P10 wind)</th>}
                {reveal && <th className={th}>Actual</th>}
                {reveal && <th className={th}>Error</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.start_time} className="border-b border-line/50 last:border-0">
                  <td className="py-1.5 pr-3 text-ink">{fmtUkTime(r.start_time)}</td>
                  <td className={cx(td, 'text-ink')}>{fmtNumber(r.forecast_mw)}</td>
                  <td className={cx(td, 'text-ink-secondary')}>
                    {r.band_p10_mw == null
                      ? '—'
                      : `${fmtNumber(r.band_p10_mw)}–${fmtNumber(r.band_p90_mw)}`}
                  </td>
                  <td className={cx(td, 'text-ink-secondary')}>{fmtHours(r.horizon_h)}</td>
                  {plan && (
                    <td className={cx(td, 'text-ink')}>
                      {fmtNumber(plan.hours[i]?.buy_forecast_mw)}
                    </td>
                  )}
                  {plan && (
                    <td className={cx(td, 'text-ink-secondary')}>
                      {fmtNumber(plan.hours[i]?.buy_low_wind_mw)}
                    </td>
                  )}
                  {reveal && <td className={cx(td, 'text-ink')}>{fmtNumber(r.actual_mw)}</td>}
                  {reveal && (
                    <td className={cx(td, 'text-ink')}>
                      {fmtSignedMW(r.error_mw).replace(' MW', '')}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
