// Programs (A4): where a person is in a block of weeks, and what a deload week changes. Pure.
import type { Gym } from '@fitwell/core/domain/plates';
import { STANDARD_GYM } from '@fitwell/core/domain/plates';
import type { StoredExercise } from '../data/workoutData';

export interface ProgramDay {
  label: string;
  templateId: string;
}

export interface ProgramShape {
  weeks: number;
  deloadWeeks: number[];
  days: ProgramDay[];
}

export interface ProgramPosition {
  /** 0-based session number, as stored. */
  step: number;
  week: number;
  /** Index into the program's days. */
  dayIndex: number;
  day: ProgramDay;
  deload: boolean;
  /** "Week 3, Day B (deload week)". */
  label: string;
  total: number;
  done: boolean;
}

/** The deload weeks of a block: every `every` weeks, the last week of the block when it falls on one. */
export const deloadWeeksFor = (weeks: number, every: number | undefined): number[] => (every && every >= 2 ? Array.from({ length: Math.floor(weeks / every) }, (_, i) => (i + 1) * every) : []);

/** The session after `completed` finished ones. `done` once every session of the block is behind. */
export function positionAfter(p: ProgramShape, completed: number): ProgramPosition {
  const total = p.weeks * p.days.length;
  const step = Math.min(completed, Math.max(0, total - 1));
  const week = Math.floor(step / p.days.length) + 1;
  const dayIndex = step % p.days.length;
  const day = p.days[dayIndex]!;
  const deload = p.deloadWeeks.includes(week);
  return { step, week, dayIndex, day, deload, label: `Week ${week}, Day ${day.label}${deload ? ' (deload week)' : ''}`, total, done: completed >= total };
}

/** The share of working sets kept and of the weight used in a deload week: fewer sets, a little lighter. */
export const DELOAD_SETS = 0.6;
export const DELOAD_LOAD = 0.9;

/** A deload version of a planned workout: about 60 % of the working sets (at least one) and 90 % of every weight, rounded to the smallest jump the plates allow. Bodyweight and timed work only loses sets. */
export function applyDeload(exercises: StoredExercise[], gym: Gym = STANDARD_GYM): StoredExercise[] {
  const step = Math.max(0.5, 2 * Math.min(...(gym.platesKg.length ? gym.platesKg : [1.25])));
  const lighter = (kg: number) => Math.max(0, Math.round((kg * DELOAD_LOAD) / step) * step);
  return exercises.map((e) => {
    const working = e.sets.filter((s) => s.type === 'working');
    const keep = Math.max(1, Math.ceil(working.length * DELOAD_SETS));
    const kept = new Set(working.slice(0, keep).map((s) => s.id));
    const scale = e.load !== 'bodyweight' && e.mode !== 'time';
    const sets = e.sets.filter((s) => s.type !== 'working' || kept.has(s.id)).map((s) => (scale ? { ...s, weightKg: lighter(s.weightKg) } : s));
    return { ...e, sets, note: 'Deload week: about 60 % of the sets at about 90 % of the weight, to recover.' };
  });
}
