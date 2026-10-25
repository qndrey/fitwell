// The week that has not ended yet is left out of the averages, also on a Sunday, when the period ends with it.
import { describe, expect, it } from 'vitest';
import { buildProgress, type ProgressInput } from '../src/analytics/progress';
import type { Workout } from '../src/data/workoutData';

const workout = (day: string): Workout => ({
  id: day, day, type: 'strength', name: null, startedAt: null, finishedAt: 1, exercises: [], cardio: null, session: null, cardioBlocks: [], templateId: null, createdAt: 0, updatedAt: 0,
});
// Three workouts on Mon, Wed and Fri of the two weeks from 2026-10-05, then a quiet week ending Sunday 2026-10-25.
const input = (today?: string): ProgressInput => ({
  from: '2026-10-05', to: '2026-10-25', today,
  workouts: ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16'].map(workout),
  weights: [], measurements: [], nutrition: [], goals: null, musclesOf: () => ({ primary: [], secondary: [] }),
});

describe('the week in progress', () => {
  it('on a Sunday, is partial and not counted', () => {
    const t = buildProgress(input('2026-10-25')).training;
    expect(t.weeks.map((w) => [w.week, w.partial])).toEqual([['2026-10-05', false], ['2026-10-12', false], ['2026-10-19', true]]);
    expect(t.perWeek).toBe(3);
  });
  it('counts a week that ended before today, as in a past period', () => {
    const t = buildProgress(input('2026-10-26')).training;
    expect(t.weeks.at(-1)).toMatchObject({ week: '2026-10-19', partial: false });
    expect(t.perWeek).toBe(2);
  });
});
