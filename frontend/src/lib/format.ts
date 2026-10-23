// Display formatting. All wall-clock times are shown in UK local time (Europe/London).

export const UK_TZ = 'Europe/London';
const MINUS = '−';
const DASH = '—';

const intFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const numberFormats = new Map<number, Intl.NumberFormat>();

function numberFormat(digits: number): Intl.NumberFormat {
  let format = numberFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(digits, format);
  }
  return format;
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const formatted = numberFormat(digits).format(Math.abs(value));
  return value < 0 && Number(formatted.replace(/,/g, '')) !== 0
    ? `${MINUS}${formatted}`
    : formatted;
}

export function fmtMW(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? DASH : `${fmtNumber(value)} MW`;
}

/** Signed MW with an explicit + for positive values (used for bias / errors). */
export function fmtSignedMW(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const rounded = Math.round(value);
  if (rounded === 0) return '0 MW';
  return `${rounded > 0 ? '+' : MINUS}${intFmt.format(Math.abs(rounded))} MW`;
}

export function fmtGWh(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? DASH : `${fmtNumber(value, digits)} GWh`;
}

export function fmtSignedGWh(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const body = fmtNumber(Math.abs(value), digits);
  if (Number(body.replace(/,/g, '')) === 0) return `${body} GWh`;
  return `${value > 0 ? '+' : MINUS}${body} GWh`;
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? DASH : `${fmtNumber(value, digits)}%`;
}

export function fmtHours(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? DASH
    : `${fmtNumber(value, value % 1 ? 1 : 0)} h`;
}

/** Axis ticks: 0, 2k, 4k ... */
export function fmtCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    const k = value / 1000;
    const text = `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
    return value < 0 ? text.replace('-', MINUS) : text;
  }
  return value < 0 ? `${MINUS}${Math.abs(value)}` : String(value);
}

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const shortDayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});

const isoPartsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const fmtUkTime = (iso: string | number): string => timeFmt.format(new Date(iso));

/** Machine-readable UK local time for exports: `2026-01-16 09:30`. */
export function fmtUkIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = Object.fromEntries(
    isoPartsFmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function fmtUkDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)).replace(',', '') : DASH;
}

/** Format a calendar date string (YYYY-MM-DD) without any timezone shift. */
export const fmtDay = (date: string): string =>
  dayFmt.format(new Date(`${date}T12:00:00Z`)).replace(',', '');
export const fmtShortDay = (date: string): string =>
  shortDayFmt.format(new Date(`${date}T12:00:00Z`));
