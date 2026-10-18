/** The workout the player view runs. Built by `start_workout`; shared by the server and the view. */
export interface PlannedSet {
  /** Stable id inside the workout; `log_set` refers to it. */
  id: string;
  /** A warm-up set: lighter, a short rest after it, and it never counts in summaries or records. */
  warmup?: boolean;
  targetReps: number;
  /** Timed exercises: the planned seconds, and what was done once logged. */
  targetSec?: number;
  seconds?: number;
  /** Absent for bodyweight exercises. */
  weightKg?: number;
  done: boolean;
  skipped?: boolean;
  /** What was actually done, once logged. */
  reps?: number;
}

export interface PlannedExercise {
  /** Identifies this entry inside the workout (the same exercise can appear twice); notes are saved under it. */
  uid: string;
  id: string;
  name: string;
  equipment: string;
  restSec: number;
  bodyweight: boolean;
  /** Sets are measured in seconds (a plank), not reps. */
  timed?: boolean;
  /** Neighbouring exercises with the same id are done back to back, round by round. */
  supersetId?: string;
  sets: PlannedSet[];
  /** "3×5 @ 80 kg" from the last session with this exercise. */
  lastTime?: string;
  /** Why the planned weight is what it is (progression rule), when the server chose it. */
  note?: string;
  /** The person's own note for this exercise in this workout; editable in the player. */
  notes?: string;
  /** The note from the previous session with this exercise. */
  lastNotes?: string;
}

/** Cardio inside the workout: a warm-up before the lifting or a finisher after it. */
export interface PlannedCardio {
  id: string;
  name: string;
  when: 'before' | 'after';
  plannedMin: number;
  plannedKm?: number;
  /** What was logged. */
  minutes?: number;
  distanceKm?: number;
  done: boolean;
  skipped?: boolean;
}

export interface WorkoutPlan {
  workoutId: string;
  name: string;
  startedAt: number;
  finished: boolean;
  exercises: PlannedExercise[];
  /** Empty for a workout without cardio. */
  cardio: PlannedCardio[];
  /** The person's bar and plates, for the plate calculator. */
  gym?: { barKg: number; platesKg: number[] };
}

export const WORKOUT_VIEW_URI = 'ui://fitwell/workout.html';

export const DASHBOARD_VIEW_URI = 'ui://fitwell/dashboard.html';

export const REVIEW_VIEW_URI = 'ui://fitwell/review.html';

export const SHOPPING_VIEW_URI = 'ui://fitwell/shopping.html';

export const FOOD_VIEW_URI = 'ui://fitwell/food.html';

export const EXERCISE_VIEW_URI = 'ui://fitwell/exercise.html';
