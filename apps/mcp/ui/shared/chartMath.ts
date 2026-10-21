// The numbers and dates behind the charts. Pure (no DOM), so the server-side tests and tsc can reach it.

export const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
export const num = (n: number, digits = 1) => n.toLocaleString('en-GB', { maximumFractionDigits: digits });

/** "19 Nov", or "19 Nov 2025" when the range it belongs to crosses a year. */
export const fmtDay = (d: string, withYear = false) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
export const crossesYear = (from: string, to: string) => from.slice(0, 4) !== to.slice(0, 4);
/** "19 Nov to 4 Feb", with the years when they differ. */
export function rangeLabel(from: string, to: string) {
  const y = crossesYear(from, to);
  return `${fmtDay(from, y)} to ${fmtDay(to, y)}`;
}

/** Round tick values inside [lo, hi]: steps of 1, 2 or 5 times a power of ten, about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 3): number[] {
  if (!(hi > lo) || count < 1) return [];
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step - 1e-9); t * step <= hi + step * 1e-9; t++) ticks.push(Math.round(t * step * 1e9) / 1e9 + 0); // + 0: no negative zero
  return ticks;
}
