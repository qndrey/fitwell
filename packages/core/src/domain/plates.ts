// Barbell maths: which plates go on each side, and a warm-up ramp up to the working weight. Pure.

export interface Gym {
  /** Weight of the empty bar, kg. */
  barKg: number;
  /** Plate sizes available (any number of each), kg. */
  platesKg: number[];
}

export const STANDARD_GYM: Gym = { barKg: 20, platesKg: [25, 20, 15, 10, 5, 2.5, 1.25] };

export interface Loading {
  /** Plates for one side, heaviest first. Empty: the bar alone. */
  perSide: number[];
  /** What the bar weighs with them; below the target when the plates can't make it exactly. */
  totalKg: number;
  /** Target minus total (0 when exact). */
  shortKg: number;
}

// Work in grams so 1.25 kg plates add up exactly.
const g = (kg: number) => Math.round(kg * 1000);

/** Plates per side for a total weight (bar included), heaviest first; null when the total is below the bar. */
export function platesFor(totalKg: number, gym: Gym = STANDARD_GYM): Loading | null {
  if (g(totalKg) < g(gym.barKg)) return null;
  let side = Math.floor((g(totalKg) - g(gym.barKg)) / 2);
  const perSide: number[] = [];
  for (const p of [...gym.platesKg].sort((a, b) => b - a)) {
    while (g(p) > 0 && side >= g(p)) {
      perSide.push(p);
      side -= g(p);
    }
  }
  const total = (g(gym.barKg) + 2 * perSide.reduce((n, p) => n + g(p), 0)) / 1000;
  return { perSide, totalKg: total, shortKg: Math.round((totalKg - total) * 1000) / 1000 };
}

export interface WarmupSet {
  weightKg: number;
  reps: number;
}

/** Full ramp for the first heavy lift of a session; a short one for later lifts, which are partly warm already. */
const FULL = [
  { pct: 0, reps: 8 }, // the empty bar
  { pct: 0.5, reps: 5 },
  { pct: 0.7, reps: 3 },
  { pct: 0.85, reps: 1 },
];
const SHORT = [
  { pct: 0.6, reps: 4 },
  { pct: 0.8, reps: 2 },
];

/** Below this a ramp is not worth the time: the working sets are the warm-up. */
export const WARMUP_FROM_KG = 40;

/**
 * Warm-up sets before working sets at `workKg`: each step rounded down to a weight the plates can make, and dropped
 * when it is not lighter than the next step or the working weight. Empty for light work. For equipment without a bar,
 * pass a gym with `barKg: 0` and the smallest step as the only plate.
 */
export function warmupRamp(workKg: number, kind: 'full' | 'short', gym: Gym = STANDARD_GYM): WarmupSet[] {
  if (workKg < WARMUP_FROM_KG) return [];
  const out: WarmupSet[] = [];
  for (const step of kind === 'full' ? FULL : SHORT) {
    if (step.pct === 0 && gym.barKg <= 0) continue; // no bar (dumbbells, machines): no empty-bar set
    const target = Math.max(gym.barKg, workKg * step.pct);
    const weightKg = platesFor(target, gym)?.totalKg ?? gym.barKg;
    if (weightKg >= workKg - 1e-9) continue;
    if (out.length && weightKg <= out[out.length - 1]!.weightKg) continue;
    out.push({ weightKg, reps: step.reps });
  }
  return out;
}
