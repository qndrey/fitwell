// The page for one lift: estimated 1RM by session and the heaviest weights for 1, 3, 5 and 8 reps. Pure: no I/O.
import type { Day } from '@fitwell/core/domain/dates';
import type { Workout } from '../data/workoutData';
import { collectLifts, liftSessions } from './progress';
import type { LiftProgress } from './types';

export const REP_RECORDS = [1, 3, 5, 8] as const;

export function buildLiftProgress(i: { id: string; name: string; to: Day; workouts: Workout[] }): LiftProgress {
  const strength = i.workouts.filter((w) => w.type === 'strength' && w.finishedAt !== null);
  const lift = collectLifts(strength).get(i.id);
  const records = REP_RECORDS.map((reps) => ({ reps, kg: null as number | null, day: null as Day | null }));
  const weighted = strength.some((w) => w.exercises.some((e) => e.exerciseRef === i.id && e.load !== 'bodyweight' && e.mode !== 'time'));
  if (weighted) {
    for (const w of strength) {
      for (const e of w.exercises) {
        if (e.exerciseRef !== i.id) continue;
        for (const s of e.sets) {
          if (s.type !== 'working' || s.done === false || !(s.weightKg > 0)) continue;
          for (const r of records) if (s.reps >= r.reps && (r.kg === null || s.weightKg > r.kg || (s.weightKg === r.kg && w.day < r.day!))) { r.kg = Math.round(s.weightKg * 10) / 10; r.day = w.day; }
        }
      }
    }
  }
  return { id: i.id, name: lift?.name ?? i.name, to: i.to, sessions: lift ? liftSessions(lift.days).sessions : [], repRecords: records };
}
