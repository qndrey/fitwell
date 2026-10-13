import { getDb } from './open';
import { Repository } from './repository';
import type { CustomActivity, CustomExercise, Workout, WorkoutTemplate } from '@fitwell/core/schema';

const deps = { getDb };
export const workoutsRepo = new Repository<Workout>('workouts', deps);
export const templatesRepo = new Repository<WorkoutTemplate>('workoutTemplates', deps);
export const customExercisesRepo = new Repository<CustomExercise>('customExercises', deps);
export const customActivitiesRepo = new Repository<CustomActivity>('customActivities', deps);

export async function workoutsForDay(day: string): Promise<Workout[]> {
  return (await workoutsRepo.listByIndex('day', day)).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * True newest-first walk: day descending, then creation time descending within a day (the index only orders by day).
 * Skips deleted workouts. Stops when `visit` returns false.
 */
async function walkNewestFirst(visit: (w: Workout) => boolean, upToDay?: string): Promise<void> {
  const db = await getDb();
  const range = upToDay === undefined ? null : IDBKeyRange.upperBound(upToDay);
  let cursor = await db.transaction('workouts').store.index('day').openCursor(range, 'prev');
  let group: Workout[] = [];
  const flush = (): boolean => group.sort((a, b) => b.createdAt - a.createdAt).every((w) => visit(w));
  while (cursor) {
    const w = cursor.value as Workout;
    if (group.length && group[0]!.day !== w.day) {
      if (!flush()) return;
      group = [];
    }
    if (w.deletedAt === undefined) group.push(w);
    cursor = await cursor.continue();
  }
  flush();
}

/** First match in newest-first order. */
async function newestMatch<T>(match: (w: Workout) => T | undefined, upToDay?: string): Promise<{ workout: Workout; value: T } | undefined> {
  let best: { workout: Workout; value: T } | undefined;
  await walkNewestFirst((w) => {
    const value = match(w);
    if (value === undefined) return true;
    best = { workout: w, value };
    return false;
  }, upToDay);
  return best;
}

/** The most recent workout of a type (for "Repeat last workout"). */
export async function lastWorkout(type: Workout['type']): Promise<Workout | undefined> {
  return (await newestMatch((w) => (w.type === type ? w : undefined)))?.workout;
}

type LoggedExercise = NonNullable<Workout['exercises']>[number];

/**
 * What you did last time for an exercise: the most recent *earlier* workout containing it (with at least one
 * working set). `before` is the current workout, so it, and anything created after it that day, is ignored.
 */
export async function lastPerformance(
  exerciseRef: string,
  before: Pick<Workout, 'id' | 'day' | 'createdAt'>,
): Promise<{ workout: Workout; exercise: LoggedExercise } | undefined> {
  const hit = await newestMatch((w): LoggedExercise | undefined => {
    if (w.id === before.id || w.type !== 'strength') return undefined;
    if (w.day === before.day && w.createdAt > before.createdAt) return undefined;
    return w.exercises?.find((e) => e.exerciseRef === exerciseRef && e.sets.some((s) => s.type === 'working' && s.done !== false && (s.reps > 0 || (s.durationSec ?? 0) > 0)));
  }, before.day);
  return hit && { workout: hit.workout, exercise: hit.value };
}

/** Distinct recently used exercises / activities, newest first. */
export async function recentRefs(kind: 'exercise' | 'activity', limit = 12): Promise<{ ref: string; name: string }[]> {
  const out: { ref: string; name: string }[] = [];
  const seen = new Set<string>();
  const add = (ref: string, name: string) => {
    if (seen.has(ref) || out.length >= limit) return;
    seen.add(ref);
    out.push({ ref, name });
  };
  await walkNewestFirst((w) => {
    if (kind === 'exercise') for (const e of w.exercises ?? []) add(e.exerciseRef, e.exerciseName);
    else if (w.cardio) add(w.cardio.activityRef, w.cardio.activityName);
    return out.length < limit;
  });
  return out;
}
