import { describe, expect, it } from 'vitest';
import { labelProblems, parseAmount, quantityGrams, roundForDisplay, scale, sum, toPer100g } from '../src/domain/nutrition';
import { dayTotals } from '../src/domain/totals';
import type { FoodEntry } from '../src/schema';

const oats = { kcal: 373, protein: 13.8, carbs: 58.9, fat: 6.9 };

describe('nutrition', () => {
  it('scales per-100 g values', () => {
    expect(roundForDisplay(scale(oats, 40))).toEqual({ kcal: 149, protein: 5.5, carbs: 23.6, fat: 2.8 });
    expect(scale(oats, 0)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
  it('converts quantities to grams', () => {
    expect(quantityGrams({ amount: 150, unit: 'g' }, [])).toBe(150);
    expect(quantityGrams({ amount: 2, unit: 'portion', portionLabel: 'egg' }, [{ label: 'egg', grams: 55 }])).toBe(110);
    expect(quantityGrams({ amount: 2, unit: 'portion', portionLabel: 'gone' }, [])).toBe(0);
  });
  it('sums', () => {
    expect(sum([oats, oats]).kcal).toBe(746);
  });
  it('parses typed numbers, including decimal commas', () => {
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount(' 3 ')).toBe(3);
    expect(parseAmount('.5')).toBe(0.5);
    for (const bad of ['', 'abc', '-1', '1e3', '1.2.3', 'Infinity']) expect(parseAmount(bad), bad).toBeNull();
  });
});

describe('dayTotals', () => {
  const entry = (state: FoodEntry['state'], kcal?: number): FoodEntry => ({
    id: 'x', createdAt: 0, updatedAt: 0, rev: 1, day: '2026-01-01', slot: 'lunch', state,
    quantity: { amount: 1, unit: 'g' },
    nutrition: kcal === undefined ? undefined : { kcal, protein: 1, carbs: 2, fat: 3 },
  });
  it('counts only resolved entries and reports the rest as pending', () => {
    const t = dayTotals([entry('resolved', 100), entry('resolved', 50), entry('pending'), entry('awaiting_confirmation'), entry('unmatched')]);
    expect(t).toMatchObject({ kcal: 150, protein: 2, carbs: 4, fat: 6, resolvedCount: 2, pendingCount: 3 });
  });
});

describe('hand-verified day (values per 100 g from the bundled dataset)', () => {
  it('totals a mixed day exactly as a calculator would', async () => {
    const { loadBundledFoods } = await import('../src/data/bundledFoods');
    const { foods } = await loadBundledFoods();
    const by = (n: string) => foods.find((f) => f.name === n)!;
    const log: [string, number][] = [['Banana, raw', 120], ['Oats, rolled, average values', 60], ['Olive oil', 10]];
    const total = roundForDisplay(sum(log.map(([n, g]) => scale(by(n).per100g, g))));
    // banana 88/1.1/19.7/0.2 x1.2 + oats 373/13.8/58.9/6.9 x0.6 + oil 900/0/0/100 x0.1
    expect(total).toEqual({
      kcal: Math.round(88 * 1.2 + 373 * 0.6 + 900 * 0.1),
      protein: Math.round((1.1 * 1.2 + 13.8 * 0.6) * 10) / 10,
      carbs: Math.round((19.7 * 1.2 + 58.9 * 0.6) * 10) / 10,
      fat: Math.round((0.2 * 1.2 + 6.9 * 0.6 + 100 * 0.1) * 10) / 10,
    });
    expect(total.kcal).toBe(419);
  });
});

describe('label checks', () => {
  const none = { impossible: [], mismatch: [] };
  it('accepts real labels, fibre and a little alcohol included', () => {
    expect(labelProblems({ kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 })).toEqual(none); // oat flakes, 10 g fibre
    expect(labelProblems({ kcal: 740, protein: 0.6, carbs: 0.6, fat: 82 })).toEqual(none); // butter
    expect(labelProblems({ kcal: 43, protein: 0.5, carbs: 3.6, fat: 0 })).toEqual(none); // lager, 3.9 g alcohol
    expect(labelProblems({ kcal: 0, protein: 0, carbs: 0, fat: 0 })).toEqual(none); // water
  });

  it('catches kJ typed as kcal, and macros heavier than the food', () => {
    const kj = labelProblems({ kcal: 460, protein: 23, carbs: 0, fat: 1.5 }).mismatch; // chicken: 460 kJ = 110 kcal
    expect(kj).toHaveLength(1);
    expect(kj[0]).toContain('looks like kJ (110 kcal)');
    expect(labelProblems({ kcal: 120, protein: 23, carbs: 0, fat: 1.5 })).toEqual(none); // within tolerance
    const off = labelProblems({ kcal: 200, protein: 23, carbs: 0, fat: 1.5 }).mismatch;
    expect(off[0]).toContain('give about 106 kcal');
    expect(off[0]).not.toContain('kJ'); // wrong, but not by the kJ factor
    expect(labelProblems({ kcal: 500, protein: 50, carbs: 40, fat: 20 }).impossible[0]).toContain('110 g in 100 g');
    expect(labelProblems(toPer100g({ kcal: 300, protein: 0, carbs: 0, fat: 30 }, 25)).impossible.join(' ')).toContain('1200 kcal in 100 g is not possible; pure fat has 900'); // a serving misread
  });

  it('converts a serving to per 100 g', () => {
    expect(toPer100g({ kcal: 150, protein: 6, carbs: 27, fat: 3 }, 40)).toEqual({ kcal: 375, protein: 15, carbs: 67.5, fat: 7.5 });
  });
});
