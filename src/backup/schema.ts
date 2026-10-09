import * as v from 'valibot';
import { isDay } from '../domain/dates';

const num = v.pipe(v.number(), v.finite());
const nonNeg = v.pipe(num, v.minValue(0));

const base = {
  id: v.pipe(v.string(), v.minLength(1)),
  createdAt: num,
  updatedAt: num,
  deletedAt: v.optional(num),
  rev: v.pipe(num, v.integer(), v.minValue(1)),
};

const nutrients = v.object({ kcal: nonNeg, protein: nonNeg, carbs: nonNeg, fat: nonNeg });
const portion = v.object({ label: v.string(), grams: v.pipe(num, v.minValue(0)) });
const quantity = v.object({ amount: nonNeg, unit: v.picklist(['g', 'portion']), portionLabel: v.optional(v.string()) });
const foodRef = v.object({ kind: v.picklist(['bundled', 'off', 'custom']), id: v.string() });
const foodItem = v.object({
  ref: foodRef,
  name: v.string(),
  brand: v.optional(v.string()),
  group: v.optional(v.string()),
  per100g: nutrients,
  portions: v.array(portion),
});
const candidate = v.object({
  source: v.literal('off'),
  sourceId: v.string(),
  name: v.string(),
  brand: v.optional(v.string()),
  per100g: nutrients,
  portions: v.array(portion),
});
const lookup = v.object({
  queryVersion: v.pipe(num, v.integer(), v.minValue(0)),
  attempts: v.pipe(num, v.integer(), v.minValue(0)),
  nextAttemptAt: v.optional(num),
  lastError: v.optional(v.string()),
  candidates: v.optional(v.array(candidate)),
  suggestedIndex: v.optional(v.pipe(num, v.integer(), v.minValue(0))),
  completedAt: v.optional(num),
});
const setType = v.picklist(['warmup', 'working']);
const workoutSet = v.object({ id: v.string(), type: setType, reps: nonNeg, weightKg: nonNeg });
const cardio = v.object({
  activityRef: v.string(),
  activityName: v.string(),
  met: nonNeg,
  durationMin: nonNeg,
  distanceKm: v.optional(nonNeg),
  kcalEstimated: v.optional(nonNeg),
  kcalOverride: v.optional(nonNeg),
  weightKgUsed: v.optional(nonNeg),
});
const workout = v.object({
  ...base,
  day: v.pipe(v.string(), v.check(isDay, 'not a valid day')),
  type: v.picklist(['cardio', 'strength']),
  name: v.optional(v.string()),
  cardio: v.optional(cardio),
  exercises: v.optional(v.array(v.object({ exerciseRef: v.string(), exerciseName: v.string(), sets: v.array(workoutSet) }))),
});
const template = v.object({
  ...base,
  name: v.string(),
  type: v.picklist(['cardio', 'strength']),
  cardio: v.optional(v.object({ activityRef: v.string(), activityName: v.string(), met: nonNeg, durationMin: nonNeg, distanceKm: v.optional(nonNeg) })),
  exercises: v.optional(
    v.array(v.object({ exerciseRef: v.string(), exerciseName: v.string(), sets: v.array(v.object({ type: setType, reps: nonNeg, weightKg: nonNeg })) })),
  ),
});
const customExercise = v.object({ ...base, name: v.string(), primary: v.array(v.string()), equipment: v.optional(v.string()) });
const customActivity = v.object({ ...base, name: v.string(), met: nonNeg });
const dayStr = v.pipe(v.string(), v.check(isDay, 'not a valid day'));
const weightEntry = v.object({ ...base, day: dayStr, kg: v.pipe(num, v.minValue(1), v.maxValue(700)) });
const measurementType = v.object({
  ...base,
  key: v.string(),
  label: v.string(),
  kind: v.picklist(['length', 'percent', 'custom']),
  customUnit: v.optional(v.string()),
  enabled: v.boolean(),
  preset: v.boolean(),
  order: num,
});
const measurementEntry = v.object({ ...base, day: dayStr, values: v.record(v.string(), nonNeg) });
const day = v.pipe(v.string(), v.check(isDay, 'not a valid day'));

const foodEntry = v.object({
  ...base,
  day,
  slot: v.picklist(['breakfast', 'lunch', 'dinner', 'snacks']),
  state: v.picklist(['resolved', 'pending', 'awaiting_confirmation', 'unmatched']),
  food: v.optional(foodItem),
  queryText: v.optional(v.string()),
  quantity,
  grams: v.optional(nonNeg),
  nutrition: v.optional(nutrients),
  lookup: v.optional(lookup),
  manual: v.optional(v.boolean()),
});
const customFood = v.object({ ...base, name: v.string(), brand: v.optional(v.string()), per100g: nutrients, portions: v.array(portion) });
const favorite = v.object({ ...base, food: foodItem });
const savedMeal = v.object({ ...base, name: v.string(), items: v.array(v.object({ food: foodItem, quantity })) });

const settings = v.object({
  id: v.literal('settings'),
  units: v.picklist(['metric', 'imperial']),
  theme: v.picklist(['light', 'dark', 'system']),
  habitOnly: v.boolean(),
  hideBodyTracking: v.boolean(),
  onlineLookup: v.optional(v.boolean()),
  fallbackWeightKg: v.optional(nonNeg),
  measurementReminderWeeks: v.optional(v.picklist([1, 2, 4])),
  backupReminderDays: v.pipe(num, v.minValue(1)),
  lastBackupAt: v.optional(num),
  backupReminderDismissedAt: v.optional(num),
  measurementReminderDismissedAt: v.optional(num),
  updatedAt: num,
});
const goals = v.object({
  id: v.literal('goals'),
  kcal: v.optional(nonNeg),
  proteinG: v.optional(nonNeg),
  carbsG: v.optional(nonNeg),
  fatG: v.optional(nonNeg),
  workoutsPerWeek: v.optional(nonNeg),
  goalWeightKg: v.optional(nonNeg),
  updatedAt: num,
});

/** Header checked first, so a file from a newer app is reported as such instead of as "invalid". */
export const headerSchema = v.object({
  app: v.literal('fitwell'),
  schemaVersion: v.pipe(num, v.integer(), v.minValue(1)),
});

export const backupSchema = v.object({
  app: v.literal('fitwell'),
  schemaVersion: v.pipe(num, v.integer(), v.minValue(1)),
  exportedAt: num,
  installId: v.string(),
  data: v.object({
    settings: v.optional(settings),
    goals: v.optional(goals),
    foodEntries: v.optional(v.array(foodEntry)),
    customFoods: v.optional(v.array(customFood)),
    favorites: v.optional(v.array(favorite)),
    savedMeals: v.optional(v.array(savedMeal)),
    workouts: v.optional(v.array(workout)),
    workoutTemplates: v.optional(v.array(template)),
    customExercises: v.optional(v.array(customExercise)),
    customActivities: v.optional(v.array(customActivity)),
    weightEntries: v.optional(v.array(weightEntry)),
    measurementTypes: v.optional(v.array(measurementType)),
    measurementEntries: v.optional(v.array(measurementEntry)),
  }),
});

export type Backup = v.InferOutput<typeof backupSchema>;
export type BackupData = Backup['data'];

/** Stores included in a backup, in a stable order. `doc` stores hold a single record keyed by name. */
export const BACKUP_STORES = [
  { name: 'settings', kind: 'doc' },
  { name: 'goals', kind: 'doc' },
  { name: 'foodEntries', kind: 'collection' },
  { name: 'customFoods', kind: 'collection' },
  { name: 'favorites', kind: 'collection' },
  { name: 'savedMeals', kind: 'collection' },
  { name: 'workouts', kind: 'collection' },
  { name: 'workoutTemplates', kind: 'collection' },
  { name: 'customExercises', kind: 'collection' },
  { name: 'customActivities', kind: 'collection' },
  { name: 'weightEntries', kind: 'collection' },
  { name: 'measurementTypes', kind: 'collection' },
  { name: 'measurementEntries', kind: 'collection' },
] as const;
export type BackupStoreName = (typeof BACKUP_STORES)[number]['name'];
