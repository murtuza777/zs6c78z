import type { ReactNode } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';

import { useMeta } from '../../api/hooks';
import { fmtUkDateTime } from '../../lib/format';
import { StatusPill } from '../ui/primitives';
import { cx } from '../../lib/cx';

const NAV = [
  { to: '/brief', label: 'Day-Ahead Brief' },
  { to: '/accuracy', label: 'Forecast Accuracy' },
  { to: '/horizon', label: 'Horizon Explorer' },
  { to: '/methodology', label: 'Methodology' },
];

function DataStatus() {
  const { data } = useMeta();
  if (!data) return null;
  const { coverage } = data;
  const missing = coverage.missing_actual_periods.length;
  const status = missing === 0 ? 'good' : missing < 10 ? 'warning' : 'critical';
  return (
    <StatusPill
      status={status}
      title={`Snapshot ${data.snapshot.version}, built ${fmtUkDateTime(data.snapshot.created_at)} UK. ${coverage.actual_half_hours}/${coverage.actual_half_hours_expected} half-hourly actuals, ${coverage.forecast_runs} forecast runs.`}
    >
      {missing === 0 ? 'Data complete' : `${missing} actual periods missing`} · snapshot{' '}
      <span className="font-mono text-[11px]">{data.snapshot.version.replace('jan2026-', '')}</span>
    </StatusPill>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const gate = params.get('gate');
  const carry = gate ? `?gate=${encodeURIComponent(gate)}` : '';

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:ring-2 focus:ring-accent"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to={`/brief${carry}`} className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide text-ink">WindDesk</div>
              <div className="text-[11px] text-ink-muted">
                GB day-ahead wind intelligence · pilot
              </div>
            </div>
          </NavLink>
          <nav
            aria-label="Primary"
            className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={`${item.to}${item.to === '/methodology' ? '' : carry}`}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-raised text-ink ring-1 ring-edge'
                      : 'text-ink-muted hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <DataStatus />
          </div>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-4 py-5 focus:outline-none sm:py-6"
      >
        {children}
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-xs text-ink-muted">
        Data: Elexon BMRS FUELHH (WIND outturn) and WINDFOR (wind forecast), January 2026 decision
        scope. Decision support only: wind forecast error is not procurement error.
      </footer>
    </div>
  );
}
