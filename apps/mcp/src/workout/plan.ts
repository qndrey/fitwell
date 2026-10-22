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
  /** How hard the set felt, 1 (easy) to 4 (max), when the person said so. */
  effort?: number;
}

/** The four effort taps of a logged working set, easiest first: effort n is `EFFORT_LABELS[n - 1]`. */
export const EFFORT_LABELS = ['Easy', 'Solid', 'Hard', 'Max'] as const;

/** What earlier sessions did with an exercise, so the player can say a logged set beats them (compared the way the finish summary does). */
export interface ExerciseBests {
  /** Best estimated 1RM (Epley) of any earlier working set. */
  e1rm: number;
  /** [reps, heaviest kg] for each rep count seen, at most 12 pairs. */
  byReps: [number, number][];
  /** [kg, most reps] for the heaviest weights seen, at most 12 pairs. */
  atWeight: [number, number][];
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
  /** Absent for bodyweight and timed exercises and when there is nothing earlier to compare with: no record cue then. */
  bests?: ExerciseBests;
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

/** The rest that was running when the plan was read: time left by the server's clock (negative once it ran out, down to -3 s), the whole length, and the exercise whose card holds it. */
export interface PlannedRest {
  exerciseUid: string;
  remainingMs: number;
  totalMs: number;
}

export interface WorkoutPlan {
  workoutId: string;
  name: string;
  startedAt: number;
  finished: boolean;
  exercises: PlannedExercise[];
  /** Empty for a workout without cardio. */
  cardio: PlannedCardio[];
  /** A rest between sets that was still running (or ended under 3 s ago) when the plan was read. */
  rest?: PlannedRest;
  /** The person's bar and plates, for the plate calculator. */
  gym?: { barKg: number; platesKg: number[] };
}

export const WORKOUT_VIEW_URI = 'ui://fitwell/workout.html';

export const DASHBOARD_VIEW_URI = 'ui://fitwell/dashboard.html';

export const REVIEW_VIEW_URI = 'ui://fitwell/review.html';

export const SHOPPING_VIEW_URI = 'ui://fitwell/shopping.html';

export const FOOD_VIEW_URI = 'ui://fitwell/food.html';

export const EXERCISE_VIEW_URI = 'ui://fitwell/exercise.html';
