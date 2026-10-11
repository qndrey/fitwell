import type { FoodItem } from '../domain/foods';
import type { Nutrients, Portion, Quantity } from '../domain/nutrition';

/** Fields every user-owned record carries (sync-ready; see TECH_SPEC §3.1). */
export interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Tombstone. Records with this set are hidden from normal queries. */
  deletedAt?: number;
  rev: number;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export interface Settings {
  id: 'settings';
  units: 'metric' | 'imperial';
  theme: ThemePreference;
  habitOnly: boolean;
  hideBodyTracking: boolean;
  /** Allow looking foods up on Open Food Facts (sends only the search text). */
  onlineLookup: boolean;
  fallbackWeightKg?: number;
  measurementReminderWeeks?: 1 | 2 | 4;
  backupReminderDays: number;
  lastBackupAt?: number;
  measurementReminderDismissedAt?: number;
  installHintDismissedAt?: number;
  backupReminderDismissedAt?: number;
  updatedAt: number;
}

export interface Goals {
  id: 'goals';
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  workoutsPerWeek?: number;
  goalWeightKg?: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  units: 'metric',
  theme: 'system',
  habitOnly: false,
  hideBodyTracking: false,
  onlineLookup: true,
  backupReminderDays: 14,
  updatedAt: 0,
};

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snacks';
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

/** See PLAN §8. Gate 1 only creates `resolved` entries; the other states arrive with the pending queue. */
export type EntryState = 'resolved' | 'pending' | 'awaiting_confirmation' | 'unmatched';

/** A possible match from Open Food Facts, stored with the entry until the user decides. */
export interface Candidate {
  source: 'off';
  sourceId: string;
  name: string;
  brand?: string;
  per100g: Nutrients;
  portions: Portion[];
}

/** Bookkeeping for the background lookup (see src/queue). */
export interface LookupInfo {
  /** Bumped whenever the user edits the text; a lookup result is applied only if it still matches. */
  queryVersion: number;
  attempts: number;
  nextAttemptAt?: number;
  lastError?: string;
  candidates?: Candidate[];
  suggestedIndex?: number;
  completedAt?: number;
}

export interface FoodEntry extends Base {
  day: string;
  slot: Slot;
  state: EntryState;
  /** Snapshot of the food at logging time, so later edits to a custom food never change history. */
  food?: FoodItem;
  /** Free text for entries that are not resolved yet. */
  queryText?: string;
  quantity: Quantity;
  grams?: number;
  nutrition?: Nutrients;
  lookup?: LookupInfo;
  /** Values typed by hand instead of taken from a food. */
  manual?: boolean;
}

/** Foods fetched online, kept so they are searchable offline next time. Rebuildable cache, not part of backups. */
export interface CachedFood extends Base {
  food: FoodItem;
  fetchedAt: number;
}

export type SetType = 'warmup' | 'working';

export interface WorkoutSet {
  id: string;
  type: SetType;
  reps: number;
  /** Always kilograms; shown in the unit chosen in Settings. For a bodyweight set this is body weight + added load. */
  weightKg: number;
  /** Time under tension / hold for exercises measured in time (e.g. a plank), in seconds. `reps` is 0 for these. */
  durationSec?: number;
  /** Body weight (kg) at the time, kept only for sets of a bodyweight exercise so history doesn't change when you weigh in later. */
  bodyweightKg?: number;
  /**
   * false: planned, not lifted yet (prefilled from last time, a template or a repeat). Missing or true: done.
   * Only done sets count in summaries, history and progress, so older workouts (no flag) are unchanged.
   */
  done?: boolean;
}

export interface WorkoutExercise {
  /** Identifies this entry inside the workout (the same exercise can appear twice). Added when missing. */
  uid?: string;
  /** Exercises in a row that share a superset id are done back to back, round by round. */
  supersetId?: string;
  /** How the sets are measured: repetitions (default) or time. */
  mode?: 'reps' | 'time';
  /** `bodyweight`: the load is your own body weight, plus any added weight. */
  load?: 'weight' | 'bodyweight';
  /** "ex:<id>" for the bundled library, "cx:<id>" for your own. */
  exerciseRef: string;
  /** Name at the time of logging, so history survives library updates. */
  exerciseName: string;
  sets: WorkoutSet[];
}

export interface CardioDetails {
  /** "act:<slug>" (bundled) or "ca:<id>" (your own). */
  activityRef: string;
  activityName: string;
  met: number;
  durationMin: number;
  distanceKm?: number;
  /** MET × body weight (kg) × hours; absent when no body weight was known. */
  kcalEstimated?: number;
  kcalOverride?: number;
  weightKgUsed?: number;
}

export interface Workout extends Base {
  day: string;
  type: 'cardio' | 'strength';
  name?: string;
  cardio?: CardioDetails;
  exercises?: WorkoutExercise[];
  /** Strength only. When the timer was started (epoch ms). Missing: no timer, e.g. a workout logged afterwards. */
  startedAt?: number;
  /** Strength only. Set by Finish; a finished workout is closed (no more exercises or sets). */
  finishedAt?: number;
}

export interface WorkoutTemplate extends Base {
  name: string;
  type: 'cardio' | 'strength';
  cardio?: Pick<CardioDetails, 'activityRef' | 'activityName' | 'met' | 'durationMin' | 'distanceKm'>;
  exercises?: {
    exerciseRef: string;
    exerciseName: string;
    supersetId?: string;
    mode?: 'reps' | 'time';
    load?: 'weight' | 'bodyweight';
    sets: { type: SetType; reps: number; weightKg: number; durationSec?: number; bodyweightKg?: number }[];
  }[];
}

export interface CustomExercise extends Base {
  name: string;
  primary: string[];
  equipment?: string;
}

export interface CustomActivity extends Base {
  name: string;
  met: number;
}

/** One per day: the id is `weight:<day>`, so logging the same day again replaces it. Always kilograms. */
export interface WeightEntry extends Base {
  day: string;
  kg: number;
}

export interface MeasurementType extends Base {
  /** Preset ids are `mt:<key>` and stable; yours are random. */
  key: string;
  label: string;
  /** `length` is stored in cm and shown as cm/in; `percent` is a plain %; `custom` keeps whatever unit you named. */
  kind: 'length' | 'percent' | 'custom';
  customUnit?: string;
  enabled: boolean;
  preset: boolean;
  order: number;
}

/** One per day (`meas:<day>`): values by measurement type id, in canonical units (cm, %, or your custom unit). */
export interface MeasurementEntry extends Base {
  day: string;
  values: Record<string, number>;
}

export interface CustomFood extends Base {
  name: string;
  brand?: string;
  per100g: Nutrients;
  portions: Portion[];
}

export interface Favorite extends Base {
  food: FoodItem;
}

export interface SavedMealItem {
  food: FoodItem;
  quantity: Quantity;
}

export interface SavedMeal extends Base {
  name: string;
  items: SavedMealItem[];
}
