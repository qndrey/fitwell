/** The workout the player view runs. Built by `start_workout` from library ids; shared by the server and the view. */
export interface PlannedSet {
  reps: number;
  /** Absent for bodyweight exercises. */
  weightKg?: number;
}

export interface PlannedExercise {
  id: string;
  name: string;
  equipment: string;
  restSec: number;
  sets: PlannedSet[];
}

export interface WorkoutPlan {
  workoutId: string;
  name: string;
  exercises: PlannedExercise[];
}

/** What the view sends to `log_set` after each set. */
export interface LoggedSet {
  workoutId: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg?: number;
}

export const WORKOUT_VIEW_URI = 'ui://fitwell/workout.html';
