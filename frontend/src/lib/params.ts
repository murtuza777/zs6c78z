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
