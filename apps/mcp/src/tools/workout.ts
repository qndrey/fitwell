import { ACTIVITIES, SESSION_CATEGORIES } from '@fitwell/core/data/activities';
import { loadExercises, substitutes, type Exercise } from '@fitwell/core/data/exercises';
import { addDays, isDay } from '@fitwell/core/domain/dates';
import { muscleCredit } from '../analytics/muscles';
import { estimateKcal } from '@fitwell/core/domain/met';
import { STANDARD_GYM, warmupRamp, type Gym } from '@fitwell/core/domain/plates';
import { suggestProgression, type Progression, type SessionSets } from '@fitwell/core/domain/progression';
import { estimatedOneRepMax, formatDuration, normalizeSupersets, summarizeSets } from '@fitwell/core/domain/workouts';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import type { CardioBlock, StoredExercise, StoredRest, StoredSet, TemplateCardio, TemplateExercise, Workout, WorkoutData } from '../data/workoutData';
import workoutHtml from '../ui/generated/workout';
import { exerciseBests, sessionBest } from '../workout/bests';
import { SESSION_PROFILES } from '../workout/sessions';
import { EFFORT_LABELS, WORKOUT_VIEW_URI, type ExerciseBests, type PlannedCardio, type PlannedExercise, type PlannedRest, type WorkoutPlan } from '../workout/plan';
import { loadMuscleMap } from './muscles';
import { json, toolError } from './result';

export interface WorkoutDeps {
  data: UserData;
  workouts: WorkoutData;
}

const day = z.string().refine(isDay, 'Use YYYY-MM-DD');
const exerciseId = z.string().regex(/^ex:/, 'Library ids start with "ex:"');
const planItem = z.object({
  id: exerciseId,
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(50).optional().describe('Target reps; leave out for a timed exercise'),
  seconds: z.number().int().min(5).max(600).optional().describe('A timed exercise (plank, hold): seconds per set instead of reps'),
  weight_kg: z.number().min(0).max(500).optional().describe('Omit to use the suggestion from past sessions (or last time\'s weight)'),
  rest_sec: z.number().int().min(0).max(600).default(90),
  notes: z.string().max(300).optional().describe('A note for this exercise, shown in the player ("seat 4", "slow negatives")'),
  superset: z.string().regex(/^[A-Za-z]$/, 'One letter').optional().describe('Neighbouring exercises with the same letter form a superset: done back to back, rest after the round'),
  warmup: z.boolean().optional().describe('Warm-up sets: leave out to let Fitwell decide (heavy barbell compound lifts get a ramp), true or false to choose'),
});

/** An error when a plan item has neither reps nor seconds. */
function missingReps(items: z.infer<typeof planItem>[] | undefined): string | null {
  const bad = (items ?? []).find((e) => e.reps === undefined && e.seconds === undefined);
  return bad ? `Give reps (or seconds for a timed exercise) for ${bad.id}.` : null;
}

/** The stored form of a plan item (templates and new workouts). */
const templateItemOf = (e: z.infer<typeof planItem>): TemplateExercise => ({
  id: e.id,
  sets: e.sets,
  reps: e.seconds ? 0 : (e.reps ?? 8),
  ...(e.seconds ? { seconds: e.seconds } : {}),
  ...(e.weight_kg !== undefined ? { weightKg: e.weight_kg } : {}),
  restSec: e.rest_sec,
  ...(e.notes ? { notes: e.notes } : {}),
  ...(e.superset ? { superset: e.superset.toUpperCase() } : {}),
  ...(e.warmup !== undefined ? { warmup: e.warmup } : {}),
});
const cardioItem = z.object({
  activity_id: z.string().regex(/^act:/, 'Activity ids start with "act:"').describe('The same activity ids log_cardio takes, e.g. act:run-10'),
  minutes: z.number().int().min(1).max(240),
  when: z.enum(['before', 'after']).default('after').describe('before = warm-up ahead of the lifting, after = finisher'),
  distance_km: z.number().min(0).max(500).optional(),
});

const r1 = (n: number) => Math.round(n * 10) / 10;
const isBodyweight = (ex: Exercise) => ex.equipment === 'body only';
/** Lifts that get a warm-up ramp unless the plan says otherwise. */
const heavyLift = (ex: Exercise) => ex.equipment === 'barbell' && ex.mechanic === 'compound';
/** Warm-up steps for equipment without a bar: whole 2.5 kg steps. */
const NO_BAR: Gym = { barKg: 0, platesKg: [1.25] };
const effortSchema = z.number().int().min(1).max(4).describe('How hard the set felt: 1 Easy, 2 Solid, 3 Hard, 4 Max');
/** "set 1 Solid, set 2 Hard": the effort of the working sets that have one, numbered as edit_workout_set numbers them. Empty when none. */
function effortText(e: StoredExercise): string {
  const working = e.sets.filter((s) => s.type === 'working');
  return working.flatMap((s, i) => (s.done !== false && s.effort ? [`set ${i + 1} ${EFFORT_LABELS[s.effort - 1]}`] : [])).join(', ');
}
const sessionOf = (d: string, e: StoredExercise): SessionSets => ({ day: d, sets: e.sets });

/** "3×5 @ 80 kg", "8, 8, 6 @ BW", or one line for a cardio session. */
function summarizeExercise(e: StoredExercise): string {
  return summarizeSets(e.sets, 'metric', { load: e.load, ...(e.mode ? { mode: e.mode } : {}) });
}

/** One finished cardio block as Claude reads it. */
function cardioLine(b: CardioBlock) {
  return { activity: b.activityName, when: b.when, minutes: b.durationMin ?? b.plannedMin, ...(b.distanceKm ? { distanceKm: b.distanceKm } : {}), ...(b.kcalEstimated ? { kcal: b.kcalEstimated } : {}) };
}

function summarizeWorkout(w: Workout) {
  if (w.type === 'cardio' && w.cardio) {
    const c = w.cardio;
    return { id: w.id, day: w.day, type: 'cardio' as const, activity: c.activityName, minutes: c.durationMin, ...(c.distanceKm ? { distanceKm: c.distanceKm } : {}), ...(c.kcalOverride ?? c.kcalEstimated ? { kcal: c.kcalOverride ?? c.kcalEstimated } : {}) };
  }
  if (w.type === 'session' && w.session) {
    const c = w.session;
    return { id: w.id, day: w.day, type: 'session' as const, category: c.category, name: w.name, minutes: c.durationMin, ...(c.kcalOverride ?? c.kcalEstimated ? { kcal: c.kcalOverride ?? c.kcalEstimated } : {}), ...(c.notes ? { notes: c.notes } : {}) };
  }
  const minutes = w.startedAt && w.finishedAt ? Math.round((w.finishedAt - w.startedAt) / 60000) : undefined;
  return {
    id: w.id,
    day: w.day,
    type: 'strength' as const,
    name: w.name,
    finished: w.finishedAt !== null,
    ...(minutes !== undefined ? { minutes } : {}),
    exercises: w.exercises.map((e) => ({ id: e.exerciseRef, name: e.exerciseName, done: summarizeExercise(e) || 'nothing logged', ...(effortText(e) ? { effort: effortText(e) } : {}), ...(e.notes ? { notes: e.notes } : {}) })),
    ...(w.cardioBlocks.some((b) => b.done) ? { cardio: w.cardioBlocks.filter((b) => b.done).map(cardioLine) } : {}),
  };
}

/** How long after it ran out a rest is still reported, so a reload right then can show "Rest over". */
const REST_GRACE_MS = 3000;
/** The rest to resume, by the server's clock: none once finished or when it ended more than the grace period ago. */
function restOf(w: Workout): PlannedRest | undefined {
  if (!w.rest || w.finishedAt !== null) return undefined;
  const remainingMs = w.rest.untilMs - Date.now();
  return remainingMs > -REST_GRACE_MS ? { exerciseUid: w.rest.exerciseUid, remainingMs, totalMs: w.rest.totalMs } : undefined;
}

/** The player's view of a stored workout (also used to resume one). */
function toPlan(w: Workout, gym?: Gym, bests?: Map<string, ExerciseBests>, ctx?: PlanContext): WorkoutPlan {
  return {
    workoutId: w.id,
    name: w.name ?? 'Workout',
    startedAt: w.startedAt ?? w.createdAt,
    finished: w.finishedAt !== null,
    exercises: w.exercises.map(
      (e, i): PlannedExercise => ({
        uid: e.uid ?? `e${i + 1}`,
        id: e.exerciseRef,
        name: e.exerciseName,
        equipment: e.equipment ?? '',
        restSec: e.restSec ?? 90,
        bodyweight: e.load === 'bodyweight',
        ...(e.mode === 'time' ? { timed: true } : {}),
        ...(e.supersetId ? { supersetId: e.supersetId } : {}),
        sets: e.sets.map((s) => ({
          id: s.id,
          ...(s.type === 'warmup' ? { warmup: true } : {}),
          targetReps: s.targetReps ?? s.reps,
          ...(e.mode === 'time' ? { targetSec: s.targetSec ?? s.durationSec ?? 0 } : {}),
          ...(e.load === 'bodyweight' ? {} : { weightKg: s.weightKg }),
          done: s.done !== false,
          ...(s.done !== false ? { reps: s.reps, ...(e.mode === 'time' ? { seconds: s.durationSec ?? 0 } : {}) } : {}),
          ...(s.skipped ? { skipped: true } : {}),
          ...(s.effort && s.done !== false ? { effort: s.effort } : {}),
        })),
        ...(bests?.get(e.uid ?? `e${i + 1}`) ? { bests: bests.get(e.uid ?? `e${i + 1}`) } : {}),
        ...(ctx?.musclesOf(e.exerciseRef) ? { muscles: ctx.musclesOf(e.exerciseRef) } : {}),
        ...(e.lastTime ? { lastTime: e.lastTime } : {}),
        ...(e.note ? { note: e.note } : {}),
        ...(e.notes ? { notes: e.notes } : {}),
        ...(e.lastNotes ? { lastNotes: e.lastNotes } : {}),
      }),
    ),
    ...(restOf(w) ? { rest: restOf(w) } : {}),
    ...(gym ? { gym } : {}),
    cardio: w.cardioBlocks.map(
      (b): PlannedCardio => ({
        id: b.id,
        name: b.activityName,
        when: b.when,
        plannedMin: b.plannedMin,
        ...(b.plannedKm ? { plannedKm: b.plannedKm } : {}),
        ...(b.done ? { minutes: b.durationMin ?? b.plannedMin, done: true } : { done: false }),
        ...(b.distanceKm ? { distanceKm: b.distanceKm } : {}),
        ...(b.skipped ? { skipped: true } : {}),
        ...(b.done && b.kcalEstimated ? { kcal: b.kcalEstimated } : {}),
        ...(!b.done && estimateKcal(b.met, ctx?.weightKg ?? undefined, b.plannedMin) ? { estKcal: estimateKcal(b.met, ctx?.weightKg ?? undefined, b.plannedMin) } : {}),
        ...(ctx?.last.get(b.activityRef) ? { last: lastCardioText(ctx.last.get(b.activityRef)!) } : {}),
      }),
    ),
  };
}

/** What the plan needs besides the workout: the body weight for the cardio estimate, the last time of each activity and the muscles of a library exercise. */
interface PlanContext {
  weightKg: number | null | undefined;
  last: Map<string, { minutes: number; distanceKm?: number }>;
  musclesOf: (exerciseRef: string) => [string, number][] | undefined;
}

const lastCardioText = (c: { minutes: number; distanceKm?: number }) => `${c.minutes} min${c.distanceKm ? ` · ${r1(c.distanceKm)} km` : ''}`;

/** An error message when a cardio spec names an activity that does not exist. */
function unknownActivity(specs: { activity_id: string }[] | undefined): string | null {
  const bad = (specs ?? []).find((c) => !ACTIVITIES.some((a) => a.id === c.activity_id));
  return bad ? `Unknown activity id ${bad.activity_id}. Use one of the ids log_cardio lists, e.g. ${ACTIVITIES.slice(0, 3).map((a) => a.id).join(', ')}.` : null;
}

const templateCardioOf = (c: z.infer<typeof cardioItem>): TemplateCardio => ({ activityId: c.activity_id, minutes: c.minutes, when: c.when, ...(c.distance_km ? { distanceKm: c.distance_km } : {}) });

/** Planned blocks for a new workout; templates may name an activity that no longer exists, which is dropped. */
function blocksFrom(specs: TemplateCardio[], done = false, weightKg?: number | null): CardioBlock[] {
  const out: CardioBlock[] = [];
  for (const c of specs) {
    const a = ACTIVITIES.find((x) => x.id === c.activityId);
    if (!a) continue;
    const kcal = done ? estimateKcal(a.met, weightKg ?? undefined, c.minutes) : undefined;
    out.push({
      id: `c${out.length + 1}`,
      when: c.when,
      activityRef: a.id,
      activityName: a.name,
      met: a.met,
      plannedMin: c.minutes,
      ...(c.distanceKm ? { plannedKm: c.distanceKm } : {}),
      done,
      ...(done ? { durationMin: c.minutes, ...(c.distanceKm ? { distanceKm: c.distanceKm } : {}), ...(kcal !== undefined && weightKg ? { kcalEstimated: kcal, weightKgUsed: weightKg } : {}) } : {}),
    });
  }
  return out;
}

/** What earlier sessions say about an exercise: last time, the last note and the next weight. */
interface History {
  lastTime?: string;
  lastDay?: string;
  lastNotes?: string;
  progression: Progression | null;
}

export async function registerWorkoutTools(server: McpServer, deps: WorkoutDeps) {
  const lib = await loadExercises();
  const byId = new Map(lib.exercises.map((e) => [e.ref, e]));
  const { data, workouts } = deps;

  /** Last time + suggestion for each exercise id. */
  async function history(ids: string[], exclude?: string) {
    const sessions = await workouts.recentSessions(ids, 3, exclude);
    const out = new Map<string, History>();
    for (const id of ids) {
      const list = sessions.get(id) ?? [];
      const last = list[0];
      out.set(id, {
        ...(last ? { lastTime: summarizeExercise(last.exercise), lastDay: last.day } : {}),
        ...(last?.exercise.notes ? { lastNotes: last.exercise.notes } : {}),
        progression: suggestProgression(list.map((s) => sessionOf(s.day, s.exercise)), byId.get(id)?.equipment),
      });
    }
    return out;
  }

  /** One planned exercise of a new workout: sets at the planned (or progressed) weight, last time and last note. */
  /**
   * One planned exercise of a new workout: sets at the planned (or progressed) weight, last time and last note, and
   * warm-up sets when `ramp` says so (decided per workout: the first heavy lift gets the full ramp, later ones a short one).
   */
  function buildExercise(item: TemplateExercise, i: number, h: History, bodyKg: number | null, ramp: 'full' | 'short' | null = null, gym: Gym = STANDARD_GYM): StoredExercise {
    const ex = byId.get(item.id)!;
    const bodyweight = isBodyweight(ex);
    const timed = (item.seconds ?? 0) > 0;
    const p = timed ? null : h.progression;
    // An explicit weight wins; otherwise the progression suggestion; otherwise last time's working weight.
    const weightKg = bodyweight ? (bodyKg ?? 0) : (item.weightKg ?? p?.weightKg ?? 0);
    const note = item.weightKg !== undefined || bodyweight || timed ? undefined : (p?.reason ?? 'No earlier sessions to go on: choose a starting weight.');
    const warmups = ramp && !bodyweight && !timed ? warmupRamp(weightKg, ramp, ex.equipment === 'barbell' ? gym : NO_BAR) : [];
    const sets: StoredSet[] = [
      ...warmups.map((wu, k): StoredSet => ({ id: `w${i + 1}.${k + 1}`, type: 'warmup', reps: wu.reps, targetReps: wu.reps, weightKg: wu.weightKg, done: false })),
      ...Array.from({ length: item.sets }, (_, k): StoredSet => ({
        id: `s${i + 1}.${k + 1}`,
        type: 'working',
        reps: timed ? 0 : item.reps,
        targetReps: timed ? 0 : item.reps,
        ...(timed ? { durationSec: item.seconds, targetSec: item.seconds } : {}),
        weightKg,
        ...(bodyweight && bodyKg ? { bodyweightKg: bodyKg } : {}),
        done: false,
      })),
    ];
    return {
      uid: `e${i + 1}`,
      exerciseRef: item.id,
      exerciseName: ex.name,
      equipment: ex.equipment,
      load: bodyweight ? 'bodyweight' : 'weight',
      ...(timed ? { mode: 'time' as const } : {}),
      ...(item.superset ? { supersetId: `ss-${item.superset}` } : {}),
      restSec: item.restSec,
      sets,
      ...(h.lastTime ? { lastTime: `${h.lastTime} (${h.lastDay})` } : {}),
      ...(note ? { note } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
      ...(h.lastNotes ? { lastNotes: h.lastNotes } : {}),
    };
  }

  /** Warm-up ramps for a workout, in order: the first heavy lift (or any marked warmup: true) gets the full ramp, later ones a short one. */
  function ramps(items: TemplateExercise[]): ('full' | 'short' | null)[] {
    let first = true;
    return items.map((item) => {
      const ex = byId.get(item.id)!;
      const wanted = item.warmup ?? (heavyLift(ex) && !item.seconds);
      if (!wanted || isBodyweight(ex) || item.seconds) return null;
      const kind = first ? 'full' : 'short';
      first = false;
      return kind;
    });
  }

  /** Earlier sessions of the workout's exercises (the same ones the finish summary compares with). */
  const priorSessions = (w: Workout) => workouts.recentSessions(w.exercises.map((e) => e.exerciseRef), 20, w.id);

  /** What a working set of an exercise counts for per muscle (the muscle map's credit, a few muscles of each kind), for the player's sets-per-muscle line. */
  function musclesOf(ref: string): [string, number][] | undefined {
    const ex = byId.get(ref);
    const credit = ex ? muscleCredit(ex.primary.slice(0, 3), ex.secondary.slice(0, 4)) : [];
    return credit.length ? credit.map(([m, k]) => [m, k]) : undefined;
  }

  /** Body weight, the last time of each cardio block's activity (nothing is read for a workout without cardio) and the muscles. */
  async function planContext(w: Workout, weightKg: number | null | undefined): Promise<PlanContext> {
    return { weightKg, musclesOf, last: w.cardioBlocks.length ? await workouts.lastCardio([...new Set(w.cardioBlocks.map((b) => b.activityRef))], w.id) : new Map() };
  }

  /** The record cue's side of the comparison, per exercise uid: weighted, rep-based exercises with an earlier working set only. */
  async function bestsFor(w: Workout): Promise<Map<string, ExerciseBests>> {
    const prior = await priorSessions(w);
    const out = new Map<string, ExerciseBests>();
    w.exercises.forEach((e, i) => {
      if (e.load === 'bodyweight' || e.mode === 'time') return;
      const b = exerciseBests(prior.get(e.exerciseRef) ?? [], w.day);
      if (b) out.set(e.uid ?? `e${i + 1}`, b);
    });
    return out;
  }

  /** Time, volume and personal records of a strength workout. Records compare with sessions up to that workout's day. */
  async function finishSummary(w: Workout) {
    const prior = await priorSessions(w);
    const best = sessionBest;
    let volumeKg = 0;
    const exercises = w.exercises.map((e) => {
      const done = e.sets.filter((s) => s.done !== false && s.type === 'working');
      if (e.load !== 'bodyweight') volumeKg += done.reduce((n, s) => n + s.weightKg * s.reps, 0);
      const now = best(e.sets);
      const before = Math.max(0, ...(prior.get(e.exerciseRef) ?? []).filter((p) => p.day <= w.day).map((p) => best(p.exercise.sets)));
      return {
        name: e.exerciseName,
        done: summarizeExercise(e) || 'skipped',
        ...(effortText(e) ? { effort: effortText(e) } : {}),
        ...(e.notes ? { notes: e.notes } : {}),
        ...(e.load !== 'bodyweight' && now > 0 ? { estimated1rmKg: r1(now) } : {}),
        ...(e.load !== 'bodyweight' && now > 0 && before > 0 && now > before + 0.01 ? { personalRecord: `New best estimated 1RM: ${r1(now)} kg (was ${r1(before)} kg)` } : {}),
      };
    });
    const minutes = Math.round(((w.finishedAt ?? Date.now()) - (w.startedAt ?? w.createdAt)) / 60000);
    const cardio = w.cardioBlocks.filter((b) => b.done).map(cardioLine);
    return { workoutId: w.id, name: w.name, day: w.day, minutes, volumeKg: Math.round(volumeKg), exercises, ...(cardio.length ? { cardio } : {}), ...(await muscleReport(w)) };
  }

  /** Small muscle groups that other lifts train anyway: never suggested as "due". */
  const MINOR_MUSCLES = new Set(['neck', 'forearms', 'abductors', 'adductors']);

  /**
   * What the workout did to the body, for the finish overview: working sets per muscle in this session (the muscle map's credit),
   * the muscles that took the most (give them a rest) and the big ones with no set in the last 7 days up to this workout (due next).
   * Left out when it cannot be read: the summary does not depend on it.
   */
  async function muscleReport(w: Workout) {
    try {
      const sets = new Map<string, number>();
      for (const e of w.exercises) {
        const done = e.sets.filter((s) => s.done !== false && s.type === 'working').length;
        if (!done) continue;
        for (const [m, k] of musclesOf(e.exerciseRef) ?? []) sets.set(m, (sets.get(m) ?? 0) + done * k);
      }
      const map = await loadMuscleMap({ data, workouts }, 1, w.day);
      const muscles = [...sets].map(([muscle, n]) => ({ muscle, sets: r1(n) })).sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
      const recover = muscles.filter((m) => m.sets >= 2).slice(0, 4).map((m) => m.muscle);
      const due = map.muscles.filter((m) => m.setsPerWeek === 0 && !MINOR_MUSCLES.has(m.muscle)).map((m) => m.muscle).slice(0, 4);
      return muscles.length ? { muscles, next: { recover, due, weekSessions: map.sessions } } : {};
    } catch {
      return {};
    }
  }

  registerAppResource(server, 'Workout player', WORKOUT_VIEW_URI, { description: 'Runs a workout: sets, reps, weights, rest timer, last time.' }, async () => ({
    contents: [{ uri: WORKOUT_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: workoutHtml }],
  }));

  registerAppTool(
    server,
    'start_workout',
    {
      title: 'Start a workout',
      description:
        'Opens the interactive workout player and saves the workout. Give either a saved template (template_id from list_workout_templates) or exercises ' +
        '(ids from search_exercises) with sets, target reps, weight in kg and rest. Leave weight_kg out to let Fitwell fill it from past sessions ' +
        '(progression rule: add a step when every set hit its reps, repeat after a miss, deload after two). Bodyweight exercises need no weight. ' +
        'Each exercise shows "last time" in the player. The person logs sets there; at the end the player sends you a summary. ' +
        'The player is the last thing in your reply: put any planning notes before calling this tool and write nothing after it, because text under the player makes the chat scroll away from it. ' +
        'cardio adds cardio blocks to the workout: when "before" is a warm-up ahead of the lifting, "after" a finisher; the player runs them as steps and they count toward cardio minutes. ' +
        'Each exercise can carry a note, and the note from the last session shows as a reminder. save_as_template stores the plan (with cardio and notes) under a name for next time. ' +
        'seconds instead of reps makes a timed exercise (plank, hold) with a countdown in the player. Neighbouring exercises with the same superset letter are done back to back with rest after the round. ' +
        'Heavy barbell compound lifts get warm-up sets automatically (a ramp from the empty bar for the first, a short one for later lifts; they never count in records); warmup: false turns that off, true adds a ramp to another exercise. ' +
        'The player shows the plates for each side from the person\'s bar and plates (update_profile bar_kg, plates_kg).',
      inputSchema: z.object({
        name: z.string().min(1).max(60).optional(),
        template_id: z.uuid().optional(),
        exercises: z.array(planItem).min(1).max(15).optional(),
        cardio: z.array(cardioItem).max(4).optional().describe('With a template: replaces the template\'s cardio'),
        save_as_template: z.string().min(1).max(60).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI } },
    },
    async (args) => {
      let items: TemplateExercise[];
      let cardioSpecs: TemplateCardio[] = [];
      let templateId: string | null = null;
      let name = args.name;
      if (args.template_id) {
        const t = await workouts.template(args.template_id);
        if (!t) return toolError('No such template. Use list_workout_templates.');
        items = t.exercises;
        cardioSpecs = t.cardio;
        templateId = t.id;
        name ??= t.name;
        await workouts.touchTemplate(t.id);
      } else if (args.exercises) {
        items = args.exercises.map(templateItemOf);
      } else {
        return toolError('Give template_id or exercises.');
      }
      const unknown = items.filter((e) => !byId.has(e.id)).map((e) => e.id);
      if (unknown.length) return toolError(`Unknown exercise ids: ${unknown.join(', ')}. Use search_exercises to find valid ids.`);
      const badActivity = unknownActivity(args.cardio) ?? missingReps(args.exercises);
      if (badActivity) return toolError(badActivity);
      if (args.cardio) cardioSpecs = args.cardio.map(templateCardioOf);
      if (args.save_as_template) templateId = (await workouts.saveTemplate(args.save_as_template, items, cardioSpecs)).id;

      const past = await history(items.map((e) => e.id));
      const profile = await data.profile();
      const kinds = ramps(items);
      const exercises = normalizeSupersets(
        items.map((item, i) => buildExercise(item, i, past.get(item.id)!, profile.weightKg, kinds[i], profile.gym)),
        (() => {
          let n = 0;
          return () => `ss${++n}`;
        })(),
      ) as StoredExercise[];
      const cardioBlocks = blocksFrom(cardioSpecs);
      const w = await workouts.create({ day: todayIn(profile.timeZone), type: 'strength', name: name ?? 'Workout', startedAt: Date.now(), finishedAt: null, exercises, cardio: null, session: null, cardioBlocks, templateId });
      const lines = exercises.map((e) => {
        const work = e.sets.filter((x) => x.type === 'working');
        const warm = e.sets.length - work.length;
        const what = e.mode === 'time' ? `${work.length}×${work[0]!.durationSec} s` : `${work.length}×${work[0]!.targetReps}${e.load === 'bodyweight' ? '' : ` @ ${work[0]!.weightKg} kg`}`;
        return `${e.supersetId ? '[superset] ' : ''}${e.exerciseName} ${what}${warm ? ` after ${warm} warm-up sets` : ''}${e.lastTime ? ` (last time ${e.lastTime})` : ''}`;
      });
      const result = json({ workout: toPlan(w, profile.gym, await bestsFor(w), await planContext(w, profile.weightKg)), ...(args.save_as_template ? { savedTemplate: args.save_as_template } : {}) });
      const cardioText = cardioBlocks.length ? ` Cardio: ${cardioBlocks.map((b) => `${b.plannedMin} min ${b.activityName} (${b.when === 'before' ? 'warm-up' : 'finisher'})`).join('; ')}.` : '';
      result.content = [{ type: 'text', text: `Workout "${w.name}" is open in the player (id ${w.id}): ${lines.join('; ')}.${cardioText} The player shows all of this: reply with nothing more, no summary or recap.` }];
      return result;
    },
  );

  registerAppTool(
    server,
    'get_workout',
    {
      title: 'Current state of a workout',
      description: 'The stored state of a workout, so the player can pick up where it left off after a reload or on another device.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      const profile = await data.profile();
      return json({ workout: toPlan(w, profile.gym, w.finishedAt === null ? await bestsFor(w) : undefined, await planContext(w, profile.weightKg)) });
    },
  );

  registerAppTool(
    server,
    'log_set',
    {
      title: 'Log a set',
      description: 'Called by the workout player when a set is done or skipped (or reopened with reopen, to correct a mistake). Saves it to the workout.',
      inputSchema: z.object({
        workoutId: z.uuid(),
        setId: z.string().max(20),
        reps: z.number().int().min(0).max(100),
        weightKg: z.number().min(0).max(500).optional(),
        seconds: z.number().int().min(0).max(3600).optional().describe('For a timed set'),
        skip: z.boolean().default(false),
        reopen: z.boolean().default(false).describe('Undo: the set is open again, as if it had not been logged or skipped'),
        effort: effortSchema.optional().describe('Optional, working sets only: how hard it felt, 1 Easy, 2 Solid, 3 Hard, 4 Max'),
        restSec: z.number().int().min(0).max(900).optional().describe('A rest of this many seconds starts now and replaces the running one; 0 clears it; leave out to keep it. Stored so the player can resume it.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId, setId, reps, weightKg, seconds, skip, reopen, effort, restSec }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      let found = false;
      let exerciseUid = '';
      const exercises = w.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => {
          if (s.id !== setId) return s;
          found = true;
          exerciseUid = e.uid ?? '';
          if (reopen) {
            const open: StoredSet = { ...s, done: false };
            delete open.skipped;
            delete open.effort;
            return open;
          }
          if (skip) {
            const left: StoredSet = { ...s, done: false, skipped: true };
            delete left.effort;
            return left;
          }
          const bodyweight = e.load === 'bodyweight';
          const next: StoredSet = { ...s, reps, weightKg: bodyweight ? s.weightKg : (weightKg ?? s.weightKg), ...(seconds !== undefined ? { durationSec: seconds } : {}), ...(effort !== undefined && s.type === 'working' ? { effort } : {}), done: true };
          delete next.skipped;
          return next;
        }),
      }));
      if (!found) return toolError('No such set in this workout.');
      // One rest at a time: a new one replaces the running one, 0 (or undoing a set) clears it, and leaving it out keeps it.
      const startedAt = Date.now();
      const rest: StoredRest | null | undefined = reopen || restSec === 0 ? null : restSec !== undefined && exerciseUid ? { untilMs: startedAt + restSec * 1000, totalMs: restSec * 1000, exerciseUid } : undefined;
      await workouts.saveExercises(workoutId, exercises, undefined, rest);
      return json({ saved: true, setId, ...(rest ? { restRemainingMs: rest.untilMs - Date.now() } : {}) });
    },
  );

  registerAppTool(
    server,
    'set_rest',
    {
      title: 'Change the running rest',
      description: 'Called by the workout player when the person shortens or lengthens the rest (restSec = time left) or skips it (0). Only changes a rest that log_set started; it never starts one.',
      inputSchema: z.object({ workoutId: z.uuid(), restSec: z.number().int().min(0).max(900), totalSec: z.number().int().min(1).max(900).optional().describe('The length the progress bar counts against') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId, restSec, totalSec }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      if (!w.rest) return json({ saved: false });
      if (restSec === 0) await workouts.saveRest(workoutId, null);
      else await workouts.saveRest(workoutId, { untilMs: Date.now() + restSec * 1000, totalMs: Math.max((totalSec ?? 0) * 1000, restSec * 1000), exerciseUid: w.rest.exerciseUid });
      return json({ saved: true, ...(restSec > 0 ? { restRemainingMs: restSec * 1000 } : {}) });
    },
  );

  registerAppTool(
    server,
    'log_cardio_block',
    {
      title: 'Log a cardio block',
      description: 'Called by the workout player when a cardio block (warm-up or finisher) is done or skipped. Saves it to the workout.',
      inputSchema: z.object({
        workoutId: z.uuid(),
        blockId: z.string().max(20),
        minutes: z.number().min(0).max(240).optional(),
        distanceKm: z.number().min(0).max(500).optional(),
        skip: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId, blockId, minutes, distanceKm, skip }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      const weightKg = (await data.profile()).weightKg;
      let found = false;
      const blocks = w.cardioBlocks.map((b): CardioBlock => {
        if (b.id !== blockId) return b;
        found = true;
        if (skip) return { ...b, done: false, skipped: true };
        const mins = minutes ?? b.plannedMin;
        const kcal = estimateKcal(b.met, weightKg ?? undefined, mins);
        const rest = { ...b };
        delete rest.skipped;
        return { ...rest, done: true, durationMin: mins, ...(distanceKm ? { distanceKm } : {}), ...(kcal !== undefined && weightKg ? { kcalEstimated: kcal, weightKgUsed: weightKg } : {}) };
      });
      if (!found) return toolError('No such cardio block in this workout.');
      await workouts.saveCardioBlocks(workoutId, blocks);
      return json({ saved: true, blockId });
    },
  );

  registerAppTool(
    server,
    'set_exercise_note',
    {
      title: 'Save an exercise note',
      description: 'Called by the workout player when the person writes a note for an exercise. An empty note removes it.',
      inputSchema: z.object({ workoutId: z.uuid(), exerciseId: z.string().max(20), notes: z.string().max(300) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId, exerciseId, notes }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      const text = notes.trim();
      let found = false;
      const exercises = w.exercises.map((e) => {
        if (e.uid !== exerciseId) return e;
        found = true;
        const rest = { ...e };
        delete rest.notes;
        return text ? { ...rest, notes: text } : rest;
      });
      if (!found) return toolError('No such exercise in this workout.');
      await workouts.saveExercises(workoutId, exercises);
      return json({ saved: true, exerciseId });
    },
  );

  registerAppTool(
    server,
    'get_substitutes',
    {
      title: 'Substitutes for an exercise in a workout',
      description: 'Called by the workout player when the person wants to swap an exercise: similar exercises for the same main muscles, within their equipment.',
      inputSchema: z.object({ workoutId: z.uuid(), exerciseId: z.string().max(20) }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId, exerciseId }) => {
      const w = await workouts.get(workoutId);
      const e = w?.type === 'strength' ? w.exercises.find((x) => x.uid === exerciseId) : undefined;
      const target = e && byId.get(e.exerciseRef);
      if (!target) return toolError('No such exercise in this workout.');
      const inWorkout = new Set(w!.exercises.map((x) => x.exerciseRef));
      const subs = substitutes(target, lib.exercises, { equipment: (await data.profile()).equipment, limit: 12 }).filter((x) => !inWorkout.has(x.ref)).slice(0, 8);
      return json({ substitutes: subs.map((x) => ({ id: x.ref, name: x.name, equipment: x.equipment === 'none' || x.equipment === 'body only' ? 'bodyweight' : x.equipment })) });
    },
  );

  registerAppTool(
    server,
    'swap_exercise',
    {
      title: 'Swap an exercise in a workout',
      description: 'Called by the workout player: replaces an exercise that has no logged sets with another (same sets, reps and rest; weight from its own history).',
      inputSchema: z.object({ workoutId: z.uuid(), exerciseId: z.string().max(20), newId: exerciseId }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId, exerciseId, newId }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength' || w.finishedAt !== null) return toolError('No such workout in progress.');
      const i = w.exercises.findIndex((x) => x.uid === exerciseId);
      const old = w.exercises[i];
      if (!old) return toolError('No such exercise in this workout.');
      if (!byId.has(newId)) return toolError(`Unknown exercise id ${newId}.`);
      if (old.sets.some((s) => s.done !== false || s.skipped)) return toolError('Sets of this exercise are already logged; it can no longer be swapped.');
      const past = await history([newId], w.id);
      // The plan's note stays with the slot (the person can edit it); last time and the progression come from the new exercise.
      const work = old.sets.filter((x) => x.type === 'working');
      const seconds = old.mode === 'time' ? (work[0]?.targetSec ?? work[0]?.durationSec) : undefined;
      const item: TemplateExercise = { id: newId, sets: work.length || old.sets.length, reps: seconds ? 0 : (work[0]?.targetReps ?? work[0]?.reps ?? 8), ...(seconds ? { seconds } : {}), restSec: old.restSec ?? 90, ...(old.notes ? { notes: old.notes } : {}) };
      // A swapped-in heavy lift keeps a ramp: the full one if the old exercise had it, else a short one.
      const hadFull = old.sets.filter((x) => x.type === 'warmup').length >= 3;
      const ramp = heavyLift(byId.get(newId)!) && !seconds ? (hadFull ? 'full' : 'short') : null;
      const profile = await data.profile();
      const next: StoredExercise = { ...buildExercise(item, i, past.get(newId)!, profile.weightKg, ramp, profile.gym), uid: old.uid, ...(old.supersetId ? { supersetId: old.supersetId } : {}) };
      const exercises = w.exercises.map((x, k) => (k === i ? next : x));
      await workouts.saveExercises(workoutId, exercises);
      return json({ swapped: { from: old.exerciseName, to: next.exerciseName }, workout: toPlan({ ...w, exercises }, profile.gym, await bestsFor({ ...w, exercises }), await planContext(w, profile.weightKg)) });
    },
  );

  registerAppTool(
    server,
    'finish_workout',
    {
      title: 'Finish a workout',
      description: 'Marks a workout finished and returns its summary: sets per exercise, volume, time, personal records (best estimated 1RM, Epley), sets per muscle, and what to rest and what is due next. The player calls it; call it yourself if the person says they are done in chat.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI } },
    },
    async ({ workoutId }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      const finishedAt = w.finishedAt ?? Date.now();
      if (!w.finishedAt) await workouts.saveExercises(workoutId, w.exercises, finishedAt, null);
      return json(await finishSummary({ ...w, finishedAt }));
    },
  );

  server.registerTool(
    'edit_workout_set',
    {
      title: 'Fix a logged set',
      description:
        'Correct one set of a stored strength workout, e.g. "the second squat set was 6 reps, not 5". Find the workout id with get_workout_history; its exercise lines list the sets in order ("5 @ 82.5, 5 @ 82.5"). ' +
        'exercise is a library id ("ex:Barbell_Squat") or part of the exercise name as it appears in the workout; set is the position among its working sets, 1 for the first (warmup: true counts warm-up sets instead). ' +
        'Give the reps, weight_kg (not for bodyweight exercises), seconds (timed sets) and/or effort (how hard it felt, 1 Easy to 4 Max; working sets) that should change. A set that was skipped or never logged becomes done with the values given. Works on finished workouts too; ask before changing history.',
      inputSchema: z.object({
        workout_id: z.uuid(),
        exercise: z.string().min(1).max(80),
        set: z.number().int().min(1).max(20),
        warmup: z.boolean().default(false),
        reps: z.number().int().min(0).max(100).optional(),
        weight_kg: z.number().min(0).max(500).optional(),
        seconds: z.number().int().min(0).max(3600).optional(),
        effort: effortSchema.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ workout_id, exercise, set, warmup, reps, weight_kg, seconds, effort }) => {
      if (reps === undefined && weight_kg === undefined && seconds === undefined && effort === undefined) return toolError('Give at least one of reps, weight_kg, seconds or effort to change.');
      if (effort !== undefined && warmup) return toolError('Effort is for working sets; leave out warmup.');
      const w = await workouts.get(workout_id);
      if (!w || w.type !== 'strength') return toolError('No such strength workout. Find the id with get_workout_history.');
      const wanted = exercise.trim().toLowerCase();
      const matches = w.exercises.filter((e) => e.exerciseRef === exercise || e.exerciseName.toLowerCase() === wanted);
      const found = matches.length ? matches : w.exercises.filter((e) => e.exerciseName.toLowerCase().includes(wanted));
      if (found.length === 0) return toolError(`No exercise like "${exercise}" in this workout. It has: ${w.exercises.map((e) => e.exerciseName).join(', ')}.`);
      if (found.length > 1) return toolError(`"${exercise}" matches ${found.map((e) => e.exerciseName).join(', ')}. Use the library id.`);
      const target = found[0]!;
      const sets = target.sets.filter((s) => (s.type === 'warmup') === warmup);
      const chosen = sets[set - 1];
      if (!chosen) return toolError(`${target.exerciseName} has ${sets.length} ${warmup ? 'warm-up' : 'working'} set${sets.length === 1 ? '' : 's'}; there is no set ${set}.`);
      if (weight_kg !== undefined && target.load === 'bodyweight') return toolError(`${target.exerciseName} is a bodyweight exercise; leave out weight_kg.`);
      const next: StoredSet = { ...chosen, done: true, ...(reps !== undefined ? { reps } : {}), ...(weight_kg !== undefined ? { weightKg: weight_kg } : {}), ...(seconds !== undefined ? { durationSec: seconds } : {}), ...(effort !== undefined ? { effort } : {}) };
      delete next.skipped;
      const exercises = w.exercises.map((e) => (e === target ? { ...e, sets: e.sets.map((s) => (s === chosen ? next : s)) } : e));
      await workouts.saveExercises(workout_id, exercises);
      return json({ fixed: { workoutId: workout_id, day: w.day, exercise: target.exerciseName, set: `${warmup ? 'warm-up ' : ''}${set}`, now: summarizeExercise(exercises[w.exercises.indexOf(target)]!) } });
    },
  );

  server.registerTool(
    'log_past_workout',
    {
      title: 'Log a workout done earlier',
      description:
        'Record a strength workout that is already done (no player), e.g. "I benched 3 sets of 8 at 60 kg yesterday". Give the day, and for each exercise (ids from search_exercises) the sets actually done: ' +
        'reps and weight in kg (omit weight for bodyweight), and an optional note per exercise. cardio adds a warm-up or finisher that was part of the session. All sets count as done. Returns the same summary as finishing a workout, with personal records measured against sessions up to that day.',
      inputSchema: z.object({
        day,
        name: z.string().min(1).max(60).optional(),
        minutes: z.number().int().min(1).max(600).optional().describe('How long it took, if known'),
        exercises: z
          .array(z.object({ id: exerciseId, sets: z.array(z.object({ reps: z.number().int().min(1).max(100), weight_kg: z.number().min(0).max(500).optional() })).min(1).max(15), notes: z.string().max(300).optional() }))
          .min(1)
          .max(15),
        cardio: z.array(cardioItem).max(4).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ day: d, name, minutes, exercises: given, cardio: givenCardio }) => {
      const badActivity = unknownActivity(givenCardio);
      if (badActivity) return toolError(badActivity);
      const unknown = given.filter((e) => !byId.has(e.id)).map((e) => e.id);
      if (unknown.length) return toolError(`Unknown exercise ids: ${unknown.join(', ')}. Use search_exercises to find valid ids.`);
      const profile = await data.profile();
      const exercises: StoredExercise[] = given.map((g, i) => {
        const ex = byId.get(g.id)!;
        const bodyweight = isBodyweight(ex);
        return {
          uid: `e${i + 1}`,
          exerciseRef: g.id,
          exerciseName: ex.name,
          equipment: ex.equipment,
          load: bodyweight ? 'bodyweight' : 'weight',
          sets: g.sets.map((s, k) => ({
            id: `s${i + 1}.${k + 1}`,
            type: 'working',
            reps: s.reps,
            targetReps: s.reps,
            weightKg: bodyweight ? (profile.weightKg ?? 0) : (s.weight_kg ?? 0),
            ...(bodyweight && profile.weightKg ? { bodyweightKg: profile.weightKg } : {}),
            done: true,
          })),
          ...(g.notes ? { notes: g.notes } : {}),
        };
      });
      const finishedAt = Date.now();
      const cardioBlocks = blocksFrom((givenCardio ?? []).map(templateCardioOf), true, profile.weightKg);
      const w = await workouts.create({ day: d, type: 'strength', name: name ?? 'Workout', startedAt: minutes ? finishedAt - minutes * 60_000 : null, finishedAt, exercises, cardio: null, session: null, cardioBlocks, templateId: null });
      return json(await finishSummary(w));
    },
  );

  server.registerTool(
    'get_workout_history',
    {
      title: 'Workout history',
      description: 'Past workouts (strength, whole-body sessions such as Pilates or HIIT, and cardio) over a period, newest first, or the sessions of one exercise with its best set and estimated 1RM.',
      inputSchema: z.object({ days: z.number().int().min(1).max(365).default(30), to: day.optional(), exercise_id: exerciseId.optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ days, to, exercise_id }) => {
      const end = to ?? todayIn((await data.profile()).timeZone);
      const list = await workouts.between(addDays(end, -(days - 1)), end);
      if (!exercise_id) return json({ from: addDays(end, -(days - 1)), to: end, workouts: list.map(summarizeWorkout) });
      const sessions = list.flatMap((w) =>
        w.exercises
          .filter((e) => e.exerciseRef === exercise_id)
          .map((e) => {
            const working = e.sets.filter((s) => s.done !== false && s.type === 'working' && s.reps > 0);
            const top = working.reduce<StoredSet | null>((b, s) => ((estimatedOneRepMax(s.weightKg, s.reps) ?? 0) > (b ? (estimatedOneRepMax(b.weightKg, b.reps) ?? 0) : -1) ? s : b), null);
            return { day: w.day, done: summarizeExercise(e), ...(effortText(e) ? { effort: effortText(e) } : {}), ...(top && e.load !== 'bodyweight' ? { bestSet: `${top.reps} @ ${top.weightKg} kg`, estimated1rmKg: r1(estimatedOneRepMax(top.weightKg, top.reps) ?? 0) } : {}) };
          }),
      );
      return json({ exercise: byId.get(exercise_id)?.name ?? exercise_id, sessions });
    },
  );

  server.registerTool(
    'suggest_progression',
    {
      title: 'Suggest next weights',
      description: 'For each exercise (or every exercise of a template): what was done last time and what to do next, from a fixed rule (add 2.5 kg, 2 kg for dumbbells, when every set hit its reps; repeat after a miss; deload ~10 % after two misses; bodyweight: one more rep). The effort logged in the player adjusts a hit: every set Easy adds two steps, any set Max holds, Solid or Hard adds one; no effort keeps the plain rule. The reason says which applied.',
      inputSchema: z.object({ exercise_ids: z.array(exerciseId).min(1).max(15).optional(), template_id: z.uuid().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ exercise_ids, template_id }) => {
      const ids = template_id ? (await workouts.template(template_id))?.exercises.map((e) => e.id) : exercise_ids;
      if (!ids?.length) return toolError('Give exercise_ids or a valid template_id.');
      const h = await history(ids);
      return json({
        exercises: ids.map((id) => {
          const x = h.get(id)!;
          return { id, name: byId.get(id)?.name ?? id, ...(x.lastTime ? { lastTime: x.lastTime, lastDay: x.lastDay } : { lastTime: null }), next: x.progression };
        }),
      });
    },
  );

  server.registerTool(
    'save_workout_template',
    {
      title: 'Save a workout template',
      description: 'Save a named workout plan ("Push day") to start later with start_workout, with a note per exercise and optional cardio blocks (warm-up or finisher). Saving under an existing name replaces it. Leave weights out to use progression each time.',
      inputSchema: z.object({ name: z.string().min(1).max(60), exercises: z.array(planItem).min(1).max(15), cardio: z.array(cardioItem).max(4).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ name, exercises, cardio }) => {
      const badActivity = unknownActivity(cardio) ?? missingReps(exercises);
      if (badActivity) return toolError(badActivity);
      const unknown = exercises.filter((e) => !byId.has(e.id)).map((e) => e.id);
      if (unknown.length) return toolError(`Unknown exercise ids: ${unknown.join(', ')}.`);
      const t = await workouts.saveTemplate(name, exercises.map(templateItemOf), (cardio ?? []).map(templateCardioOf));
      return json({ template: { id: t.id, name: t.name, exercises: t.exercises.map((e) => ({ ...e, name: byId.get(e.id)?.name })), ...(t.cardio.length ? { cardio: t.cardio } : {}) } });
    },
  );

  server.registerTool(
    'list_workout_templates',
    { title: 'Workout templates', description: 'Saved workout templates, most recently used first.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => json({ templates: (await workouts.templates()).map((t) => ({ id: t.id, name: t.name, exercises: t.exercises.map((e) => `${byId.get(e.id)?.name ?? e.id} ${e.sets}×${e.reps}${e.weightKg !== undefined ? ` @ ${e.weightKg} kg` : ''}${e.notes ? ` (${e.notes})` : ''}`), ...(t.cardio.length ? { cardio: t.cardio.map((c) => `${c.minutes} min ${ACTIVITIES.find((a) => a.id === c.activityId)?.name ?? c.activityId} (${c.when === 'before' ? 'warm-up' : 'finisher'})`) } : {}) })) }),
  );

  const activityIds = ACTIVITIES.map((a) => a.id) as [string, ...string[]];
  server.registerTool(
    'log_cardio',
    {
      title: 'Log cardio',
      description:
        'Record a cardio session or activity (runs, rides, swims, walks, sports). Pilates, yoga, HIIT, CrossFit, Hyrox and functional classes are not cardio: use log_session for those. activity_id is one of the listed Compendium activities (MET values); calories are estimated as MET × body weight × hours ' +
        "from the profile weight, unless the person gives a number (e.g. from a watch) as kcal. day defaults to today. " +
        `activity_id is a descriptive id from the Compendium list, e.g. ${[...new Map(ACTIVITIES.map((a) => [a.group, a])).values()].slice(0, 6).map((a) => `${a.id} (${a.name})`).join(', ')}; pick the closest one.`,
      inputSchema: z.object({
        activity_id: z.enum(activityIds),
        duration_min: z.number().min(1).max(1440),
        distance_km: z.number().min(0).max(1000).optional(),
        kcal: z.number().min(0).max(10000).optional().describe('Only if the person has a measured number'),
        day: day.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ activity_id, duration_min, distance_km, kcal, day: d }) => {
      const a = ACTIVITIES.find((x) => x.id === activity_id)!;
      if (a.category) return toolError(`${a.name} is a whole-body session, not cardio. Log it with log_session (category ${a.category}, activity_id ${a.id}).`);
      const profile = await data.profile();
      const estimated = estimateKcal(a.met, profile.weightKg ?? undefined, duration_min);
      const w = await workouts.create({
        day: d ?? todayIn(profile.timeZone),
        type: 'cardio',
        name: a.name,
        startedAt: null,
        finishedAt: Date.now(),
        exercises: [],
        cardio: {
          activityRef: a.id,
          activityName: a.name,
          met: a.met,
          durationMin: duration_min,
          ...(distance_km !== undefined ? { distanceKm: distance_km } : {}),
          ...(estimated !== undefined ? { kcalEstimated: estimated, weightKgUsed: profile.weightKg! } : {}),
          ...(kcal !== undefined ? { kcalOverride: kcal } : {}),
        },
        session: null,
        cardioBlocks: [],
        templateId: null,
      });
      return json({
        logged: summarizeWorkout(w),
        ...(distance_km ? { pace: `${formatDuration(Math.round((duration_min * 60) / distance_km))} per km` } : {}),
        ...(kcal === undefined && estimated === undefined ? { note: 'No body weight in the profile, so no calorie estimate. Save it with update_profile.' } : {}),
      });
    },
  );

  const sessionActivities = ACTIVITIES.filter((x) => x.category);
  server.registerTool(
    'log_session',
    {
      title: 'Log a whole-body session',
      description:
        'Record a class or mixed session that trains the whole body: Pilates, yoga, HIIT, CrossFit, Hyrox, functional training or boot camp. It is its own kind of workout in the history and review, ' +
        'and it credits the muscle map (core and glutes for Pilates, legs, shoulders and core for Hyrox and CrossFit, and so on) in proportion to its length. ' +
        'category is the closest of the list; activity_id picks the intensity (its MET value) and defaults to a typical one for the category ' +
        `(${sessionActivities.map((x) => `${x.id} ${x.name}`).join('; ')}). Calories are MET × body weight × hours from the profile unless the person gives a measured number (kcal). ` +
        'notes can hold what was done ("Fran, then a 5 km row"). Use start_workout for a session built from library exercises with sets and weights, and log_cardio for runs and rides. day defaults to today.',
      inputSchema: z.object({
        category: z.enum(SESSION_CATEGORIES),
        duration_min: z.number().min(1).max(600),
        name: z.string().min(1).max(80).optional().describe('e.g. "Reformer Pilates"; defaults to the category'),
        activity_id: z.string().regex(/^act:/).optional().describe('Must belong to the same category'),
        notes: z.string().max(500).optional(),
        kcal: z.number().min(0).max(10000).optional().describe('Only if the person has a measured number'),
        day: day.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ category, duration_min, name, activity_id, notes, kcal, day: d }) => {
      const profileDef = SESSION_PROFILES[category];
      const a = ACTIVITIES.find((x) => x.id === (activity_id ?? profileDef.defaultActivity));
      if (!a || a.category !== category) return toolError(`activity_id must be one of the ${profileDef.label} activities: ${sessionActivities.filter((x) => x.category === category).map((x) => x.id).join(', ')}.`);
      const profile = await data.profile();
      const estimated = estimateKcal(a.met, profile.weightKg ?? undefined, duration_min);
      const w = await workouts.create({
        day: d ?? todayIn(profile.timeZone),
        type: 'session',
        name: name ?? a.name,
        startedAt: null,
        finishedAt: Date.now(),
        exercises: [],
        cardio: null,
        session: {
          category,
          activityRef: a.id,
          activityName: a.name,
          met: a.met,
          durationMin: duration_min,
          ...(estimated !== undefined ? { kcalEstimated: estimated, weightKgUsed: profile.weightKg! } : {}),
          ...(kcal !== undefined ? { kcalOverride: kcal } : {}),
          ...(notes ? { notes } : {}),
        },
        cardioBlocks: [],
        templateId: null,
      });
      return json({
        logged: summarizeWorkout(w),
        ...(kcal === undefined && estimated === undefined ? { note: 'No body weight in the profile, so no calorie estimate. Save it with update_profile.' } : {}),
      });
    },
  );
}
