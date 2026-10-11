import type { CardioDetails, SetType, Workout, WorkoutExercise, WorkoutSet } from '../db/schema';
import { displayWeight, toKg, weightUnit, type UnitSystem } from './units';

/** What counts toward the calorie total for a cardio workout: the user's own number wins over the estimate. */
export const cardioKcal = (c: CardioDetails): number | undefined => c.kcalOverride ?? c.kcalEstimated;

/** Added load of a set: for bodyweight sets, what was added on top of body weight; otherwise the weight itself. */
export const addedLoadKg = (s: Pick<WorkoutSet, 'weightKg' | 'bodyweightKg'>): number =>
  s.bodyweightKg !== undefined ? Math.max(0, Math.round((s.weightKg - s.bodyweightKg) * 100) / 100) : s.weightKg;

/** A set you actually did: not one still planned (prefilled and not ticked). Sets from before the flag existed count. */
export const isSetDone = (s: Pick<WorkoutSet, 'done'>): boolean => s.done !== false;

/** Whether a set was done and has anything in it (a timed or bodyweight set may have no weight at all). */
export const isSetLogged = (s: Pick<WorkoutSet, 'reps' | 'weightKg' | 'bodyweightKg' | 'durationSec' | 'done'>): boolean =>
  isSetDone(s) && (s.reps > 0 || (s.durationSec ?? 0) > 0 || addedLoadKg(s) > 0);

/** "45 s" under a minute, "1:30" from a minute up. */
export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Reads "45", "45s", "1:30", "1m30", "90 sec" or "1.5m" as seconds. Returns null when it isn't a duration. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  if (t === '') return null;
  let m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)\s*m(?:in)?\s*(?:(\d+)\s*s?(?:ec)?)?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = /^(\d*\.?\d+)\s*m(?:in)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+)\s*(?:s|sec|secs|seconds?)?$/.exec(t);
  return m ? Number(m[1]) : null;
}

type SummarySet = Pick<WorkoutSet, 'type' | 'reps' | 'weightKg' | 'durationSec' | 'bodyweightKg' | 'done'>;

/**
 * "3×8 @ 60 kg" when all working sets match, otherwise "8 @ 60, 8 @ 60, 6 @ 62.5 kg". Warm-ups are left out.
 * Timed sets read "3×45 s", bodyweight sets "3×8 @ BW" or "3×8 @ BW + 10 kg".
 * Used for "Last time: …" so you know what to beat at a glance. Sets still planned (not done) are left out.
 */
export function summarizeSets(sets: SummarySet[], units: UnitSystem, how: { mode?: 'reps' | 'time'; load?: 'weight' | 'bodyweight' } = {}): string {
  const isTime = how.mode === 'time';
  const working = sets.filter((s) => s.type === 'working' && isSetDone(s) && (isTime ? (s.durationSec ?? 0) > 0 : s.reps > 0 || (s.durationSec ?? 0) > 0));
  if (working.length === 0) return '';
  const w = (kg: number) => String(displayWeight(kg, units, 2));
  const unit = weightUnit(units);
  const measure = (s: SummarySet) => (!isTime && s.reps > 0 ? String(s.reps) : formatDuration(s.durationSec ?? 0));
  const load = (s: SummarySet): { text: string; numeric: boolean } => {
    if (how.load === 'bodyweight' || s.bodyweightKg !== undefined) {
      const added = addedLoadKg(s);
      return added > 0 ? { text: `BW + ${w(added)}`, numeric: true } : { text: 'BW', numeric: false };
    }
    return s.weightKg > 0 ? { text: w(s.weightKg), numeric: true } : { text: '', numeric: false };
  };
  const key = (s: SummarySet) => `${measure(s)}|${load(s).text}`;
  const first = working[0]!;
  const withUnit = (l: { text: string; numeric: boolean }) => (l.numeric ? `${l.text} ${unit}` : l.text);
  if (working.every((s) => key(s) === key(first))) {
    const l = load(first);
    return l.text ? `${working.length}×${measure(first)} @ ${withUnit(l)}` : `${working.length}×${measure(first)}`;
  }
  const parts = working.map((s) => {
    const l = load(s);
    return l.text ? `${measure(s)} @ ${l.text}` : measure(s);
  });
  const anyNumeric = working.some((s) => load(s).numeric);
  return `${parts.join(', ')}${anyNumeric ? ` ${unit}` : ''}`;
}

/** Epley estimate of the one-rep max. Only meaningful for working sets of up to 12 reps. */
export function estimatedOneRepMax(weightKg: number, reps: number): number | undefined {
  if (!(weightKg > 0) || !(reps >= 1) || reps > 12) return undefined;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/**
 * A weight to try next time: last time's working weight plus one small step (2.5 kg or 5 lb), offered only when every
 * done working set used that same weight for at least 5 reps. Otherwise undefined: no nudge when the picture is mixed.
 */
export function suggestNextKg(sets: SummarySet[], units: UnitSystem): number | undefined {
  const working = sets.filter((s) => s.type === 'working' && isSetDone(s) && s.reps > 0 && s.bodyweightKg === undefined && s.weightKg > 0);
  const w = working[0]?.weightKg;
  if (w === undefined || !working.every((s) => Math.abs(s.weightKg - w) < 0.01 && s.reps >= 5)) return undefined;
  return units === 'metric' ? w + 2.5 : toKg(displayWeight(w, 'imperial') + 5, 'imperial');
}

/** Done and planned sets, and the volume (weight × reps of done working sets with a load) for a workout in progress. */
export function workoutTally(exercises: Pick<WorkoutExercise, 'sets' | 'mode'>[]): { done: number; total: number; volumeKg: number } {
  let done = 0;
  let total = 0;
  let volumeKg = 0;
  for (const e of exercises) {
    for (const s of e.sets) {
      total++;
      if (!isSetLogged(s)) continue;
      done++;
      if (s.type === 'working' && e.mode !== 'time' && s.reps > 0) volumeKg += s.weightKg * s.reps;
    }
  }
  return { done, total, volumeKg };
}

/** A new set, planned (not done yet), optionally prefilled from another. */
export function newSet(id: string, type: SetType = 'working', from?: Pick<WorkoutSet, 'reps' | 'weightKg' | 'durationSec' | 'bodyweightKg'>): WorkoutSet {
  const set: WorkoutSet = { id, type, reps: from?.reps ?? 0, weightKg: from?.weightKg ?? 0, done: false };
  if (from?.durationSec) set.durationSec = from.durationSec;
  if (from?.bodyweightKg !== undefined) set.bodyweightKg = from.bodyweightKg;
  return set;
}

/**
 * Keeps supersets tidy: a superset id is only valid for a run of neighbouring exercises, and a run of one is not a
 * superset. Later runs that reused an id get a fresh one (so unlinking an exercise in the middle splits the group).
 */
export function normalizeSupersets(exercises: WorkoutExercise[], newId: () => string): WorkoutExercise[] {
  const out = exercises.map((e) => ({ ...e }));
  const seen = new Set<string>();
  let i = 0;
  while (i < out.length) {
    const id = out[i]!.supersetId;
    if (!id) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j]!.supersetId === id) j++;
    const runId = seen.has(id) ? newId() : id;
    seen.add(id);
    for (let k = i; k < j; k++) {
      if (j - i < 2) delete out[k]!.supersetId;
      else out[k]!.supersetId = runId;
    }
    i = j;
  }
  return out;
}

/** Position of an exercise inside its superset: letter (A, B, …) and size, or null when it isn't in one. */
export function supersetPosition(exercises: Pick<WorkoutExercise, 'supersetId'>[], index: number): { letter: string; size: number; first: boolean; last: boolean } | null {
  const id = exercises[index]?.supersetId;
  if (!id) return null;
  let start = index;
  while (start > 0 && exercises[start - 1]!.supersetId === id) start--;
  let end = index;
  while (end + 1 < exercises.length && exercises[end + 1]!.supersetId === id) end++;
  return { letter: String.fromCharCode(65 + (index - start)), size: end - start + 1, first: index === start, last: index === end };
}

/** A fresh copy of a workout on another day: new set ids, nothing shared with the original, every set planned (not done yet). */
export function copyExercises(exercises: WorkoutExercise[], newId: () => string): WorkoutExercise[] {
  return exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, id: newId(), done: false })) }));
}

// ---- Workout lifecycle: not started / in progress / finished ----

/** `open`: no timer running (a plan, a workout logged afterwards, an older one). `active`: timer running. `finished`: closed. */
export type WorkoutStatus = 'open' | 'active' | 'finished';

export function workoutStatus(w: Pick<Workout, 'startedAt' | 'finishedAt'>): WorkoutStatus {
  if (w.finishedAt !== undefined) return 'finished';
  return w.startedAt !== undefined ? 'active' : 'open';
}

/** Longest session counted as real: a timer left running overnight says nothing about how long the workout took. */
export const MAX_SESSION_MIN = 6 * 60;
/** An unfinished timer older than this is treated as forgotten and no longer shown as "in progress" elsewhere. */
export const STALE_AFTER_MS = 12 * 3600_000;

/** Seconds on the clock for a workout in progress (never negative). */
export const elapsedSeconds = (w: Pick<Workout, 'startedAt'>, now: number): number | undefined =>
  w.startedAt === undefined ? undefined : Math.max(0, Math.floor((now - w.startedAt) / 1000));

/** Whole minutes a finished strength workout took, from its timer; undefined when it had no timer or the time is not believable. */
export function sessionMinutes(w: Pick<Workout, 'startedAt' | 'finishedAt'>): number | undefined {
  if (w.startedAt === undefined || w.finishedAt === undefined) return undefined;
  const min = (w.finishedAt - w.startedAt) / 60_000;
  return min >= 1 && min <= MAX_SESSION_MIN ? Math.round(min) : undefined;
}

/** "42 min" below an hour, "1 h 05 min" from an hour up. */
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** "23:05" under an hour, "1:02:07" from an hour up: the running clock. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${Math.floor(s / 60)}:${ss}`;
}

/** How many sets are still planned (prefilled, not ticked) across the exercises. */
export const plannedSets = (exercises: Pick<WorkoutExercise, 'sets'>[]): number => exercises.reduce((n, e) => n + e.sets.filter((s) => !isSetDone(s)).length, 0);

/** The exercises as they stand when the workout is finished: sets that were never done are dropped, and so are exercises left empty. */
export function exercisesAtFinish(exercises: WorkoutExercise[], newId: () => string): WorkoutExercise[] {
  const kept = exercises.map((e) => ({ ...e, sets: e.sets.filter(isSetDone) })).filter((e) => e.sets.length > 0);
  return normalizeSupersets(kept, newId);
}

/** Fields to store when a workout is reopened: the clock carries on from where it stopped, not from the original start. */
export function reopenPatch(w: Pick<Workout, 'startedAt' | 'finishedAt'>, now: number): { startedAt: number | undefined; finishedAt: undefined } {
  const ran = w.startedAt !== undefined && w.finishedAt !== undefined ? w.finishedAt - w.startedAt : undefined;
  return { startedAt: ran === undefined ? w.startedAt : now - ran, finishedAt: undefined };
}

/** One-line description for lists. */
export function describeWorkout(w: Pick<Workout, 'type' | 'cardio' | 'exercises' | 'name' | 'startedAt' | 'finishedAt'>): { title: string; detail: string } {
  if (w.type === 'cardio' && w.cardio) {
    const c = w.cardio;
    return { title: c.activityName, detail: `${Math.round(c.durationMin * 10) / 10} min` };
  }
  const ex = w.exercises ?? [];
  const sets = ex.reduce((n, e) => n + e.sets.filter(isSetLogged).length, 0);
  const took = sessionMinutes(w);
  const parts = [`${ex.length} ${ex.length === 1 ? 'exercise' : 'exercises'}`, `${sets} ${sets === 1 ? 'set' : 'sets'}`, ...(took !== undefined ? [formatMinutes(took)] : [])];
  return { title: w.name?.trim() || 'Strength', detail: parts.join(' · ') };
}
