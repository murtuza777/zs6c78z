import type { ReactNode } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';

import { useMeta } from '../../api/hooks';
import { cx } from '../../lib/cx';

const NAV = [
  { to: '/brief', label: 'Day-Ahead' },
  { to: '/accuracy', label: 'Accuracy' },
  { to: '/methodology', label: 'Methodology' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const { data: meta } = useMeta();
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
        <div className="mx-auto flex max-w-6xl items-center gap-x-3 px-4 py-2.5 sm:gap-x-6">
          <NavLink to={`/brief${carry}`} className="flex shrink-0 items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="sr-only text-sm font-semibold tracking-wide text-ink sm:not-sr-only">
              WindDesk
            </span>
          </NavLink>
          <nav aria-label="Primary" className="-mx-1 flex gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={`${item.to}${item.to === '/methodology' ? '' : carry}`}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-5 focus:outline-none sm:py-6"
      >
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-2 text-xs text-ink-muted">
        Elexon BMRS FUELHH (wind outturn) and WINDFOR (wind forecast), January 2026
        {meta && <> · snapshot {meta.snapshot.version}</>}
      </footer>
    </div>
  );
}
