/** The workout the player view runs. Built by `start_workout`; shared by the server and the view. */
export interface PlannedSet {
  /** Stable id inside the workout; `log_set` refers to it. */
  id: string;
  targetReps: number;
  /** Absent for bodyweight exercises. */
  weightKg?: number;
  done: boolean;
  skipped?: boolean;
  /** What was actually done, once logged. */
  reps?: number;
}

export interface PlannedExercise {
  id: string;
  name: string;
  equipment: string;
  restSec: number;
  bodyweight: boolean;
  sets: PlannedSet[];
  /** "3×5 @ 80 kg" from the last session with this exercise. */
  lastTime?: string;
  /** Why the planned weight is what it is (progression rule), when the server chose it. */
  note?: string;
}

export interface WorkoutPlan {
  workoutId: string;
  name: string;
  startedAt: number;
  finished: boolean;
  exercises: PlannedExercise[];
}

export const WORKOUT_VIEW_URI = 'ui://fitwell/workout.html';

export const DASHBOARD_VIEW_URI = 'ui://fitwell/dashboard.html';

export const REVIEW_VIEW_URI = 'ui://fitwell/review.html';

export const SHOPPING_VIEW_URI = 'ui://fitwell/shopping.html';
