/** A local calendar day as `YYYY-MM-DD`. Days are never stored as UTC instants. */
export type Day = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDay(d: Date): Day {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDay(s: string): s is Day {
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da);
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da;
}

/** Local midnight of the given day. */
export function parseDay(day: Day): Date {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`Invalid day: ${day}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function today(now: Date = new Date()): Day {
  return toDay(now);
}

/** Calendar arithmetic (DST-safe: works on y/m/d, not on 24h multiples). */
export function addDays(day: Day, n: number): Day {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Whole calendar days from `a` to `b` (b - a). */
export function dayDiff(a: Day, b: Day): number {
  const [pa, pb] = [parseDay(a), parseDay(b)];
  return Math.round((Date.UTC(pb.getFullYear(), pb.getMonth(), pb.getDate()) -
    Date.UTC(pa.getFullYear(), pa.getMonth(), pa.getDate())) / 86_400_000);
}

export function formatDay(day: Day, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }, locale?: string): string {
  return new Intl.DateTimeFormat(locale, opts).format(parseDay(day));
}
