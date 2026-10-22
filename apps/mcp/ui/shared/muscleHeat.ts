// The colour of each muscle level on the body model and in the lists. Pure (no DOM), so the tests can reach it.
import type { MuscleLevel, MuscleLoad, MuscleMap } from '../../src/analytics/muscleTypes';

/**
 * One colour per level, readable on the skin tone in either theme; never the only signal (the lists say the level in words).
 * "Under the range" is a neutral grey, darker than "not trained": being under is not a warning and not a good sign.
 */
export const HEAT: Record<'light' | 'dark', Record<MuscleLevel, number>> = {
  light: { none: 0xc4bfb7, below: 0x6f6a63, in_range: 0x2e9a5a, high: 0xd8402a },
  dark: { none: 0x77726b, below: 0xa8a29a, in_range: 0x4cc47e, high: 0xff6a52 },
};

/** How long ago a muscle was last trained as a main one: the "days since trained hard" view. */
export type Recovery = 'recent' | 'days' | 'week' | 'none';
export const RECOVERY_ORDER: Recovery[] = ['recent', 'days', 'week', 'none'];
export const RECOVERY_LABEL: Record<Recovery, string> = { recent: 'Within 2 days', days: '3–6 days ago', week: '7 or more days ago', none: 'Not in this period' };

/** Whole days between two days (`later` − `earlier`). */
export const daysBetween = (earlier: string, later: string) => Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);

export function recoveryOf(to: string, lastTrained: string | null): Recovery {
  if (lastTrained === null) return 'none';
  const d = daysBetween(lastTrained, to);
  return d <= 2 ? 'recent' : d <= 6 ? 'days' : 'week';
}

/**
 * A neutral warm-grey ramp, darkest (light theme) or lightest (dark theme) for the most recent: no colour says rested is good or bad,
 * and the lists and legend say each level in words.
 */
export const RECOVERY_HEAT: Record<'light' | 'dark', Record<Recovery, number>> = {
  light: { recent: 0x3b3631, days: 0x7a736a, week: 0xb3ada3, none: 0xdcd8d0 },
  dark: { recent: 0xf0ebe2, days: 0xb9b2a7, week: 0x7f796f, none: 0x4a4641 },
};

/** What the colours and rows show: weekly hard sets against the range, or how long ago each muscle was trained. */
export type MapMode = 'sets' | 'recovery';

export const heatColours = (map: MuscleMap, dark: boolean, mode: MapMode = 'sets'): Map<string, number> =>
  new Map(map.muscles.map((m) => [m.muscle, mode === 'recovery' ? RECOVERY_HEAT[dark ? 'dark' : 'light'][recoveryOf(map.to, m.lastTrained)] : HEAT[dark ? 'dark' : 'light'][m.level]]));

/** "+1.5 vs the 4 weeks before", "same as the week before"; nothing without an earlier period. Neutral: no colour says more or less is better. */
export function deltaText(m: MuscleLoad, weeks: number): string | null {
  if (m.previousSetsPerWeek === null) return null;
  const d = Math.round((m.setsPerWeek - m.previousSetsPerWeek) * 10) / 10;
  const before = weeks === 1 ? 'the week before' : `the ${weeks} weeks before`;
  return d === 0 ? `same as ${before}` : `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('en-GB', { maximumFractionDigits: 1 })} vs ${before}`;
}
