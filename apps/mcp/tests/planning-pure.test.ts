import frida from '@fitwell/core/data/generated/foods.frida.json';
import { describe, expect, it } from 'vitest';
import { checkPlan, type PlannedItem } from '../src/planning/check';
import { aisleOf, buildGroceryList, buyableGrams, formatGrams, type Ingredient } from '../src/planning/grocery';

describe('shopping sections', () => {
  const groups = (frida as unknown as { groups: string[] }).groups;

  it('puts every Frida food group in a real section', () => {
    expect(groups.length).toBeGreaterThan(100);
    expect(groups.filter((g) => aisleOf(g) === 'Other')).toEqual([]);
  });

  it('knows the common groups', () => {
    const expected: Record<string, string> = {
      Beef: 'Meat',
      Chicken: 'Meat',
      'Boiled, smoked, cured or dried meat': 'Meat',
      'Cold cuts': 'Meat',
      'Lean fish': 'Fish and seafood',
      'Oily fish': 'Fish and seafood',
      'Leaf and stem vegetables': 'Produce',
      'Root and tuber vegetables': 'Produce',
      'Soft fruit': 'Produce',
      'Fresh legumes': 'Produce',
      Herbs: 'Produce',
      'Firm rennet cheese': 'Dairy and eggs',
      'Fermented milk products': 'Dairy and eggs',
      'Fresh eggs': 'Dairy and eggs',
      Butter: 'Dairy and eggs',
      Bread: 'Bakery',
      'Grain and groats': 'Pantry',
      Pasta: 'Pantry',
      'Dried pulses': 'Pantry',
      'Canned vegetable products': 'Pantry',
      'Vegetable fats': 'Pantry',
      Nuts: 'Pantry',
      'Frozen vegetables': 'Frozen',
      'Dairy ice cream': 'Frozen',
      'Fruit juice and smoothies': 'Drinks',
      'Coffee, tea and cocoa': 'Drinks',
      'Plant-based alternatives to meat': 'Plant-based',
      'Biscuits and cookies': 'Snacks and sweets',
    };
    for (const [group, aisle] of Object.entries(expected)) expect(aisleOf(group), group).toBe(aisle);
    expect(aisleOf(undefined)).toBe('Other');
  });
});

describe('buying amounts', () => {
  it('rounds up to what a shop sells', () => {
    expect([0, 1, 95, 100, 101, 640, 1000, 1010, 2340].map(buyableGrams)).toEqual([0, 10, 100, 100, 150, 650, 1000, 1100, 2400]);
    expect([40, 650, 1000, 1250, 2400].map(formatGrams)).toEqual(['40 g', '650 g', '1 kg', '1.3 kg', '2.4 kg']);
  });
});

const ing = (name: string, grams: number, group?: string, foodId?: string): Ingredient => ({ name, grams, group, foodId: foodId ?? `frida:${name}` });

describe('grocery list', () => {
  const usages = [
    { label: 'Mon dinner', ingredients: [ing('Chicken breast', 180, 'Chicken'), ing('Rice', 70, 'Grain and groats'), ing('Broccoli', 150, 'Leaf and stem vegetables')] },
    { label: 'Tue lunch', ingredients: [ing('Chicken breast', 180, 'Chicken'), ing('Rye bread', 100, 'Bread')] },
    { label: 'Wed dinner', ingredients: [ing('Chicken breast', 180, 'Chicken'), ing('Rice', 70, 'Grain and groats'), { name: 'Protein bar (own)', grams: 60 }] },
  ];

  it('adds up per food, rounds up, and groups by section in shopping order', () => {
    const list = buildGroceryList(usages);
    expect(list.sections.map((s) => s.aisle)).toEqual(['Produce', 'Meat', 'Bakery', 'Pantry', 'Other']);
    const meat = list.sections.find((s) => s.aisle === 'Meat')!.items[0]!;
    expect(meat).toMatchObject({ name: 'Chicken breast', grams: 540, buy: '550 g', usedIn: ['Mon dinner', 'Tue lunch', 'Wed dinner'] });
    expect(list.sections.find((s) => s.aisle === 'Pantry')!.items[0]).toMatchObject({ name: 'Rice', grams: 140, buy: '150 g' });
    expect(list.sections.find((s) => s.aisle === 'Other')!.items[0]).toMatchObject({ name: 'Protein bar (own)', buy: '60 g' });
    expect(list.itemCount).toBe(5);
  });

  it('scales for more people', () => {
    const list = buildGroceryList(usages, 2);
    expect(list.sections.find((s) => s.aisle === 'Meat')!.items[0]).toMatchObject({ grams: 1080, buy: '1.1 kg' });
  });

  it('leaves out what the person already has, and says so', () => {
    const list = buildGroceryList(usages, 1, ['rice', ' BREAD ']);
    expect(list.sections.map((s) => s.aisle)).toEqual(['Produce', 'Meat', 'Other']);
    expect(list.leftOut).toEqual(['Rice', 'Rye bread']);
  });

  it('keeps foods without an id apart by name and shortens a long usedIn', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `Day ${i + 1}`, ingredients: [{ name: 'Olive oil', grams: 10, group: 'Vegetable fats' }] }));
    const item = buildGroceryList(many).sections[0]!.items[0]!;
    expect(item).toMatchObject({ name: 'Olive oil', grams: 80, buy: '80 g' });
    expect(item.usedIn).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', '+3 more']);
  });

  it('handles an empty plan', () => {
    expect(buildGroceryList([])).toEqual({ sections: [], itemCount: 0, leftOut: [] });
  });
});

describe('plan check', () => {
  const week = ['2026-10-19', '2026-10-20', '2026-10-21'];
  const item = (day: string, slot: PlannedItem['slot'], name: string, kcal: number, protein: number, ingredients: string[] = []): PlannedItem => ({
    day, slot, kind: 'food', name, grams: 100, kcal, protein, carbs: 0, fat: 0, ingredients: ingredients.map((n) => ({ name: n, grams: 10 })),
  });
  const goals = { kcal: 2000, proteinG: 120 };

  it('compares each day with the goals', () => {
    const items = [
      item('2026-10-19', 'lunch', 'A', 2050, 130), // fine
      item('2026-10-20', 'lunch', 'B', 1500, 100), // 25 % under and protein short
      item('2026-10-20', 'dinner', 'C', 900, 5), // brings the day to 2400 (20 % over); protein 105 is 87 % of the goal
    ];
    const c = checkPlan(week, items, goals);
    expect(c.days[0]).toMatchObject({ day: '2026-10-19', vsGoal: { kcal: 50, protein: 10 }, status: { kcal: 'ok', protein: 'ok' } });
    expect(c.days[1]).toMatchObject({ vsGoal: { kcal: 400, protein: -15 }, status: { kcal: 'high', protein: 'short' } });
    expect(c.emptyDays).toEqual(['2026-10-21']);
    expect(c.problems).toEqual(['2026-10-20: 2400 kcal is 400 over the 2000 kcal goal.', '2026-10-20: protein 105 g is 15 g short of the 120 g goal.', 'Nothing planned on 2026-10-21.']);
  });

  it('without goals only reports empty days', () => {
    const c = checkPlan(week, [item('2026-10-19', 'lunch', 'A', 5000, 0)], null);
    expect(c.days[0]!.status).toEqual({});
    expect(c.problems).toEqual(['Nothing planned on 2026-10-20, 2026-10-21.']);
  });

  it('finds allergies and dislikes in item and ingredient names, allergies first', () => {
    const items = [item('2026-10-19', 'lunch', 'Satay bowl', 700, 40, ['Peanut butter', 'Rice']), item('2026-10-19', 'dinner', 'Pasta', 700, 30, ['Olives'])];
    const c = checkPlan(week, items, null, ['Peanut'], ['olive', 'liver']);
    expect(c.warnings).toEqual([
      { day: '2026-10-19', slot: 'lunch', item: 'Satay bowl', kind: 'allergy', matches: ['peanut'] },
      { day: '2026-10-19', slot: 'dinner', item: 'Pasta', kind: 'dislike', matches: ['olive'] },
    ]);
    expect(c.problems[0]).toBe('ALLERGY: Satay bowl (2026-10-19 lunch) contains peanut.');
    expect(c.problems[1]).toBe('Disliked food: Pasta (2026-10-19 dinner) contains olive.');
  });
});
