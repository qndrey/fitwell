// What the Today view draws: the day so far against goals, today's planned meals, a few foods to log again in one tap, water and steps, and today's training.
import type { SlotName } from '../planning/check';

export interface TodayMeal {
  slot: SlotName;
  items: { name: string; kcal: number; logged: boolean }[];
  kcal: number;
  /** Every item of the slot is already in the food log. */
  allLogged: boolean;
}

export interface TodayQuickAdd {
  /** An earlier entry to copy: its name, amount and nutrition as logged then. */
  entryId: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  estimated: boolean;
  /** An estimate with a range (a meal out): the calories could be anywhere in it; kcal is its middle. */
  kcalRange?: { low: number; high: number };
}

export interface TodayView {
  day: string;
  /** The meal a quick-add goes to right now. */
  slot: SlotName;
  goals: { kcal: number | null; proteinG: number | null };
  eaten: { kcal: number; protein: number; carbs: number; fat: number };
  /** Goal minus eaten, negative when over; null without that goal. */
  remaining: { kcal: number | null; protein: number | null };
  planned: TodayMeal[];
  quickAdd: TodayQuickAdd[];
  waterMl: number;
  steps: number | null;
  training: {
    doneToday: { name: string; minutes: number | null; type: 'strength' | 'cardio' | 'session' }[];
    /** The saved workout done least recently (or never): a suggestion, not a schedule. */
    /** The saved workout that has waited longest; `templateId` is what start_workout takes. */
    suggested: { templateId: string; name: string; daysSince: number | null } | null;
  };
}
