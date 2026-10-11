import * as v from 'valibot';
import type { WorkoutExercise, WorkoutSet } from '../db/schema';
import { isDay } from '../domain/dates';
import { toKg, type UnitSystem } from '../domain/units';
import { normalizeSupersets } from '../domain/workouts';
import { search, type Searchable } from '../search/rank';
import type { Exercise } from '../data/exercises';

/** The reply format the "ask for a workout" prompt describes. Lenient about what an AI is likely to add, strict about numbers. */
const amount = (max: number) => v.pipe(v.number(), v.minValue(0), v.maxValue(max));
const aiSet = v.object({
  type: v.optional(v.picklist(['warmup', 'working'])),
  reps: v.optional(amount(1000)),
  weight: v.optional(amount(2000)),
  added: v.optional(amount(2000)),
  seconds: v.optional(amount(36000)),
});
const aiExercise = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  mode: v.optional(v.picklist(['reps', 'time'])),
  load: v.optional(v.picklist(['weight', 'bodyweight'])),
  superset: v.optional(v.union([v.pipe(v.string(), v.maxLength(20)), v.number()])),
  sets: v.pipe(v.array(aiSet), v.minLength(1), v.maxLength(20)),
});
export const aiWorkoutSchema = v.object({
  fitwell: v.literal('workout'),
  version: v.optional(v.number()),
  day: v.optional(v.string()),
  name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80))),
  units: v.optional(v.picklist(['kg', 'lb'])),
  exercises: v.pipe(v.array(aiExercise), v.minLength(1), v.maxLength(30)),
});
export type AiWorkout = v.InferOutput<typeof aiWorkoutSchema>;
export type AiExercise = AiWorkout['exercises'][number];

export type ParseResult = { ok: true; workout: AiWorkout } | { ok: false; reason: 'no-json' | 'not-fitwell' | 'invalid' | 'bad-day'; where?: string };

/** JSON candidates in a reply: fenced code blocks first, then the outermost braces. */
function candidates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) out.push(m[1]!.trim());
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) out.push(text.slice(a, b + 1));
  return out;
}

/** Reads whatever the AI sent back: prose around a code block is fine, and so are curly quotes in the prose. */
export function parseAiReply(text: string): ParseResult {
  let sawJson = false;
  let last: ParseResult = { ok: false, reason: 'no-json' };
  for (const c of candidates(text)) {
    let data: unknown;
    try {
      data = JSON.parse(c);
    } catch {
      continue;
    }
    sawJson = true;
    const r = v.safeParse(aiWorkoutSchema, data);
    if (r.success) {
      if (r.output.day !== undefined && !isDay(r.output.day)) return { ok: false, reason: 'bad-day' };
      return { ok: true, workout: r.output };
    }
    const looksRight = typeof data === 'object' && data !== null && (data as { fitwell?: unknown }).fitwell === 'workout';
    last = looksRight ? { ok: false, reason: 'invalid', where: r.issues[0]?.path?.slice(0, 3).map((p) => String(p.key)).join(' › ') } : { ok: false, reason: 'not-fitwell' };
  }
  return sawJson ? last : { ok: false, reason: 'no-json' };
}

/** "Push-Up", "Push-Ups" and "Pushups" are the same exercise. */
const compact = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').replace(/s$/, '');

const VARIATION = /\b(with|bands?|chains?|machine|smith|wide|close|reverse|incline|decline|one|single|alternate|alternating|seated|kneeling|suspended|leverage|lying|cable|stiff|sumo)\b/g;

export interface Suggestion {
  /** A library or own exercise whose name is the same, ignoring case, hyphens and plurals. */
  exact?: Exercise;
  /** Closest others, best first. */
  options: Exercise[];
}

export function suggest(name: string, index: Searchable<Exercise>[], all: Exercise[]): Suggestion {
  const key = compact(name);
  const exact = all.find((e) => compact(e.name) === key);
  // The search ranks short names first, which favours odd variations ("Bench Press with Chains"). Put plain versions ahead.
  const asked = new Set(key.length ? name.toLowerCase().split(/[^a-z]+/) : []);
  const oddness = (e: Exercise) => (e.name.toLowerCase().match(VARIATION) ?? []).filter((w) => !asked.has(w)).length;
  const options = search(index, name, 12)
    .filter((e) => e !== exact)
    .map((e, i) => ({ e, i, o: oddness(e) }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .slice(0, 6)
    .map((x) => x.e);
  return { exact, options };
}

/** What to do with each exercise from the reply: an existing one (by ref), a new one of your own, or leave it out. */
export type Choice = { kind: 'ref'; ref: string; name: string } | { kind: 'own' } | { kind: 'skip' };

export function defaultChoice(s: Suggestion): Choice {
  const hit = s.exact ?? s.options[0];
  return hit ? { kind: 'ref', ref: hit.ref, name: hit.name } : { kind: 'own' };
}

export interface BuildInput {
  workout: AiWorkout;
  choices: Choice[];
  /** Units of the numbers in the reply when it does not say. */
  defaultUnits: UnitSystem;
  /** Body weight to store with bodyweight sets (0 when unknown). */
  bodyKg: number;
  newId: () => string;
  /** Ref for exercises the person asked to keep as their own (created by the caller before building). */
  ownRef: (name: string) => string;
}

/** Turns a reply into stored exercises: kg, fresh ids, supersets tidied. Skipped exercises are left out. */
export function buildExercises(i: BuildInput): WorkoutExercise[] {
  const units: UnitSystem = i.workout.units ? (i.workout.units === 'kg' ? 'metric' : 'imperial') : i.defaultUnits;
  const labels = new Map<string, string>();
  const out: WorkoutExercise[] = [];
  i.workout.exercises.forEach((ex, n) => {
    const choice = i.choices[n] ?? { kind: 'own' as const };
    if (choice.kind === 'skip') return;
    const ref = choice.kind === 'ref' ? choice.ref : i.ownRef(ex.name);
    const name = choice.kind === 'ref' ? choice.name : ex.name;
    const bodyweight = ex.load === 'bodyweight';
    const timed = ex.mode === 'time' || (ex.mode === undefined && ex.sets.every((s) => (s.seconds ?? 0) > 0 && !(s.reps ?? 0)));
    const sets: WorkoutSet[] = ex.sets.map((s) => {
      const added = toKg(bodyweight ? (s.added ?? s.weight ?? 0) : (s.weight ?? 0), units);
      const set: WorkoutSet = { id: i.newId(), type: s.type ?? 'working', done: false, reps: timed ? 0 : Math.round((s.reps ?? 0) * 100) / 100, weightKg: bodyweight ? i.bodyKg + added : added };
      if ((s.seconds ?? 0) > 0) set.durationSec = Math.round(s.seconds!);
      if (bodyweight) set.bodyweightKg = i.bodyKg;
      return set;
    });
    const label = ex.superset === undefined ? undefined : String(ex.superset);
    if (label !== undefined && !labels.has(label)) labels.set(label, i.newId());
    out.push({
      uid: i.newId(),
      exerciseRef: ref,
      exerciseName: name,
      ...(label !== undefined ? { supersetId: labels.get(label)! } : {}),
      ...(timed ? { mode: 'time' as const } : {}),
      ...(bodyweight ? { load: 'bodyweight' as const } : {}),
      sets,
    });
  });
  return normalizeSupersets(out, i.newId);
}
