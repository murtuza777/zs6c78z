import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '../../lib/cx';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        // min-w-0 lets cards shrink inside grid/flex parents so wide tables scroll internally
        // instead of stretching the page on narrow screens.
        'min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5',
        className,
      )}
    >
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5">
      {/* Labels wrap rather than truncate, so narrow screens keep the full meaning. */}
      <div className="text-xs leading-snug text-ink-muted">{label}</div>
      <div
        className={cx(
          'mt-1 font-semibold text-ink',
          emphasis ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl',
        )}
      >
        {value}
      </div>
      {detail && <div className="mt-0.5 text-xs text-ink-secondary">{detail}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  tone = 'accent',
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  tone?: 'accent' | 'hindsight';
}) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          checked ? (tone === 'hindsight' ? 'bg-actual' : 'bg-forecast') : 'bg-edge',
        )}
      >
        <span
          className={cx(
            'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-ink transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'secondary' | 'ghost' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'secondary' && 'bg-raised text-ink ring-1 ring-inset ring-edge hover:bg-edge',
        variant === 'ghost' && 'text-ink-secondary hover:bg-raised hover:text-ink',
        className,
      )}
    />
  );
}

/** Placeholder blocks shaped like the page, so loading never shifts the layout. */
export function PageSkeleton({ label }: { label: string }) {
  const block = 'animate-pulse rounded-lg bg-raised/70';
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className={cx(block, 'h-16')} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cx(block, 'h-20')} />
        ))}
      </div>
      <div className={cx(block, 'h-80')} />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div
      role="alert"
      className="rounded-xl border border-critical/40 bg-critical/10 p-5 text-sm text-ink-secondary"
    >
      <p className="font-semibold text-ink">Could not load this view</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <Button className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { color: string; label: string; kind?: 'line' | 'box' }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className={item.kind === 'line' ? 'h-0.5 w-3.5' : 'h-2.5 w-2.5 rounded-sm'}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
