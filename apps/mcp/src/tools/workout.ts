import { ACTIVITIES } from '@fitwell/core/data/activities';
import { loadExercises, substitutes, type Exercise } from '@fitwell/core/data/exercises';
import { addDays, isDay } from '@fitwell/core/domain/dates';
import { estimateKcal } from '@fitwell/core/domain/met';
import { suggestProgression, type Progression, type SessionSets } from '@fitwell/core/domain/progression';
import { estimatedOneRepMax, formatDuration, summarizeSets } from '@fitwell/core/domain/workouts';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import type { CardioBlock, StoredExercise, StoredSet, TemplateCardio, TemplateExercise, Workout, WorkoutData } from '../data/workoutData';
import workoutHtml from '../ui/generated/workout';
import { WORKOUT_VIEW_URI, type PlannedCardio, type PlannedExercise, type WorkoutPlan } from '../workout/plan';
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
  reps: z.number().int().min(1).max(50),
  weight_kg: z.number().min(0).max(500).optional().describe('Omit to use the suggestion from past sessions (or last time\'s weight)'),
  rest_sec: z.number().int().min(0).max(600).default(90),
  notes: z.string().max(300).optional().describe('A note for this exercise, shown in the player ("seat 4", "slow negatives")'),
});
const cardioItem = z.object({
  activity_id: z.string().regex(/^act:/, 'Activity ids start with "act:"').describe('The same activity ids log_cardio takes, e.g. act:run-10'),
  minutes: z.number().int().min(1).max(240),
  when: z.enum(['before', 'after']).default('after').describe('before = warm-up ahead of the lifting, after = finisher'),
  distance_km: z.number().min(0).max(500).optional(),
});

const r1 = (n: number) => Math.round(n * 10) / 10;
const isBodyweight = (ex: Exercise) => ex.equipment === 'body only';
const sessionOf = (d: string, e: StoredExercise): SessionSets => ({ day: d, sets: e.sets });

/** "3×5 @ 80 kg", "8, 8, 6 @ BW", or one line for a cardio session. */
function summarizeExercise(e: StoredExercise): string {
  return summarizeSets(e.sets, 'metric', { load: e.load });
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
  const minutes = w.startedAt && w.finishedAt ? Math.round((w.finishedAt - w.startedAt) / 60000) : undefined;
  return {
    id: w.id,
    day: w.day,
    type: 'strength' as const,
    name: w.name,
    finished: w.finishedAt !== null,
    ...(minutes !== undefined ? { minutes } : {}),
    exercises: w.exercises.map((e) => ({ id: e.exerciseRef, name: e.exerciseName, done: summarizeExercise(e) || 'nothing logged', ...(e.notes ? { notes: e.notes } : {}) })),
    ...(w.cardioBlocks.some((b) => b.done) ? { cardio: w.cardioBlocks.filter((b) => b.done).map(cardioLine) } : {}),
  };
}

/** The player's view of a stored workout (also used to resume one). */
function toPlan(w: Workout): WorkoutPlan {
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
        sets: e.sets.map((s) => ({
          id: s.id,
          targetReps: s.targetReps ?? s.reps,
          ...(e.load === 'bodyweight' ? {} : { weightKg: s.weightKg }),
          done: s.done !== false,
          ...(s.done !== false ? { reps: s.reps } : {}),
          ...(s.skipped ? { skipped: true } : {}),
        })),
        ...(e.lastTime ? { lastTime: e.lastTime } : {}),
        ...(e.note ? { note: e.note } : {}),
        ...(e.notes ? { notes: e.notes } : {}),
        ...(e.lastNotes ? { lastNotes: e.lastNotes } : {}),
      }),
    ),
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
      }),
    ),
  };
}

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
  function buildExercise(item: TemplateExercise, i: number, h: History, bodyKg: number | null): StoredExercise {
    const ex = byId.get(item.id)!;
    const bodyweight = isBodyweight(ex);
    const p = h.progression;
    // An explicit weight wins; otherwise the progression suggestion; otherwise last time's working weight.
    const weightKg = bodyweight ? (bodyKg ?? 0) : (item.weightKg ?? p?.weightKg ?? 0);
    const note = item.weightKg !== undefined || bodyweight ? undefined : (p?.reason ?? 'No earlier sessions to go on: choose a starting weight.');
    const sets: StoredSet[] = Array.from({ length: item.sets }, (_, k) => ({
      id: `s${i + 1}.${k + 1}`,
      type: 'working',
      reps: item.reps,
      targetReps: item.reps,
      weightKg,
      ...(bodyweight && bodyKg ? { bodyweightKg: bodyKg } : {}),
      done: false,
    }));
    return {
      uid: `e${i + 1}`,
      exerciseRef: item.id,
      exerciseName: ex.name,
      equipment: ex.equipment,
      load: bodyweight ? 'bodyweight' : 'weight',
      restSec: item.restSec,
      sets,
      ...(h.lastTime ? { lastTime: `${h.lastTime} (${h.lastDay})` } : {}),
      ...(note ? { note } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
      ...(h.lastNotes ? { lastNotes: h.lastNotes } : {}),
    };
  }

  /** Time, volume and personal records of a strength workout. Records compare with sessions up to that workout's day. */
  async function finishSummary(w: Workout) {
    const prior = await workouts.recentSessions(w.exercises.map((e) => e.exerciseRef), 20, w.id);
    const best = (sets: StoredSet[]) => Math.max(0, ...sets.filter((s) => s.done !== false && s.type === 'working').map((s) => estimatedOneRepMax(s.weightKg, s.reps) ?? 0));
    let volumeKg = 0;
    const exercises = w.exercises.map((e) => {
      const done = e.sets.filter((s) => s.done !== false && s.type === 'working');
      if (e.load !== 'bodyweight') volumeKg += done.reduce((n, s) => n + s.weightKg * s.reps, 0);
      const now = best(e.sets);
      const before = Math.max(0, ...(prior.get(e.exerciseRef) ?? []).filter((p) => p.day <= w.day).map((p) => best(p.exercise.sets)));
      return {
        name: e.exerciseName,
        done: summarizeExercise(e) || 'skipped',
        ...(e.notes ? { notes: e.notes } : {}),
        ...(e.load !== 'bodyweight' && now > 0 ? { estimated1rmKg: r1(now) } : {}),
        ...(e.load !== 'bodyweight' && now > 0 && before > 0 && now > before + 0.01 ? { personalRecord: `New best estimated 1RM: ${r1(now)} kg (was ${r1(before)} kg)` } : {}),
      };
    });
    const minutes = Math.round(((w.finishedAt ?? Date.now()) - (w.startedAt ?? w.createdAt)) / 60000);
    const cardio = w.cardioBlocks.filter((b) => b.done).map(cardioLine);
    return { workoutId: w.id, name: w.name, day: w.day, minutes, volumeKg: Math.round(volumeKg), exercises, ...(cardio.length ? { cardio } : {}) };
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
        'cardio adds cardio blocks to the workout: when "before" is a warm-up ahead of the lifting, "after" a finisher; the player runs them as steps and they count toward cardio minutes. ' +
        'Each exercise can carry a note, and the note from the last session shows as a reminder. save_as_template stores the plan (with cardio and notes) under a name for next time.',
      inputSchema: z.object({
        name: z.string().min(1).max(60).optional(),
        template_id: z.uuid().optional(),
        exercises: z.array(planItem).min(1).max(15).optional(),
        cardio: z.array(cardioItem).max(4).optional().describe('With a template: replaces the template\'s cardio'),
        save_as_template: z.string().min(1).max(60).optional(),
      }),
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
        items = args.exercises.map((e) => ({ id: e.id, sets: e.sets, reps: e.reps, ...(e.weight_kg !== undefined ? { weightKg: e.weight_kg } : {}), restSec: e.rest_sec, ...(e.notes ? { notes: e.notes } : {}) }));
      } else {
        return toolError('Give template_id or exercises.');
      }
      const unknown = items.filter((e) => !byId.has(e.id)).map((e) => e.id);
      if (unknown.length) return toolError(`Unknown exercise ids: ${unknown.join(', ')}. Use search_exercises to find valid ids.`);
      const badActivity = unknownActivity(args.cardio);
      if (badActivity) return toolError(badActivity);
      if (args.cardio) cardioSpecs = args.cardio.map(templateCardioOf);
      if (args.save_as_template) templateId = (await workouts.saveTemplate(args.save_as_template, items, cardioSpecs)).id;

      const past = await history(items.map((e) => e.id));
      const profile = await data.profile();
      const exercises = items.map((item, i) => buildExercise(item, i, past.get(item.id)!, profile.weightKg));
      const cardioBlocks = blocksFrom(cardioSpecs);
      const w = await workouts.create({ day: todayIn(profile.timeZone), type: 'strength', name: name ?? 'Workout', startedAt: Date.now(), finishedAt: null, exercises, cardio: null, cardioBlocks, templateId });
      const lines = exercises.map((e) => `${e.exerciseName} ${e.sets.length}×${e.sets[0]!.targetReps}${e.load === 'bodyweight' ? '' : ` @ ${e.sets[0]!.weightKg} kg`}${e.lastTime ? ` (last time ${e.lastTime})` : ''}`);
      const result = json({ workout: toPlan(w), ...(args.save_as_template ? { savedTemplate: args.save_as_template } : {}) });
      const cardioText = cardioBlocks.length ? ` Cardio: ${cardioBlocks.map((b) => `${b.plannedMin} min ${b.activityName} (${b.when === 'before' ? 'warm-up' : 'finisher'})`).join('; ')}.` : '';
      result.content = [{ type: 'text', text: `Workout "${w.name}" is open in the player (id ${w.id}): ${lines.join('; ')}.${cardioText}` }];
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
      return w && w.type === 'strength' ? json({ workout: toPlan(w) }) : toolError('No such workout.');
    },
  );

  registerAppTool(
    server,
    'log_set',
    {
      title: 'Log a set',
      description: 'Called by the workout player when a set is done or skipped. Saves it to the workout.',
      inputSchema: z.object({
        workoutId: z.uuid(),
        setId: z.string().max(20),
        reps: z.number().int().min(0).max(100),
        weightKg: z.number().min(0).max(500).optional(),
        skip: z.boolean().default(false),
      }),
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ workoutId, setId, reps, weightKg, skip }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      let found = false;
      const exercises = w.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => {
          if (s.id !== setId) return s;
          found = true;
          if (skip) return { ...s, done: false, skipped: true };
          const bodyweight = e.load === 'bodyweight';
          const next: StoredSet = { ...s, reps, weightKg: bodyweight ? s.weightKg : (weightKg ?? s.weightKg), done: true };
          delete next.skipped;
          return next;
        }),
      }));
      if (!found) return toolError('No such set in this workout.');
      await workouts.saveExercises(workoutId, exercises);
      return json({ saved: true, setId });
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
      const item: TemplateExercise = { id: newId, sets: old.sets.length, reps: old.sets[0]?.targetReps ?? old.sets[0]?.reps ?? 8, restSec: old.restSec ?? 90, ...(old.notes ? { notes: old.notes } : {}) };
      const next = { ...buildExercise(item, i, past.get(newId)!, (await data.profile()).weightKg), uid: old.uid };
      const exercises = w.exercises.map((x, k) => (k === i ? next : x));
      await workouts.saveExercises(workoutId, exercises);
      return json({ swapped: { from: old.exerciseName, to: next.exerciseName }, workout: toPlan({ ...w, exercises }) });
    },
  );

  registerAppTool(
    server,
    'finish_workout',
    {
      title: 'Finish a workout',
      description: 'Marks a workout finished and returns its summary: sets per exercise, volume, time, and personal records (best estimated 1RM, Epley). The player calls it; call it yourself if the person says they are done in chat.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI } },
    },
    async ({ workoutId }) => {
      const w = await workouts.get(workoutId);
      if (!w || w.type !== 'strength') return toolError('No such workout.');
      const finishedAt = w.finishedAt ?? Date.now();
      if (!w.finishedAt) await workouts.saveExercises(workoutId, w.exercises, finishedAt);
      return json(await finishSummary({ ...w, finishedAt }));
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
      const w = await workouts.create({ day: d, type: 'strength', name: name ?? 'Workout', startedAt: minutes ? finishedAt - minutes * 60_000 : null, finishedAt, exercises, cardio: null, cardioBlocks, templateId: null });
      return json(await finishSummary(w));
    },
  );

  server.registerTool(
    'get_workout_history',
    {
      title: 'Workout history',
      description: 'Past workouts (strength and cardio) over a period, newest first, or the sessions of one exercise with its best set and estimated 1RM.',
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
            return { day: w.day, done: summarizeExercise(e), ...(top && e.load !== 'bodyweight' ? { bestSet: `${top.reps} @ ${top.weightKg} kg`, estimated1rmKg: r1(estimatedOneRepMax(top.weightKg, top.reps) ?? 0) } : {}) };
          }),
      );
      return json({ exercise: byId.get(exercise_id)?.name ?? exercise_id, sessions });
    },
  );

  server.registerTool(
    'suggest_progression',
    {
      title: 'Suggest next weights',
      description: 'For each exercise (or every exercise of a template): what was done last time and what to do next, from a fixed rule (add 2.5 kg, 2 kg for dumbbells, when every set hit its reps; repeat after a miss; deload ~10 % after two misses; bodyweight: one more rep).',
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
    },
    async ({ name, exercises, cardio }) => {
      const badActivity = unknownActivity(cardio);
      if (badActivity) return toolError(badActivity);
      const unknown = exercises.filter((e) => !byId.has(e.id)).map((e) => e.id);
      if (unknown.length) return toolError(`Unknown exercise ids: ${unknown.join(', ')}.`);
      const t = await workouts.saveTemplate(name, exercises.map((e) => ({ id: e.id, sets: e.sets, reps: e.reps, ...(e.weight_kg !== undefined ? { weightKg: e.weight_kg } : {}), restSec: e.rest_sec, ...(e.notes ? { notes: e.notes } : {}) })), (cardio ?? []).map(templateCardioOf));
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
        'Record a cardio session or activity. activity_id is one of the listed Compendium activities (MET values); calories are estimated as MET × body weight × hours ' +
        "from the profile weight, unless the person gives a number (e.g. from a watch) as kcal. day defaults to today. " +
        `activity_id is a descriptive id from the Compendium list, e.g. ${[...new Map(ACTIVITIES.map((a) => [a.group, a])).values()].slice(0, 6).map((a) => `${a.id} (${a.name})`).join(', ')}; pick the closest one.`,
      inputSchema: z.object({
        activity_id: z.enum(activityIds),
        duration_min: z.number().min(1).max(1440),
        distance_km: z.number().min(0).max(1000).optional(),
        kcal: z.number().min(0).max(10000).optional().describe('Only if the person has a measured number'),
        day: day.optional(),
      }),
    },
    async ({ activity_id, duration_min, distance_km, kcal, day: d }) => {
      const a = ACTIVITIES.find((x) => x.id === activity_id)!;
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
}
