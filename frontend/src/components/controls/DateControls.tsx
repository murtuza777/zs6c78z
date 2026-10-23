import { fmtDay } from '../../lib/format';
import { addDays, isIsoDate } from '../../lib/params';

const inputClass =
  'rounded-md bg-raised px-2 py-1.5 text-sm text-ink ring-1 ring-inset ring-edge [color-scheme:dark] focus:outline-none focus:ring-accent/70';
const stepClass =
  'rounded-md bg-raised px-2 py-1.5 text-sm text-ink-secondary ring-1 ring-inset ring-edge hover:text-ink disabled:opacity-40 disabled:hover:text-ink-secondary';

export function DecisionDatePicker({
  value,
  min,
  max,
  onChange,
}: {
  value: string;
  min: string;
  max: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor="decision-date" className="mb-1.5 block text-xs text-ink-muted">
        Decision date (D)
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={stepClass}
          aria-label="Previous decision day"
          disabled={value <= min}
          onClick={() => onChange(addDays(value, -1))}
        >
          ‹
        </button>
        <input
          id="decision-date"
          type="date"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (isIsoDate(next) && next >= min && next <= max) onChange(next);
          }}
          className={inputClass}
        />
        <button
          type="button"
          className={stepClass}
          aria-label="Next decision day"
          disabled={value >= max}
          onClick={() => onChange(addDays(value, 1))}
        >
          ›
        </button>
        <span className="ml-1 hidden text-xs text-ink-muted md:inline">{fmtDay(value)}</span>
      </div>
    </div>
  );
}

export function DateRangeFields({
  label,
  from,
  to,
  min,
  max,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  min: string;
  max: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs text-ink-muted">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          aria-label={`${label}: from`}
          min={min}
          max={to}
          value={from}
          onChange={(e) => isIsoDate(e.target.value) && onChange(e.target.value, to)}
          className={inputClass}
        />
        <span className="text-ink-muted">to</span>
        <input
          type="date"
          aria-label={`${label}: to`}
          min={from}
          max={max}
          value={to}
          onChange={(e) => isIsoDate(e.target.value) && onChange(from, e.target.value)}
          className={inputClass}
        />
        {(from !== min || to !== max) && (
          <button type="button" className={stepClass} onClick={() => onChange(min, max)}>
            All January
          </button>
        )}
      </div>
    </fieldset>
  );
}
