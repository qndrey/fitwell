// The backup file format of the retired Fitwell web app (schema version 1), kept so the importer stays tested
// against the real format. Frozen: the web app no longer exists, so this only changes if the importer's input does.
import { isDay } from '@fitwell/core/domain/dates';
import * as z from 'zod';

const num = z.number();
const nonNeg = num.min(0);
const day = z.string().refine(isDay, 'not a valid day');

const base = {
  id: z.string().min(1),
  createdAt: num,
  updatedAt: num,
  deletedAt: num.optional(),
  rev: z.int().min(1),
};

const nutrients = z.object({ kcal: nonNeg, protein: nonNeg, carbs: nonNeg, fat: nonNeg });
const portion = z.object({ label: z.string(), grams: nonNeg });
const quantity = z.object({ amount: nonNeg, unit: z.enum(['g', 'portion']), portionLabel: z.string().optional() });
const foodRef = z.object({ kind: z.enum(['bundled', 'off', 'custom']), id: z.string() });
const foodItem = z.object({
  ref: foodRef,
  name: z.string(),
  brand: z.string().optional(),
  group: z.string().optional(),
  per100g: nutrients,
  portions: z.array(portion),
});
const candidate = z.object({
  source: z.literal('off'),
  sourceId: z.string(),
  name: z.string(),
  brand: z.string().optional(),
  per100g: nutrients,
  portions: z.array(portion),
});
const lookup = z.object({
  queryVersion: z.int().min(0),
  attempts: z.int().min(0),
  nextAttemptAt: num.optional(),
  lastError: z.string().optional(),
  candidates: z.array(candidate).optional(),
  suggestedIndex: z.int().min(0).optional(),
  completedAt: num.optional(),
});
const setType = z.enum(['warmup', 'working']);
const workoutSet = z.object({ id: z.string(), type: setType, reps: nonNeg, weightKg: nonNeg, durationSec: nonNeg.optional(), bodyweightKg: nonNeg.optional(), done: z.boolean().optional() });
const exerciseMode = z.enum(['reps', 'time']).optional();
const exerciseLoad = z.enum(['weight', 'bodyweight']).optional();
const cardio = z.object({
  activityRef: z.string(),
  activityName: z.string(),
  met: nonNeg,
  durationMin: nonNeg,
  distanceKm: nonNeg.optional(),
  kcalEstimated: nonNeg.optional(),
  kcalOverride: nonNeg.optional(),
  weightKgUsed: nonNeg.optional(),
});
const workout = z.object({
  ...base,
  day,
  type: z.enum(['cardio', 'strength']),
  name: z.string().optional(),
  cardio: cardio.optional(),
  startedAt: num.optional(),
  finishedAt: num.optional(),
  exercises: z
    .array(z.object({ uid: z.string().optional(), supersetId: z.string().optional(), mode: exerciseMode, load: exerciseLoad, exerciseRef: z.string(), exerciseName: z.string(), sets: z.array(workoutSet) }))
    .optional(),
});
const template = z.object({
  ...base,
  name: z.string(),
  type: z.enum(['cardio', 'strength']),
  cardio: z.object({ activityRef: z.string(), activityName: z.string(), met: nonNeg, durationMin: nonNeg, distanceKm: nonNeg.optional() }).optional(),
  exercises: z
    .array(
      z.object({
        exerciseRef: z.string(),
        exerciseName: z.string(),
        supersetId: z.string().optional(),
        mode: exerciseMode,
        load: exerciseLoad,
        sets: z.array(z.object({ type: setType, reps: nonNeg, weightKg: nonNeg, durationSec: nonNeg.optional(), bodyweightKg: nonNeg.optional() })),
      }),
    )
    .optional(),
});
const customExercise = z.object({ ...base, name: z.string(), primary: z.array(z.string()), equipment: z.string().optional() });
const customActivity = z.object({ ...base, name: z.string(), met: nonNeg });
const weightEntry = z.object({ ...base, day, kg: num.min(1).max(700) });
const measurementType = z.object({
  ...base,
  key: z.string(),
  label: z.string(),
  kind: z.enum(['length', 'percent', 'custom']),
  customUnit: z.string().optional(),
  enabled: z.boolean(),
  preset: z.boolean(),
  order: num,
});
const measurementEntry = z.object({ ...base, day, values: z.record(z.string(), nonNeg) });
const foodEntry = z.object({
  ...base,
  day,
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snacks']),
  state: z.enum(['resolved', 'pending', 'awaiting_confirmation', 'unmatched']),
  food: foodItem.optional(),
  queryText: z.string().optional(),
  quantity,
  grams: nonNeg.optional(),
  nutrition: nutrients.optional(),
  lookup: lookup.optional(),
  manual: z.boolean().optional(),
});
const customFood = z.object({ ...base, name: z.string(), brand: z.string().optional(), per100g: nutrients, portions: z.array(portion) });
const favorite = z.object({ ...base, food: foodItem });
const savedMeal = z.object({ ...base, name: z.string(), items: z.array(z.object({ food: foodItem, quantity })) });

const settings = z.object({
  id: z.literal('settings'),
  units: z.enum(['metric', 'imperial']),
  theme: z.enum(['light', 'dark', 'system']),
  habitOnly: z.boolean(),
  hideBodyTracking: z.boolean(),
  onlineLookup: z.boolean().optional(),
  fallbackWeightKg: nonNeg.optional(),
  measurementReminderWeeks: z.literal([1, 2, 4]).optional(),
  backupReminderDays: num.min(1),
  lastBackupAt: num.optional(),
  backupReminderDismissedAt: num.optional(),
  measurementReminderDismissedAt: num.optional(),
  installHintDismissedAt: num.optional(),
  updatedAt: num,
});
const goals = z.object({
  id: z.literal('goals'),
  kcal: nonNeg.optional(),
  proteinG: nonNeg.optional(),
  carbsG: nonNeg.optional(),
  fatG: nonNeg.optional(),
  workoutsPerWeek: nonNeg.optional(),
  goalWeightKg: nonNeg.optional(),
  updatedAt: num,
});

export const backupSchema = z.object({
  app: z.literal('fitwell'),
  schemaVersion: z.int().min(1),
  exportedAt: num,
  installId: z.string(),
  data: z.object({
    settings: settings.optional(),
    goals: goals.optional(),
    foodEntries: z.array(foodEntry).optional(),
    customFoods: z.array(customFood).optional(),
    favorites: z.array(favorite).optional(),
    savedMeals: z.array(savedMeal).optional(),
    workouts: z.array(workout).optional(),
    workoutTemplates: z.array(template).optional(),
    customExercises: z.array(customExercise).optional(),
    customActivities: z.array(customActivity).optional(),
    weightEntries: z.array(weightEntry).optional(),
    measurementTypes: z.array(measurementType).optional(),
    measurementEntries: z.array(measurementEntry).optional(),
  }),
});
