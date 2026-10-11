import { describe, expect, it } from 'vitest';
import { prepareExercises, searchExercises, type Exercise } from '../../src/data/exercises';
import data from '../../src/data/generated/exercises.index.json';

const all: Exercise[] = (data as unknown as { exercises: { id: string; name: string; equipment: string; primary: string[]; secondary: string[] }[] }).exercises.map((e) => ({ ref: `ex:${e.id}`, name: e.name, equipment: e.equipment, primary: e.primary, secondary: e.secondary }));
const index = prepareExercises(all);
const top = (query: string, n = 3, yours?: Set<string>) => searchExercises(index, all, { query }, n, yours).map((e) => e.name);

describe('exercise search ranking', () => {
  it('puts the plain movements people mean first', () => {
    expect(top('squat')).toContain('Barbell Squat');
    expect(top('squat').join()).not.toMatch(/Jerk|Bands|Chains/);
    expect(top('bench', 2)).toEqual(expect.arrayContaining(['Barbell Bench Press - Medium Grip', 'Dumbbell Bench Press']));
    expect(top('deadlift', 1)).toEqual(['Barbell Deadlift']);
    expect(top('plank', 1)).toEqual(['Plank']);
  });
  it('does not lead with a variant where the word only describes the setup ("Squat To A Bench")', () => {
    expect(top('bench', 5).slice(0, 2).join()).not.toMatch(/To A Bench/);
  });
  it('puts exercises you have done first', () => {
    const box = all.find((e) => e.name === 'Box Squat')!;
    expect(top('squat', 1, new Set([box.ref]))).toEqual(['Box Squat']);
  });
  it('still filters by muscle and equipment', () => {
    const r = searchExercises(index, all, { query: 'curl', equipment: 'dumbbell' }, 10);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.equipment === 'dumbbell')).toBe(true);
  });
});
