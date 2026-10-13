import { describe, expect, it } from 'vitest';
import { bmr, suggestTargets } from '../src/domain/energy';

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
