// A verdict per muscle group for the weekly review (A6): the sets it got against the usual range and against the period before, in plain words. Pure.
// Not advice and not a diagnosis: the range is a rough guide from the training literature, and a muscle that helps in other lifts often does fine on less.
import type { MuscleLevel, MuscleMap } from './muscleTypes';

export interface MuscleVerdict {
  muscle: string;
  /** Working sets a week, averaged over the period. */
  setsPerWeek: number;
  /** The same over the period before, or null when nothing was logged then. */
  previousSetsPerWeek: number | null;
  level: MuscleLevel;
  /** One plain sentence: where it is against the range, and what changed. */
  verdict: string;
}

export interface MuscleVerdicts {
  /** The range the verdicts compare with, in sets a week. */
  range: { low: number; high: number };
  /** The period is not over, so the sets so far are shown as they are (a verdict "under the range" can still change). */
  partial: boolean;
  items: MuscleVerdict[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function verdictOf(level: MuscleLevel, sets: number, previous: number | null, range: { low: number; high: number }, partial: boolean): string {
  const against =
    level === 'none'
      ? previous && previous > 0
        ? `Not trained in this period, after ${r1(previous)} sets a week before.`
        : 'Not trained.'
      : level === 'below'
        ? `${r1(sets)} sets a week: under the usual ${range.low} to ${range.high}${partial ? ' so far' : ''}.`
        : level === 'in_range'
          ? `${r1(sets)} sets a week: in the usual ${range.low} to ${range.high}.`
          : `${r1(sets)} sets a week: above the usual ${range.low} to ${range.high}.`;
  if (level === 'none' || previous === null) return against;
  const diff = r1(sets - previous);
  return Math.abs(diff) < 1 ? `${against} About the same as before.` : `${against} ${diff > 0 ? 'Up' : 'Down'} ${Math.abs(diff)} from ${r1(previous)}.`;
}

/** The muscles that were trained in the period or the one before, most-trained first; muscles that were never trained in either are left out. */
export function muscleVerdicts(map: MuscleMap, partial: boolean): MuscleVerdicts {
  const items = map.muscles
    .filter((m) => m.setsPerWeek > 0 || (m.previousSetsPerWeek ?? 0) > 0)
    .map((m): MuscleVerdict => ({ muscle: m.muscle, setsPerWeek: m.setsPerWeek, previousSetsPerWeek: m.previousSetsPerWeek, level: m.level, verdict: verdictOf(m.level, m.setsPerWeek, m.previousSetsPerWeek, map.range, partial) }))
    .sort((a, b) => b.setsPerWeek - a.setsPerWeek || a.muscle.localeCompare(b.muscle));
  return { range: { ...map.range }, partial, items };
}
