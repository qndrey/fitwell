/** Energy needs and macro targets. Estimates for planning, not medical advice. */

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
  activity: ActivityLevel;
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
 * Daily targets: TDEE = BMR × activity; a deficit or surplus from the weekly rate (deficit capped at 25 %
 * of TDEE and never below BMR); protein 1.6 g/kg (2.0 when losing, to keep muscle); fat 25 % of energy but at
 * least 0.6 g/kg; carbohydrate takes the rest. Rounded: kcal to 10, grams to 5.
 */
export function suggestTargets(input: TargetInput): Targets {
  const notes: string[] = [];
  const base = bmr(input);
  const tdee = base * ACTIVITY_FACTOR[input.activity];
  const rate = input.goal === 'maintain' ? 0 : (input.rateKgPerWeek ?? (input.goal === 'lose' ? 0.5 : 0.25));
  let delta = (rate * KCAL_PER_KG) / 7;
  if (input.goal === 'lose') {
    const cap = tdee * 0.25;
    if (delta > cap) {
      delta = cap;
      notes.push('Deficit capped at 25 % of maintenance; the weekly rate will be slower than asked.');
    }
    if (tdee - delta < base) {
      delta = Math.max(0, tdee - base);
      notes.push('Target kept at or above basal metabolic rate.');
    }
  }
  const kcal = input.goal === 'lose' ? tdee - delta : input.goal === 'gain' ? tdee + delta : tdee;
  const proteinG = input.weightKg * (input.goal === 'lose' ? 2.0 : 1.6);
  const fatG = Math.max((kcal * 0.25) / 9, input.weightKg * 0.6);
  const carbsG = Math.max(0, (kcal - proteinG * 4 - fatG * 9) / 4);
  const r = (v: number, step: number) => Math.round(v / step) * step;
  return { bmr: Math.round(base), tdee: Math.round(tdee), kcal: r(kcal, 10), proteinG: r(proteinG, 5), carbsG: r(carbsG, 5), fatG: r(fatG, 5), notes };
}
