import { describe, expect, it } from 'vitest';
import { suggestProgression, type SessionSets } from '../src/domain/progression';

const session = (day: string, sets: [reps: number, kg: number, target?: number][], extra: Partial<SessionSets['sets'][number]> = {}): SessionSets => ({
  day,
  sets: sets.map(([reps, weightKg, targetReps]) => ({ type: 'working', reps, weightKg, ...(targetReps ? { targetReps } : {}), ...extra })),
});

describe('suggestProgression', () => {
  it('adds 2.5 kg when every set hit its target', () => {
    const p = suggestProgression([session('2026-10-10', [[5, 80, 5], [5, 80, 5], [6, 80, 5]])], 'barbell');
    expect(p).toMatchObject({ action: 'increase', weightKg: 82.5, reps: 5 });
  });

  it('uses 2 kg steps for dumbbells', () => {
    expect(suggestProgression([session('d', [[10, 20, 10], [10, 20, 10]])], 'dumbbell')).toMatchObject({ weightKg: 22 });
  });

  it('repeats the weight after a miss, and deloads after two misses at the same weight', () => {
    const miss = session('2026-10-10', [[5, 80, 5], [4, 80, 5]]);
    expect(suggestProgression([miss], 'barbell')).toMatchObject({ action: 'repeat', weightKg: 80 });
    const missBefore = session('2026-10-07', [[5, 80, 5], [3, 80, 5]]);
    expect(suggestProgression([miss, missBefore], 'barbell')).toMatchObject({ action: 'deload', weightKg: 72.5 });
  });

  it('adds a rep for bodyweight exercises', () => {
    const p = suggestProgression([session('d', [[8, 80, 8], [8, 80, 8]], { bodyweightKg: 80 })], 'body only');
    expect(p).toMatchObject({ action: 'add_rep', reps: 9 });
    expect(p!.weightKg).toBeUndefined();
  });

  it('judges against the first set without targets, and gives up on mixed weights or no sets', () => {
    expect(suggestProgression([session('d', [[8, 60], [8, 60]])], 'barbell')).toMatchObject({ action: 'increase', weightKg: 62.5, reps: 8 });
    expect(suggestProgression([session('d', [[8, 60], [8, 62.5]])], 'barbell')).toBeNull();
    expect(suggestProgression([session('d', [[8, 60]], { done: false })], 'barbell')).toBeNull();
    expect(suggestProgression([], 'barbell')).toBeNull();
  });

  describe('effort', () => {
    /** Five-rep sets at 80 kg that all hit the target, with the given efforts (undefined: none tapped). */
    const hit = (efforts: (number | undefined)[], kg = 80, extra: Partial<SessionSets['sets'][number]> = {}): SessionSets => ({
      day: '2026-10-20',
      sets: efforts.map((effort) => ({ type: 'working', reps: 5, weightKg: kg, targetReps: 5, ...(effort ? { effort } : {}), ...extra })),
    });

    it('adds two steps when every set felt Easy', () => {
      const p = suggestProgression([hit([1, 1, 1])], 'barbell');
      expect(p).toEqual({ weightKg: 85, reps: 5, action: 'increase', reason: 'All sets reached 5 reps at 80 kg and every one felt Easy; add 5 kg.' });
      expect(suggestProgression([hit([1, 1], 20)], 'dumbbell')).toMatchObject({ weightKg: 24 });
    });

    it('adds one step when the hardest set felt Solid or Hard', () => {
      expect(suggestProgression([hit([1, 2, 1])], 'barbell')).toEqual({ weightKg: 82.5, reps: 5, action: 'increase', reason: 'All sets reached 5 reps at 80 kg, the hardest felt Solid; add 2.5 kg.' });
      expect(suggestProgression([hit([2, 3, 3])], 'barbell')).toMatchObject({ weightKg: 82.5, action: 'increase', reason: expect.stringContaining('the hardest felt Hard') });
    });

    it('holds the weight when any set felt Max', () => {
      expect(suggestProgression([hit([1, 2, 4])], 'barbell')).toEqual({ weightKg: 80, reps: 5, action: 'repeat', reason: 'All sets reached 5 reps at 80 kg, but one felt Max; stay there until it feels easier.' });
    });

    it('adds one step when only some sets were Easy and the rest had no effort', () => {
      expect(suggestProgression([hit([1, undefined, 1])], 'barbell')).toMatchObject({ weightKg: 82.5, action: 'increase', reason: expect.stringContaining('the ones noted felt Easy') });
    });

    it('keeps the plain rule and reason when no effort was tapped', () => {
      expect(suggestProgression([hit([undefined, undefined])], 'barbell')).toEqual({ weightKg: 82.5, reps: 5, action: 'increase', reason: 'All sets reached 5 reps at 80 kg; add 2.5 kg.' });
    });

    it('does not change a miss or a deload', () => {
      const miss = (day: string): SessionSets => ({ day, sets: [{ type: 'working', reps: 5, weightKg: 80, targetReps: 5, effort: 1 }, { type: 'working', reps: 3, weightKg: 80, targetReps: 5, effort: 1 }] });
      expect(suggestProgression([miss('b')], 'barbell')).toMatchObject({ action: 'repeat', weightKg: 80 });
      expect(suggestProgression([miss('b'), miss('a')], 'barbell')).toMatchObject({ action: 'deload', weightKg: 72.5 });
    });

    it('counts reps for bodyweight exercises: two more when Easy, the same when Max', () => {
      const bw = { bodyweightKg: 80 };
      expect(suggestProgression([hit([1, 1], 80, bw)], 'body only')).toMatchObject({ action: 'add_rep', reps: 7 });
      expect(suggestProgression([hit([3, 2], 80, bw)], 'body only')).toMatchObject({ action: 'add_rep', reps: 6 });
      expect(suggestProgression([hit([2, 4], 80, bw)], 'body only')).toMatchObject({ action: 'repeat', reps: 5, reason: expect.stringContaining('but one felt Max') });
    });

    it('ignores effort on warm-ups and values outside 1 to 4', () => {
      const s = hit([1, 1]);
      s.sets.unshift({ type: 'warmup', reps: 5, weightKg: 40, effort: 4 });
      expect(suggestProgression([s], 'barbell')).toMatchObject({ weightKg: 85 });
      expect(suggestProgression([hit([9, 0])], 'barbell')).toMatchObject({ weightKg: 82.5, reason: 'All sets reached 5 reps at 80 kg; add 2.5 kg.' });
    });
  });
});
