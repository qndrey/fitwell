/** Energy needs and macro targets. Estimates for planning, not medical advice. */
import { addDays, dayNumber, type Day } from './dates';

export type Sex = 'female' | 'male';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type WeightGoal = 'lose' | 'maintain' | 'gain';

/** Standard multipliers on BMR (sedentary: desk job, little exercise … very active: hard training daily or physical job). */
export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Energy stored in 1 kg of body weight change, the usual planning figure. */
export const KCAL_PER_KG = 7700;

export interface Body {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
}

/** Basal metabolic rate, Mifflin-St Jeor (1990). */
export function bmr({ sex, ageYears, heightCm, weightKg }: Body): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === 'male' ? 5 : -161);
}

export interface TargetInput extends Body {
  /** Needed unless `maintenanceKcal` is given. */
  activity?: ActivityLevel;
  /** A measured maintenance (from `estimateExpenditure`), used instead of BMR × activity. */
  maintenanceKcal?: number;
  goal: WeightGoal;
  /** Wanted change per week, kg (positive). Defaults: 0.5 to lose, 0.25 to gain. */
  rateKgPerWeek?: number;
}

export interface Targets {
  bmr: number;
  tdee: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Plain-language notes on what was assumed or capped. */
  notes: string[];
}

/**
 * Daily targets: TDEE = BMR × activity (or a measured maintenance); a deficit or surplus from the weekly rate (deficit capped at 25 %
 * of TDEE and never below BMR); protein 1.6 g/kg (2.0 when losing, to keep muscle); fat 25 % of energy but at
 * least 0.6 g/kg; carbohydrate takes the rest. Rounded: kcal to 10, grams to 5.
 */
export function suggestTargets(input: TargetInput): Targets {
  const notes: string[] = [];
  const base = bmr(input);
  if (input.maintenanceKcal === undefined && !input.activity) throw new Error('suggestTargets needs an activity level or a measured maintenance.');
  const tdee = input.maintenanceKcal ?? base * ACTIVITY_FACTOR[input.activity!];
  const kcal = kcalForGoal(tdee, input.goal, input.rateKgPerWeek, base, notes);
  const proteinG = input.weightKg * (input.goal === 'lose' ? 2.0 : 1.6);
  const fatG = Math.max((kcal * 0.25) / 9, input.weightKg * 0.6);
  const carbsG = Math.max(0, (kcal - proteinG * 4 - fatG * 9) / 4);
  const r = (v: number, step: number) => Math.round(v / step) * step;
  return { bmr: Math.round(base), tdee: Math.round(tdee), kcal: r(kcal, 10), proteinG: r(proteinG, 5), carbsG: r(carbsG, 5), fatG: r(fatG, 5), notes };
}

/** Default weekly rate for a goal, kg (positive). */
export const defaultRate = (goal: WeightGoal): number => (goal === 'maintain' ? 0 : goal === 'lose' ? 0.5 : 0.25);

/**
 * Daily calories for a goal from a maintenance figure: the weekly rate as a daily deficit or surplus, a deficit
 * capped at 25 % of maintenance and, when BMR is known, never below it. Notes say what was capped. Unrounded.
 */
function kcalForGoal(maintenance: number, goal: WeightGoal, rateKgPerWeek: number | undefined, base: number | undefined, notes: string[]): number {
  const rate = goal === 'maintain' ? 0 : (rateKgPerWeek ?? defaultRate(goal));
  let delta = (rate * KCAL_PER_KG) / 7;
  if (goal === 'lose') {
    const cap = maintenance * 0.25;
    if (delta > cap) {
      delta = cap;
      notes.push('Deficit capped at 25 % of maintenance; the weekly rate will be slower than asked.');
    }
    if (base !== undefined && maintenance - delta < base) {
      delta = Math.max(0, maintenance - base);
      notes.push('Target kept at or above basal metabolic rate.');
    }
  }
  return goal === 'lose' ? maintenance - delta : goal === 'gain' ? maintenance + delta : maintenance;
}

// ---------------------------------------------------------------- expenditure from the person's own data

export interface ExpenditureInput {
  /** Calories logged per day; days without any food entry are simply absent. */
  intake: { day: Day; kcal: number }[];
  /** Weigh-ins, at most one per day. */
  weights: { day: Day; kg: number }[];
  /** Last day of the window, usually today. */
  to: Day;
  /** Window length in days (default 28): long enough to see through water swings, short enough to follow change. */
  windowDays?: number;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface Expenditure {
  /** Estimated energy expenditure, kcal a day, rounded to 10; null when the data can't support an estimate. */
  kcal: number | null;
  /** Why there is no estimate; null when there is one. */
  reason: string | null;
  from: Day;
  to: Day;
  /** Days whose intake was counted, and days left out as probably incomplete logs. */
  daysCounted: number;
  daysExcluded: number;
  weighIns: number;
  /** Average intake on the counted days. */
  intakeKcal: number | null;
  /** Slope of the weight trend (least squares over the weigh-ins), kg per week; negative is losing. */
  trendKgPerWeek: number | null;
  /** Where the trend line stands on the last day of the window. */
  trendKg: number | null;
  confidence: Confidence | null;
  notes: string[];
}

/** Fewest counted intake days, weigh-ins and days between first and last weigh-in for any estimate. */
export const EXPENDITURE_MIN = { days: 10, weighIns: 4, weighInSpan: 10 } as const;

/**
 * Energy expenditure from what the person ate and how their weight moved, the way adaptive coaching apps do it:
 * average intake minus the energy in the weight change (slope × 7700 kcal/kg). The weight trend is a least-squares
 * line over the window's weigh-ins, so single swings of water and food weigh little. Days with less than half of the
 * person's median intake are left out as partly logged (a forgotten dinner would otherwise read as a low burn).
 * Pure; the window ends on `to`.
 */
export function estimateExpenditure(i: ExpenditureInput): Expenditure {
  const windowDays = i.windowDays ?? 28;
  const from = addDays(i.to, -(windowDays - 1));
  const inWindow = <T extends { day: Day }>(xs: T[]) => xs.filter((x) => x.day >= from && x.day <= i.to);
  const logged = inWindow(i.intake).filter((d) => d.kcal > 0);
  const weights = inWindow(i.weights).sort((a, b) => (a.day < b.day ? -1 : 1));
  const median = medianOf(logged.map((d) => d.kcal));
  const counted = logged.filter((d) => d.kcal >= median * 0.5);
  const out: Expenditure = { kcal: null, reason: null, from, to: i.to, daysCounted: counted.length, daysExcluded: logged.length - counted.length, weighIns: weights.length, intakeKcal: null, trendKgPerWeek: null, trendKg: null, confidence: null, notes: [] };
  if (out.daysExcluded > 0) out.notes.push(`${out.daysExcluded} day${out.daysExcluded === 1 ? '' : 's'} with much less food than usual left out as probably not fully logged.`);

  const span = weights.length ? dayNumber(weights[weights.length - 1]!.day) - dayNumber(weights[0]!.day) : 0;
  const missing: string[] = [];
  if (counted.length < EXPENDITURE_MIN.days) missing.push(`food fully logged on at least ${EXPENDITURE_MIN.days} days (${counted.length} so far)`);
  if (weights.length < EXPENDITURE_MIN.weighIns || span < EXPENDITURE_MIN.weighInSpan) missing.push(`at least ${EXPENDITURE_MIN.weighIns} weigh-ins spread over ${EXPENDITURE_MIN.weighInSpan} days or more (${weights.length} so far)`);
  if (missing.length) {
    out.reason = `Needs, within the last ${windowDays} days, ${missing.join(' and ')}.`;
    return out;
  }

  const intake = counted.reduce((s, d) => s + d.kcal, 0) / counted.length;
  const { slope, at } = leastSquares(weights.map((w) => ({ x: dayNumber(w.day), y: w.kg })));
  const kcal = intake - slope * KCAL_PER_KG;
  out.intakeKcal = Math.round(intake);
  out.trendKgPerWeek = Math.round(slope * 7 * 100) / 100;
  out.trendKg = Math.round(at(dayNumber(i.to)) * 10) / 10;
  if (kcal < 1000 || kcal > 6000) {
    out.reason = `The numbers give ${Math.round(kcal)} kcal a day, which is not plausible; food is probably not being logged completely, or a weigh-in is wrong.`;
    return out;
  }
  out.kcal = Math.round(kcal / 10) * 10;
  out.confidence = counted.length >= 21 && weights.length >= 12 ? 'high' : counted.length >= 14 && weights.length >= 7 ? 'medium' : 'low';
  if (out.confidence === 'low') out.notes.push('Early estimate: it firms up with more logged days and weigh-ins.');
  return out;
}

export interface GoalTarget {
  goal: WeightGoal;
  rateKgPerWeek: number;
  /** Daily calories, rounded to 10. */
  kcal: number;
  notes: string[];
}

/** Daily calories for a goal from a measured expenditure instead of the formula; same caps as `suggestTargets`. */
export function targetFromExpenditure(expenditureKcal: number, goal: WeightGoal, rateKgPerWeek?: number, bmrKcal?: number): GoalTarget {
  const notes: string[] = [];
  const kcal = kcalForGoal(expenditureKcal, goal, rateKgPerWeek, bmrKcal, notes);
  return { goal, rateKgPerWeek: goal === 'maintain' ? 0 : (rateKgPerWeek ?? defaultRate(goal)), kcal: Math.round(kcal / 10) * 10, notes };
}

/** Which way the goal weight lies from the trend weight; within 0.5 kg counts as maintaining. */
export function goalDirection(trendKg: number, goalKg: number): WeightGoal {
  return goalKg < trendKg - 0.5 ? 'lose' : goalKg > trendKg + 0.5 ? 'gain' : 'maintain';
}

/**
 * The day the trend line reaches the goal weight at the current weekly rate; null when the trend is flat
 * (under 0.05 kg a week), heads away from the goal, or would take more than two years.
 */
export function projectGoalDate(trendKg: number, kgPerWeek: number, goalKg: number, from: Day): Day | null {
  const gap = goalKg - trendKg;
  if (Math.abs(kgPerWeek) < 0.05 || Math.sign(gap) !== Math.sign(kgPerWeek)) return null;
  const days = Math.ceil((gap / kgPerWeek) * 7 - 1e-9); // float noise must not add a day
  return days > 730 ? null : addDays(from, days);
}

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function leastSquares(pts: { x: number; y: number }[]): { slope: number; at: (x: number) => number } {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, at: (x) => my + slope * (x - mx) };
}
