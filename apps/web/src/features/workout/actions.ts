import { workoutsRepo, templatesRepo } from '../../db/workoutStore';
import type { CardioDetails, Workout, WorkoutExercise, WorkoutTemplate } from '@fitwell/core/schema';
import { copyExercises, normalizeSupersets } from '@fitwell/core/domain/workouts';
import { estimateKcal } from '@fitwell/core/domain/met';
import { currentWeightKg } from '../../state';
import { t } from '../../i18n';
import { showToast } from '../food/toast';

const id = () => crypto.randomUUID();

export function createStrength(day: string, exercises: WorkoutExercise[] = [], name?: string): Promise<Workout> {
  return workoutsRepo.create({ day, type: 'strength', name, exercises });
}

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
export function repeatWorkout(day: string, source: Workout): Promise<Workout> {
  if (source.type === 'cardio' && source.cardio) return createCardio(day, { ...source.cardio, kcalOverride: undefined });
  return createStrength(day, copyExercises(source.exercises ?? [], id), source.name);
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

export function startFromTemplate(day: string, tpl: WorkoutTemplate): Promise<Workout> {
  if (tpl.type === 'cardio' && tpl.cardio) return createCardio(day, tpl.cardio);
  return createStrength(
    day,
    normalizeSupersets(
      (tpl.exercises ?? []).map((e) => ({ ...e, uid: id(), sets: e.sets.map((s) => ({ ...s, id: id() })) })),
      id,
    ),
    tpl.name,
  );
}

export async function deleteTemplate(tpl: WorkoutTemplate): Promise<void> {
  await templatesRepo.remove(tpl.id);
  showToast(t('workout.templateRemoved'), { label: t('food.undo'), run: () => void templatesRepo.restore(tpl.id) });
}

export const newId = id;
