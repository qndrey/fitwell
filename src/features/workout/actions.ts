import { workoutsRepo, templatesRepo } from '../../db/workoutStore';
import type { CardioDetails, Workout, WorkoutExercise, WorkoutTemplate } from '../../db/schema';
import { today } from '../../domain/dates';
import { copyExercises, exercisesAtFinish, normalizeSupersets, reopenPatch } from '../../domain/workouts';
import { estimateKcal } from '../../domain/met';
import { currentWeightKg } from '../../state';
import { t } from '../../i18n';
import { showToast } from '../food/toast';

const id = () => crypto.randomUUID();

/**
 * A new strength workout. `start` begins its timer now. Only today's workouts are timed: one logged for another
 * day has no real start, so it stays untimed rather than inventing a duration.
 */
export function createStrength(day: string, exercises: WorkoutExercise[] = [], name?: string, start = false): Promise<Workout> {
  return workoutsRepo.create({ day, type: 'strength', name, exercises, ...(start && day === today() ? { startedAt: Date.now() } : {}) });
}

/** Starts the timer of a workout that was planned (an imported plan, an untimed one). */
export const startWorkout = (w: Workout): Promise<Workout> => workoutsRepo.update(w.id, { startedAt: Date.now() });

/** Closes the workout: sets that were never done are dropped, the time is stored, and no more exercises or sets can be added. */
export const finishWorkout = (w: Workout, exercises: WorkoutExercise[]): Promise<Workout> =>
  workoutsRepo.update(w.id, { exercises: exercisesAtFinish(exercises, id), finishedAt: Date.now() });

/** Opens a finished workout again (to fix something); its clock carries on from the time it had. */
export const reopenWorkout = (w: Workout): Promise<Workout> => workoutsRepo.update(w.id, reopenPatch(w, Date.now()));

export interface CardioInput {
  activityRef: string;
  activityName: string;
  met: number;
  durationMin: number;
  distanceKm?: number;
  kcalOverride?: number;
}

/** Builds the stored details, estimating energy from the current body weight (skipped when there is none). */
export function cardioDetails(input: CardioInput): CardioDetails {
  const weight = currentWeightKg();
  const kcalEstimated = estimateKcal(input.met, weight, input.durationMin);
  return { ...input, kcalEstimated, weightKgUsed: kcalEstimated === undefined ? undefined : weight };
}

export const createCardio = (day: string, input: CardioInput): Promise<Workout> => workoutsRepo.create({ day, type: 'cardio', cardio: cardioDetails(input) });
export const updateCardio = (w: Workout, input: CardioInput): Promise<Workout> => workoutsRepo.update(w.id, { cardio: cardioDetails(input) });

export async function deleteWorkout(w: Workout): Promise<void> {
  await workoutsRepo.remove(w.id);
  showToast(t('workout.removed'), { label: t('food.undo'), run: () => void workoutsRepo.restore(w.id) });
}

/** A new workout on `day` with the same content. Strength sets get new ids, weights and reps are kept as a starting point. */
export function repeatWorkout(day: string, source: Workout, start = false): Promise<Workout> {
  if (source.type === 'cardio' && source.cardio) return createCardio(day, { ...source.cardio, kcalOverride: undefined });
  return createStrength(day, copyExercises(source.exercises ?? [], id), source.name, start);
}

export function saveAsTemplate(w: Workout, name: string): Promise<WorkoutTemplate> {
  if (w.type === 'cardio' && w.cardio) {
    const { activityRef, activityName, met, durationMin, distanceKm } = w.cardio;
    return templatesRepo.create({ name: name.trim(), type: 'cardio', cardio: { activityRef, activityName, met, durationMin, distanceKm } });
  }
  return templatesRepo.create({
    name: name.trim(),
    type: 'strength',
    exercises: (w.exercises ?? []).map((e) => ({
      exerciseRef: e.exerciseRef,
      exerciseName: e.exerciseName,
      ...(e.supersetId ? { supersetId: e.supersetId } : {}),
      ...(e.mode ? { mode: e.mode } : {}),
      ...(e.load ? { load: e.load } : {}),
      sets: e.sets.map((s) => ({ type: s.type, reps: s.reps, weightKg: s.weightKg, ...(s.durationSec ? { durationSec: s.durationSec } : {}), ...(s.bodyweightKg !== undefined ? { bodyweightKg: s.bodyweightKg } : {}) })),
    })),
  });
}

export function startFromTemplate(day: string, tpl: WorkoutTemplate, start = false): Promise<Workout> {
  if (tpl.type === 'cardio' && tpl.cardio) return createCardio(day, tpl.cardio);
  return createStrength(
    day,
    normalizeSupersets(
      (tpl.exercises ?? []).map((e) => ({ ...e, uid: id(), sets: e.sets.map((s) => ({ ...s, id: id(), done: false })) })),
      id,
    ),
    tpl.name,
    start,
  );
}

export async function deleteTemplate(tpl: WorkoutTemplate): Promise<void> {
  await templatesRepo.remove(tpl.id);
  showToast(t('workout.templateRemoved'), { label: t('food.undo'), run: () => void templatesRepo.restore(tpl.id) });
}

export const newId = id;
