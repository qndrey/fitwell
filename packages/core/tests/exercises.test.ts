import { describe, expect, it } from 'vitest';
import { loadExercises, plainFirst, prepareExercises, searchExercises, substitutes } from '../src/data/exercises';

describe('plainFirst', () => {
  it('puts the plain lift ahead of variations', async () => {
    const lib = await loadExercises();
    const index = prepareExercises(lib.exercises);
    const top = (query: string, equipment?: string) => plainFirst(query, searchExercises(index, lib.exercises, { query, equipment }, 40))[0]?.name;
    expect(top('bench press', 'barbell')).toBe('Barbell Bench Press - Medium Grip');
    expect(top('squat', 'barbell')).toBe('Barbell Squat');
    expect(top('deadlift', 'barbell')).toBe('Barbell Deadlift');
    expect(top('curl', 'dumbbell')).toBe('Dumbbell Bicep Curl');
  });

  it('keeps a variation the query asks for', async () => {
    const lib = await loadExercises();
    const hits = plainFirst('incline bench press', searchExercises(prepareExercises(lib.exercises), lib.exercises, { query: 'incline bench press', equipment: 'barbell' }, 40));
    expect(hits[0]?.name).toMatch(/Incline/);
  });
});

describe('substitutes', () => {
  const byName = async (name: string) => (await loadExercises()).exercises.find((e) => e.name === name)!;

  it('offers lifts for the same main muscles, plain ones first', async () => {
    const { exercises } = await loadExercises();
    const squat = await byName('Barbell Squat');
    const subs = substitutes(squat, exercises);
    expect(subs.length).toBe(8);
    for (const e of subs) expect(e.primary).toContain('quadriceps');
    expect(subs.map((e) => e.name)).toContain('Leg Press');
    expect(subs.some((e) => e.category === 'stretching')).toBe(false);
    // A compound push, so the leg extension (an isolation) ranks below the leg press.
    const names = subs.map((e) => e.name);
    if (names.includes('Leg Extensions')) expect(names.indexOf('Leg Press')).toBeLessThan(names.indexOf('Leg Extensions'));
  });

  it('keeps to the equipment the person has and leaves out what is busy', async () => {
    const { exercises } = await loadExercises();
    const bench = await byName('Barbell Bench Press - Medium Grip');
    const noBar = substitutes(bench, exercises, { excludeEquipment: ['barbell'] });
    expect(noBar.length).toBeGreaterThan(3);
    expect(noBar.every((e) => e.equipment !== 'barbell')).toBe(true);
    expect(noBar.map((e) => e.name)).toContain('Dumbbell Bench Press');
    const home = substitutes(bench, exercises, { equipment: ['Dumbbells'] });
    expect(home.every((e) => ['dumbbell', 'body only', 'none'].includes(e.equipment))).toBe(true); // bodyweight always counts
    expect(home.map((e) => e.name)).toContain('Pushups');
  });
});
