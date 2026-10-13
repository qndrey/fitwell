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
});
