// The shape of a weekly review. Pure types, shared with the review view (which can't see server code).
import type { Day } from '@fitwell/core/domain/dates';
import type { EnergyProgress } from './types';

export interface WeekReview {
  weekStart: Day;
  /** Last day counted: the Sunday, or today while the week is still running. */
  weekEnd: Day;
  /** The week is not over yet, so averages cover the days so far. */
  inProgress: boolean;
  daysCounted: number;
  nutrition: {
    daysLogged: number;
    average: { kcal: number; protein: number; carbs: number; fat: number } | null;
    previousAverage: { kcal: number; protein: number } | null;
    goals: { kcal: number | null; proteinG: number | null };
    kcalWithin10Pct: number | null;
    proteinReached: number | null;
  };
  training: {
    strength: number;
    cardio: number;
    cardioMin: number;
    previousSessions: number;
    goalPerWeek: number | null;
    /** Exercises whose best estimated 1RM this week beat everything before it (within the loaded history). */
    records: { name: string; e1rmKg: number; previousKg: number | null }[];
  };
  weight: {
    weighIns: number;
    /** 7-day average at the end of the week and one week earlier; null without enough weigh-ins. */
    averageKg: number | null;
    previousAverageKg: number | null;
    changeKg: number | null;
    goalKg: number | null;
  };
  habits: {
    sleepHours: number | null;
    previousSleepHours: number | null;
    steps: number | null;
    previousSteps: number | null;
    waterMl: number | null;
    previousWaterMl: number | null;
  };
  /** Expenditure measured over the 28 days up to the end of the week, and what it means for the goal. */
  energy: EnergyProgress;
  /** Meals in the week's plan and how many were logged from it; null without a plan. */
  plan: { meals: number; logged: number } | null;
  highlights: string[];
  /** Things to consider next week, in neutral language. Claude explains and the person decides. */
  suggestions: string[];
}
