import type { CardioDetails, SetType, Workout, WorkoutExercise, WorkoutSet } from '../db/schema';
import { displayWeight, weightUnit, type UnitSystem } from './units';

/** What counts toward the calorie total for a cardio workout: the user's own number wins over the estimate. */
export const cardioKcal = (c: CardioDetails): number | undefined => c.kcalOverride ?? c.kcalEstimated;

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Added load of a set: for bodyweight sets, what was added on top of body weight; otherwise the weight itself. */
export const addedLoadKg = (s: Pick<WorkoutSet, 'weightKg' | 'bodyweightKg'>): number =>
  s.bodyweightKg !== undefined ? Math.max(0, Math.round((s.weightKg - s.bodyweightKg) * 100) / 100) : s.weightKg;

/** Whether a set has anything in it (a timed or bodyweight set may have no weight at all). */
export const isSetLogged = (s: Pick<WorkoutSet, 'reps' | 'weightKg' | 'bodyweightKg' | 'durationSec'>): boolean =>
  s.reps > 0 || (s.durationSec ?? 0) > 0 || addedLoadKg(s) > 0;

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

type SummarySet = Pick<WorkoutSet, 'type' | 'reps' | 'weightKg' | 'durationSec' | 'bodyweightKg'>;

/**
 * "3×8 @ 60 kg" when all working sets match, otherwise "8 @ 60, 8 @ 60, 6 @ 62.5 kg". Warm-ups are left out.
 * Timed sets read "3×45 s", bodyweight sets "3×8 @ BW" or "3×8 @ BW + 10 kg".
 * Used for "Last time: …" so you know what to beat at a glance.
 */
export function summarizeSets(sets: SummarySet[], units: UnitSystem, how: { mode?: 'reps' | 'time'; load?: 'weight' | 'bodyweight' } = {}): string {
  const isTime = how.mode === 'time';
  const working = sets.filter((s) => s.type === 'working' && (isTime ? (s.durationSec ?? 0) > 0 : s.reps > 0 || (s.durationSec ?? 0) > 0));
  if (working.length === 0) return '';
  const w = (kg: number) => fmt(displayWeight(kg, units));
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

export function newSet(id: string, type: SetType = 'working', from?: Pick<WorkoutSet, 'reps' | 'weightKg' | 'durationSec' | 'bodyweightKg'>): WorkoutSet {
  const set: WorkoutSet = { id, type, reps: from?.reps ?? 0, weightKg: from?.weightKg ?? 0 };
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

/** A fresh copy of a workout on another day: new set ids, nothing shared with the original. */
export function copyExercises(exercises: WorkoutExercise[], newId: () => string): WorkoutExercise[] {
  return exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, id: newId() })) }));
}

/** One-line description for lists. */
export function describeWorkout(w: Pick<Workout, 'type' | 'cardio' | 'exercises' | 'name'>): { title: string; detail: string } {
  if (w.type === 'cardio' && w.cardio) {
    const c = w.cardio;
    return { title: c.activityName, detail: `${Math.round(c.durationMin)} min` };
  }
  const ex = w.exercises ?? [];
  const sets = ex.reduce((n, e) => n + e.sets.filter(isSetLogged).length, 0);
  return { title: w.name?.trim() || 'Strength', detail: `${ex.length} ${ex.length === 1 ? 'exercise' : 'exercises'} · ${sets} ${sets === 1 ? 'set' : 'sets'}` };
}
