import type { ReactNode } from 'react';

import { useMeta } from '../api/hooks';
import { ErrorState, PageSkeleton } from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { fmtNumber, fmtUkDateTime } from '../lib/format';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-raised px-1 py-0.5 font-mono text-[12px] text-ink">{children}</code>
);

export function Methodology() {
  useDocumentTitle('Methodology');
  const meta = useMeta();
  if (meta.isPending) return <PageSkeleton label="Loading methodology…" />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  const m = meta.data;

  return (
    <article className="max-w-3xl space-y-6 text-sm leading-relaxed text-ink-secondary">
      <h1 className="text-xl font-semibold text-ink">Methodology</h1>

      <Section title="Data">
        <p>
          Actuals are Elexon <Code>FUELHH</Code> with <Code>fuelType = WIND</Code>: average MW per
          30-minute settlement period ({fmtNumber(m.coverage.actual_half_hours)} of{' '}
          {fmtNumber(m.coverage.actual_half_hours_expected)} half-hours present). Forecasts are
          Elexon <Code>WINDFOR</Code>, hourly MW for metered wind farms ({m.coverage.forecast_runs}{' '}
          runs, published at {m.publish_slots_uk.join(', ')} UK). Scope: decisions{' '}
          {m.decision_date_min} to {m.decision_date_max}, so delivery {m.delivery_date_min} to{' '}
          {m.delivery_date_max}. The app serves a checksummed snapshot (
          <Code>{m.snapshot.version}</Code>, built {fmtUkDateTime(m.snapshot.created_at)} UK), so it
          never depends on the live API. Times are stored in UTC and shown in UK time.
        </p>
      </Section>

      <Section title="The forecast you had at the gate">
        <p>
          For decision day D and gate time G (UK): the delivery day is D+1, 00:00–24:00 UK. Keep
          forecast runs with <Code>publishTime ≤ D at G</Code>, keep target hours inside the
          delivery day and after their own publish time (each run repeats past hours, which are not
          forecasts), then take the latest run for each hour. Tests check on the real data that no
          selected forecast was published after the gate, for every decision at 36 gate times.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {m.gate_presets.map((p) => (
            <li key={p.id}>
              <span className="text-ink">
                {p.gate} · {p.label}
              </span>
              : {p.description}{' '}
              <a
                className="text-accent hover:underline"
                href={p.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Scoring">
        <p>
          The hourly actual is the mean of its two half-hours; hours missing either half are left
          out, never filled in. Error = forecast − actual, so positive means less wind arrived than
          forecast. MAE is the average size of the miss, bias the average signed error, and P90 the
          miss that 9 in 10 hours stayed under.
        </p>
      </Section>

      <Section title="How far to trust it">
        <p>
          The typical miss on the Day-Ahead page uses only January days that had finished before the
          decision, so it is what the desk could really have known. The P10–P90 range comes from
          errors at the same lead time ({m.band.bucket_h} h buckets) on every other January day,
          leaving the day itself out. It is a pilot calibration from one month (the Accuracy page
          shows how often it held); errors run in streaks, so expect it to hold less well on new
          data. The daily GWh range uses daily energy errors, because hourly percentiles do not add
          up to a daily one.
        </p>
      </Section>

      <Section title="Limits">
        <p>
          Wind forecast error is not procurement error: both streams cover metered wind farms only,
          not embedded wind, and the buy-beyond-wind what-if uses a flat demand you enter, with no
          prices or contracts. One month of data is enough to show the bias and its size, not to
          model seasons.
        </p>
      </Section>
    </article>
  );
}
