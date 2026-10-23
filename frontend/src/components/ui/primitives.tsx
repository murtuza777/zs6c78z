import { type ButtonHTMLAttributes, type ReactNode, useId } from 'react';

import { cx } from '../../lib/cx';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  tone,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'decision' | 'hindsight';
}) {
  return (
    <section
      className={cx(
        // min-w-0 lets cards shrink inside grid/flex parents so wide tables scroll internally
        // instead of stretching the page on narrow screens.
        'min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5',
        tone === 'decision' && 'border-l-2 border-l-forecast',
        tone === 'hindsight' && 'border-l-2 border-l-actual',
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

/**
 * Accessible explanation for a metric. The tooltip is positioned against the nearest
 * `relative` ancestor (the tile), so it can never overflow the viewport on small screens.
 */
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-label={`What is ${label}?`}
        aria-describedby={id}
        className="peer ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none text-ink-muted ring-1 ring-inset ring-edge hover:text-ink focus-visible:text-ink"
      >
        i
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none invisible absolute inset-x-2 top-full z-30 mt-1 rounded-md bg-[#1b2b47] px-2.5 py-2 text-xs font-normal leading-snug text-ink-secondary opacity-0 shadow-xl ring-1 ring-edge transition-opacity peer-hover:visible peer-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100"
      >
        {children}
      </span>
    </>
  );
}

export function StatTile({
  label,
  value,
  detail,
  emphasis,
  hint,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  emphasis?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div className="relative min-w-0 rounded-lg bg-raised/60 px-3 py-2.5">
      <div className="flex items-start text-xs leading-snug text-ink-muted">
        {/* Labels wrap rather than truncate, so narrow screens keep the full meaning. */}
        <span className="min-w-0">{label}</span>
        {hint && <InfoHint label={label}>{hint}</InfoHint>}
      </div>
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

export function Tag({
  tone,
  children,
}: {
  tone: 'decision' | 'hindsight' | 'later' | 'neutral';
  children: ReactNode;
}) {
  const styles = {
    decision: 'bg-forecast/15 text-[#7fd6ea] ring-forecast/40',
    hindsight: 'bg-actual/15 text-[#f0c36b] ring-actual/40',
    later: 'bg-later/15 text-[#c4bdf6] ring-later/40',
    neutral: 'bg-raised text-ink-secondary ring-edge',
  }[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        styles,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_ICON = { good: '✓', warning: '!', critical: '×' } as const;

/** Status always carries an icon and a label, never colour alone. */
export function StatusPill({
  status,
  children,
  title,
}: {
  status: 'good' | 'warning' | 'critical';
  children: ReactNode;
  title?: string;
}) {
  const color = {
    good: 'text-[#5fd35f] ring-good/40',
    warning: 'text-warning ring-warning/40',
    critical: 'text-[#f07a7a] ring-critical/50',
  }[status];
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-xs ring-1 ring-inset',
        color,
      )}
    >
      <span aria-hidden className="font-bold">
        {STATUS_ICON[status]}
      </span>
      <span className="text-ink-secondary">{children}</span>
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  tone = 'accent',
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
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
      <span className="text-sm">
        <span className="text-ink">{label}</span>
        {description && <span className="ml-1.5 text-xs text-ink-muted">{description}</span>}
      </span>
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

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-edge px-4 py-6 text-center text-sm text-ink-muted">
      <p className="font-medium text-ink-secondary">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex h-64 items-center justify-center gap-3 text-sm text-ink-muted"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-accent" />
      {label}
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
