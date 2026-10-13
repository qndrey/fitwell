import { describe, expect, it } from 'vitest';
import { loadExercises, plainFirst, prepareExercises, searchExercises } from '../src/data/exercises';

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
