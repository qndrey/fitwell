export interface Linear {
  (v: number): number;
  domain: [number, number];
}

export function linear(domain: [number, number], range: [number, number]): Linear {
  const [d0, d1] = domain;
  const f = ((v: number) => (d1 === d0 ? (range[0] + range[1]) / 2 : range[0] + ((v - d0) / (d1 - d0)) * (range[1] - range[0]))) as Linear;
  f.domain = domain;
  return f;
}

/** "Nice" tick values (1, 2, 5 × 10ⁿ) covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Pads and rounds a data range so lines don't touch the frame. */
export function niceDomain(min: number, max: number, { includeZero = false, pad = 0.08 } = {}): [number, number] {
  if (includeZero) min = Math.min(min, 0);
  if (!(max > min)) return [min - 1, max + 1];
  const p = (max - min) * pad;
  const ticks = niceTicks(min - (includeZero && min === 0 ? 0 : p), max + p, 4);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  return [includeZero ? 0 : ticks[0]! - (ticks[0]! > min - p ? step : 0), ticks[ticks.length - 1]! + (ticks[ticks.length - 1]! < max + p ? step : 0)];
}

/** Sparse evenly spaced x positions (inclusive of the ends) for labels. */
export function spreadTicks(from: number, to: number, count: number): number[] {
  if (to <= from) return [from];
  const n = Math.max(2, count);
  return Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));
}
