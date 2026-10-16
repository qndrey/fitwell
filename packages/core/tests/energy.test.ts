import { describe, expect, it } from 'vitest';
import { addDays, type Day } from '../src/domain/dates';
import { bmr, estimateExpenditure, goalDirection, projectGoalDate, suggestTargets, targetFromExpenditure } from '../src/domain/energy';

const man = { sex: 'male' as const, ageYears: 35, heightCm: 180, weightKg: 80 };

describe('energy', () => {
  it('computes Mifflin-St Jeor BMR', () => {
    expect(bmr(man)).toBe(10 * 80 + 6.25 * 180 - 5 * 35 + 5); // 1755
    expect(bmr({ ...man, sex: 'female' })).toBe(1755 - 166);
  });

  it('maintains at TDEE with protein, fat and carbs adding up', () => {
    const t = suggestTargets({ ...man, activity: 'moderate', goal: 'maintain' });
    expect(t.tdee).toBe(Math.round(1755 * 1.55));
    expect(t.kcal).toBe(2720);
    expect(t.proteinG).toBe(130);
    const fromMacros = t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9;
    expect(Math.abs(fromMacros - t.kcal)).toBeLessThan(40); // rounding only
  });

  it('loses 0.5 kg a week by default, with more protein', () => {
    const t = suggestTargets({ ...man, activity: 'moderate', goal: 'lose' });
    expect(t.kcal).toBe(Math.round((1755 * 1.55 - 550) / 10) * 10);
    expect(t.proteinG).toBe(160);
    expect(t.notes).toEqual([]);
  });

  it('caps an aggressive deficit and never goes below BMR', () => {
    const t = suggestTargets({ sex: 'female', ageYears: 30, heightCm: 160, weightKg: 55, activity: 'sedentary', goal: 'lose', rateKgPerWeek: 1.5 });
    expect(t.kcal).toBeGreaterThanOrEqual(t.bmr - 10);
    expect(t.notes.length).toBeGreaterThan(0);
  });

  it('adds a surplus to gain', () => {
    const t = suggestTargets({ ...man, activity: 'active', goal: 'gain' });
    expect(t.kcal).toBe(Math.round((1755 * 1.725 + 275) / 10) * 10);
  });
});

describe('expenditure from logged intake and weight', () => {
  const to = '2026-10-28' as Day;
  const days = (n: number) => Array.from({ length: n }, (_, k) => addDays(to, -(n - 1 - k)));
  // 28 days at 2000 kcal while losing exactly 0.5 kg a week: 2000 + 0.5 × 7700 / 7 = 2550 kcal a day.
  const losing = () => ({ intake: days(28).map((day) => ({ day, kcal: 2000 })), weights: days(28).map((day, k) => ({ day, kg: 80 - (k * 0.5) / 7 })), to });

  it('adds the energy of the weight lost to what was eaten', () => {
    const e = estimateExpenditure(losing());
    expect(e.kcal).toBe(2550);
    expect(e.trendKgPerWeek).toBe(-0.5);
    expect(e.trendKg).toBe(78.1); // 80 − 27 × 0.5 / 7
    expect(e.intakeKcal).toBe(2000);
    expect(e.confidence).toBe('high');
    expect(e.reason).toBeNull();
  });

  it('equals intake on a plateau', () => {
    const e = estimateExpenditure({ ...losing(), weights: days(28).map((day) => ({ day, kg: 75 })) });
    expect(e.kcal).toBe(2000);
    expect(e.trendKgPerWeek).toBe(0);
  });

  it('leaves out days that look partly logged', () => {
    const i = losing();
    for (const k of [3, 9, 15]) i.intake[k] = { day: i.intake[k]!.day, kcal: 600 };
    const e = estimateExpenditure(i);
    expect(e.kcal).toBe(2550);
    expect(e.daysCounted).toBe(25);
    expect(e.daysExcluded).toBe(3);
    expect(e.notes[0]).toMatch(/3 days/);
  });

  it('sees through day-to-day weight swings', () => {
    const i = losing();
    i.weights = i.weights.map((w, k) => ({ day: w.day, kg: w.kg + (k % 2 ? 0.5 : -0.5) }));
    expect(Math.abs(estimateExpenditure(i).kcal! - 2550)).toBeLessThanOrEqual(40);
  });

  it('only looks at the window, and needs enough data', () => {
    const e = estimateExpenditure({ ...losing(), windowDays: 7 });
    expect(e.kcal).toBeNull();
    expect(e.reason).toMatch(/at least 10 days \(7 so far\)/);
    expect(e.reason).toMatch(/spread over 10 days/);
    const sparse = estimateExpenditure({ ...losing(), weights: losing().weights.filter((_, k) => k % 10 === 0) });
    expect(sparse.weighIns).toBe(3);
    expect(sparse.kcal).toBeNull();
  });

  it('rates confidence by how much was logged', () => {
    const i = losing();
    const medium = estimateExpenditure({ ...i, intake: i.intake.slice(-16), weights: i.weights.filter((_, k) => k % 3 === 0) });
    expect(medium.confidence).toBe('medium');
    const low = estimateExpenditure({ ...i, intake: i.intake.slice(-11), weights: i.weights.filter((_, k) => k % 6 === 0) });
    expect(low.confidence).toBe('low');
    expect(low.notes.at(-1)).toMatch(/Early estimate/);
  });

  it('refuses an implausible result', () => {
    const e = estimateExpenditure({ ...losing(), intake: days(28).map((day) => ({ day, kcal: 400 })), weights: days(28).map((day, k) => ({ day, kg: 80 + k * 0.1 })) });
    expect(e.kcal).toBeNull();
    expect(e.reason).toMatch(/not plausible/);
  });

  it('turns an expenditure into a goal target with the usual caps', () => {
    expect(targetFromExpenditure(2550, 'lose')).toEqual({ goal: 'lose', rateKgPerWeek: 0.5, kcal: 2000, notes: [] });
    expect(targetFromExpenditure(2550, 'maintain').kcal).toBe(2550);
    expect(targetFromExpenditure(2550, 'gain').kcal).toBe(2550 + 280); // 0.25 × 7700 / 7 = 275, rounded to 10
    const capped = targetFromExpenditure(1800, 'lose', 1, 1500);
    expect(capped.kcal).toBe(1500);
    expect(capped.notes).toHaveLength(2);
  });

  it('projects the goal date along the trend', () => {
    expect(goalDirection(80, 78)).toBe('lose');
    expect(goalDirection(80, 80.3)).toBe('maintain');
    expect(projectGoalDate(80, -0.5, 78, '2026-10-15' as Day)).toBe('2026-11-12');
    expect(projectGoalDate(80, 0.3, 78, '2026-10-15' as Day)).toBeNull(); // heading away
    expect(projectGoalDate(80, -0.02, 78, '2026-10-15' as Day)).toBeNull(); // flat
    expect(projectGoalDate(100, -0.05, 70, '2026-10-15' as Day)).toBeNull(); // over two years
  });
});

describe('targets from a measured maintenance', () => {
  it('uses the measured number instead of the formula, with the same macros rules', () => {
    const t = suggestTargets({ ...man, maintenanceKcal: 2550, goal: 'lose' });
    expect(t.tdee).toBe(2550);
    expect(t.kcal).toBe(2000);
    expect(t.proteinG).toBe(160);
    expect(() => suggestTargets({ ...man, goal: 'lose' })).toThrow(/activity/);
  });
});
