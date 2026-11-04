// What the meal plan view draws (D6): a week of meals against the goals, with what can be changed.
import type { SlotName } from '../planning/check';

export interface PlanMeal {
  /** The meal's place in the plan: what the edit tools take (with the plan's version). */
  index: number;
  slot: SlotName;
  name: string;
  kind: 'food' | 'recipe' | 'estimate';
  servings: number | null;
  kcal: number;
  protein: number;
  /** Already added to the food log, so it cannot be changed. */
  logged: boolean;
  /** In a household week: the calories of this meal at each member's portion, in the order of `household.members`. */
  memberKcal?: number[];
}

export interface PlanDay {
  day: string;
  weekday: string;
  /** Before today: nothing here can be logged as eaten any more by a tap... shown as past. */
  past: boolean;
  meals: PlanMeal[];
  totals: { kcal: number; protein: number } | null;
  /** Calories against the goal: ok within 10 %, else low or high; protein: ok at 90 % or more, else short. */
  status: { kcal: 'ok' | 'low' | 'high' | null; protein: 'ok' | 'short' | null };
  vsGoal: { kcal: number | null; protein: number | null };
}

export interface MealPlanView {
  weekStart: string;
  today: string;
  /** Changes with every edit: the edit tools refuse a stale one, so two windows cannot overwrite each other. */
  version: number;
  goals: { kcal: number | null; proteinG: number | null };
  days: PlanDay[];
  /** Allergy and dislike matches in the plan, in plain words (an allergy is never left unsaid). */
  warnings: string[];
  /** The other problems of the plan (a day well under the goal, an empty day). */
  problems: string[];
  /** When this week follows the household's plan: who cooks, at what portion. Only names and portions: nothing else of a member is ever in it. */
  household?: { members: { label: string; portion: number; you: boolean }[] };
  /** Saved recipes a meal can be swapped for. */
  recipes: { id: string; name: string; kcalPerServing: number }[];
}
