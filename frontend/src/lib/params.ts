// Parsing and validation of URL search parameters (the shareable app state).

const GATE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidGate(value: string | null | undefined): value is string {
  return !!value && GATE_RE.test(value);
}

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

/** A date param inside [min, max], or the fallback when missing/invalid/out of range. */
export function parseDateParam(
  value: string | null,
  min: string,
  max: string,
  fallback: string,
): string {
  return isIsoDate(value) && value >= min && value <= max ? value : fallback;
}

export function parseGateParam(value: string | null, fallback: string): string {
  return isValidGate(value) ? value : fallback;
}

export function parseNumberParam(
  value: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}
