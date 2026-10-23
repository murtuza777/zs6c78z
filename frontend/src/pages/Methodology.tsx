import type { ReactNode } from 'react';

import { useMeta } from '../api/hooks';
import { Card, ErrorState, LoadingState } from '../components/ui/primitives';
import { fmtNumber, fmtUkDateTime } from '../lib/format';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-2 text-sm leading-relaxed text-ink-secondary">{children}</div>
    </Card>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-raised px-1 py-0.5 font-mono text-[12px] text-ink">{children}</code>
);

export function Methodology() {
  const meta = useMeta();
  if (meta.isPending) return <LoadingState />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  const m = meta.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Methodology</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          How WindDesk selects, aligns and scores forecasts. Every number in the portal comes from
          the validated snapshot <Code>{m.snapshot.version}</Code>, built{' '}
          {fmtUkDateTime(m.snapshot.created_at)} UK.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Data sources">
          <p>
            <strong className="text-ink">Actuals:</strong> Elexon BMRS <Code>FUELHH</Code> stream,{' '}
            <Code>fuelType = WIND</Code>. Each value is the average MW over a 30-minute settlement
            period starting at <Code>startTime</Code>. The snapshot has{' '}
            {fmtNumber(m.coverage.actual_half_hours)} of{' '}
            {fmtNumber(m.coverage.actual_half_hours_expected)} expected half-hours.
          </p>
          <p>
            <strong className="text-ink">Forecasts:</strong> Elexon BMRS <Code>WINDFOR</Code>{' '}
            stream. These are hourly MW forecasts for metered wind farms visible to NESO. The
            snapshot holds {fmtNumber(m.coverage.forecast_runs)} runs (
            {fmtNumber(m.coverage.forecast_rows)} rows) published{' '}
            {fmtUkDateTime(m.coverage.first_publish_time)} to{' '}
            {fmtUkDateTime(m.coverage.last_publish_time)} UK. Runs are published at{' '}
            {m.publish_slots_uk.join(', ')} UK.
            {m.coverage.off_schedule_runs.length > 0 &&
              ` Off-schedule runs: ${m.coverage.off_schedule_runs.map((t) => fmtUkDateTime(t)).join(', ')} UK.`}
          </p>
          <p>
            Scope: decisions made {m.decision_date_min} to {m.decision_date_max}, so delivery days{' '}
            {m.delivery_date_min} to {m.delivery_date_max}. Only data needed for those decisions was
            ingested. The app serves a checksummed snapshot, so it never depends on the live API.
          </p>
        </Section>

        <Section title="Timestamps and time zones">
          <p>
            All data is stored and served in UTC. Decision dates, gate times and delivery days are
            interpreted in <Code>{m.timezone}</Code>. A delivery day runs from 00:00 to 24:00 UK
            local time: 48 settlement periods normally, 46 or 50 on clock-change days. January 2026
            is GMT throughout, but the code handles daylight saving. An ambiguous autumn wall-clock
            time resolves to its first (earlier) occurrence. A gate inside the spring-forward gap is
            rejected.
          </p>
        </Section>

        <Section title="Which forecast was available at the gate">
          <p>For decision date D with gate closure G (UK local):</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>cutoff = D at G, converted to UTC;</li>
            <li>delivery window = D+1, 00:00 to 24:00 UK, in UTC;</li>
            <li>
              keep runs with <Code>publishTime ≤ cutoff</Code>;
            </li>
            <li>
              keep targets inside the delivery window and strictly after their publication. Each run
              also repeats about a day of past hours, which are not predictions;
            </li>
            <li>
              for each target hour, take the latest eligible <Code>publishTime</Code>.
            </li>
          </ol>
          <p>
            Automated tests check that no selected forecast is ever published after the cutoff, for
            every January decision across 36 gate times.
          </p>
        </Section>

        <Section title="Gate-closure scenarios">
          <p>
            Gate times are configurable scenarios, not hard-coded facts. The presets come from
            exchange documentation:
          </p>
          <ul className="space-y-1.5">
            {m.gate_presets.map((p) => (
              <li key={p.id}>
                <strong className="text-ink">
                  {p.gate} · {p.label}
                </strong>
                : {p.description}{' '}
                <a
                  className="text-accent hover:underline"
                  href={p.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.source}
                </a>{' '}
                (checked {p.verified_on}).
              </li>
            ))}
          </ul>
          <p>
            WINDFOR <Code>publishTime</Code> is treated as the moment a forecast became available,
            as the challenge brief defines it. Elexon’s endpoint description lists the schedule as
            03:30, 05:30, …, 23:30. The observed January values are one hour earlier (02:30, 04:30,
            …), which matches a schedule fixed in Central European Time. If the data reaches users
            later than <Code>publishTime</Code>, choose an earlier custom gate to model that delay.
          </p>
        </Section>

        <Section title="Temporal alignment">
          <p>
            Forecasts are hourly and actuals half-hourly. Each hourly forecast at <Code>H</Code> is
            compared with the{' '}
            <strong className="text-ink">mean of the two half-hourly actuals</strong> starting at{' '}
            <Code>H</Code> and <Code>H+30m</Code>. If either half-hour is missing, the hour’s actual
            is left empty and the hour is excluded. It is never estimated from one half. The
            first-half-hour value is kept for a sensitivity check in the analysis notebook.
          </p>
        </Section>

        <Section title="Metric definitions">
          <ul className="space-y-1">
            <li>
              <Code>error = forecast − actual</Code>. Positive values are over-forecasts: less wind
              arrived than forecast.
            </li>
            <li>
              <strong className="text-ink">MAE</strong> mean |error|;{' '}
              <strong className="text-ink">RMSE</strong> √mean(error²);{' '}
              <strong className="text-ink">bias</strong> mean error (MW).
            </li>
            <li>
              <strong className="text-ink">WAPE</strong> Σ|error| / Σ actual. It is not shown when
              the total is 0. MAPE is not used because it blows up when wind output is low.
            </li>
            <li>
              Absolute-error percentiles P50/P90/P95/P99 use linear interpolation, plus the maximum.
            </li>
            <li>Pearson correlation, shown only when both series vary and n ≥ 3.</li>
            <li>
              Energy (MWh) = Σ hourly MW × 1 h over matched hours only, so forecast and actual cover
              the same hours.
            </li>
            <li>
              Matched hours have both a selected forecast and a complete actual. Coverage = matched
              / expected.
            </li>
          </ul>
        </Section>

        <Section title="Uncertainty band (P10–P90)">
          <p>
            Errors from the forecasts selected at the gate are grouped into {m.horizon_bucket_h}
            -hour lead-time buckets. For each delivery day, the band uses the 10th and 90th error
            percentiles from <strong className="text-ink">all other</strong> January delivery days
            (leave-one-day-out). The band is shown only when a bucket has at least 48 observations
            from 10 days. Its held-out coverage appears on the Accuracy page. It is an empirical
            range, not a guaranteed confidence interval.
          </p>
        </Section>

        <Section title="Known limitations">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Only national wind, from two datasets. There is no demand, embedded solar or wind,
              price, contract or imbalance data, so wind forecast error is not the same as
              procurement error.
            </li>
            <li>
              Forecasts were consistently higher than metered output in January. Curtailment and
              constraint actions may explain part of this. The supplied data cannot confirm it.
            </li>
            <li>
              One month of history; errors are autocorrelated, so the band’s coverage estimate is
              uncertain.
            </li>
            <li>
              WINDFOR’s exact value semantics (hourly mean or instant) are not documented. The
              hourly-mean comparison is a documented assumption.
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
