import { describe, expect, it } from 'vitest';
import { prepare, search } from '../../src/search/rank';
import { tokenize, withinOneEdit } from '../../src/search/text';
import { loadBundledFoods } from '../../src/data/bundledFoods';

const idx = (names: string[]) => prepare(names, (n) => n);

describe('text', () => {
  it('folds accents and splits words', () => {
    expect(tokenize('Jordbær, rå (Crème)')).toEqual(['jordbær', 'ra', 'creme']);
  });
  it('detects single edits', () => {
    expect(withinOneEdit('bannana', 'banana')).toBe(true);
    expect(withinOneEdit('chiken', 'chicken')).toBe(true);
    expect(withinOneEdit('bananan', 'banana')).toBe(true);
    expect(withinOneEdit('bnaana', 'banana')).toBe(true);
    expect(withinOneEdit('bnnaaa', 'banana')).toBe(false);
    expect(withinOneEdit('rice', 'mice')).toBe(true);
    expect(withinOneEdit('rice', 'mouse')).toBe(false);
  });
});

describe('search ranking', () => {
  const names = ['Yoghurt with pear and banana', 'Banana, raw', 'Banana chips', 'Cooking banana, Plantain, raw', 'Rice, brown, raw'];
  it('prefers foods whose main noun matches, then shorter names', () => {
    expect(search(idx(names), 'banana').slice(0, 2)).toEqual(['Banana, raw', 'Banana chips']);
  });
  it('requires every word to match', () => {
    expect(search(idx(names), 'banana raw')).toEqual(['Banana, raw', 'Cooking banana, Plantain, raw']);
    expect(search(idx(names), 'banana xyz')).toEqual([]);
  });
  it('matches by prefix as you type', () => {
    expect(search(idx(names), 'ban')[0]).toBe('Banana, raw');
  });
  it('tolerates one typo when there are few hits', () => {
    expect(search(idx(names), 'bananna')[0]).toBe('Banana, raw');
  });
  it('returns nothing for an empty query', () => {
    expect(search(idx(names), '  ')).toEqual([]);
  });
});

describe('bundled Frida data', () => {
  it('loads with attribution and plausible values', async () => {
    const { info, foods } = await loadBundledFoods();
    expect(info.license).toBe('CC BY 4.0');
    expect(info.attribution).toContain('10.11583/DTU.29500682');
    expect(foods.length).toBeGreaterThan(1300);
    const ids = new Set(foods.map((f) => f.ref.id));
    expect(ids.size).toBe(foods.length);
    for (const f of foods) {
      expect(f.per100g.kcal).toBeGreaterThanOrEqual(0);
      expect(f.per100g.kcal).toBeLessThanOrEqual(900);
    }
  });
  it('finds everyday foods near the top and is fast', async () => {
    const { foods } = await loadBundledFoods();
    const index = prepare(foods, (f) => f.name);
    for (const [q, expected] of [['banana', 'banana'], ['egg', 'egg'], ['oats', 'oat'], ['milk', 'milk'], ['chicken breast', 'chicken']]) {
      const top = search(index, q!, 5).map((f) => f.name.toLowerCase());
      expect(top.some((n) => n.includes(expected!)), `${q}: ${top.join(' | ')}`).toBe(true);
    }
    const t = performance.now();
    for (let i = 0; i < 50; i++) search(index, 'chiken brest');
    expect((performance.now() - t) / 50).toBeLessThan(15);
  });
});
