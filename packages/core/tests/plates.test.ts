import { describe, expect, it } from 'vitest';
import { platesFor, warmupRamp } from '../src/domain/plates';

describe('plates', () => {
  it('loads each side heaviest first, exactly where the plates allow', () => {
    expect(platesFor(100)).toEqual({ perSide: [25, 15], totalKg: 100, shortKg: 0 });
    expect(platesFor(62.5)).toEqual({ perSide: [20, 1.25], totalKg: 62.5, shortKg: 0 });
    expect(platesFor(20)).toEqual({ perSide: [], totalKg: 20, shortKg: 0 });
    expect(platesFor(15)).toBeNull();
  });

  it('says how far short it falls, and follows the person\'s own bar and plates', () => {
    expect(platesFor(61)).toEqual({ perSide: [20], totalKg: 60, shortKg: 1 });
    const home = { barKg: 15, platesKg: [10, 5, 2.5] };
    expect(platesFor(50, home)).toEqual({ perSide: [10, 5, 2.5], totalKg: 50, shortKg: 0 });
    expect(platesFor(40, home)!.perSide).toEqual([10, 2.5]);
  });
});

describe('warm-up ramp', () => {
  it('ramps from the empty bar to just under the working weight', () => {
    // 100 kg: bar, 50, 70, 85.
    expect(warmupRamp(100, 'full')).toEqual([
      { weightKg: 20, reps: 8 },
      { weightKg: 50, reps: 5 },
      { weightKg: 70, reps: 3 },
      { weightKg: 85, reps: 1 },
    ]);
  });

  it('rounds steps down to loadable weights and drops repeats', () => {
    // 60 kg: bar, 30, 42 → 40 (11 kg a side: 10 + nothing that fits), 51 → 50.
    expect(warmupRamp(60, 'full')).toEqual([
      { weightKg: 20, reps: 8 },
      { weightKg: 30, reps: 5 },
      { weightKg: 40, reps: 3 },
      { weightKg: 50, reps: 1 },
    ]);
    // 40 kg: 50 % is the bar again, so it is not repeated.
    expect(warmupRamp(40, 'full').map((s) => s.weightKg)).toEqual([20, 27.5, 32.5]);
  });

  it('is short for later lifts and absent for light ones', () => {
    expect(warmupRamp(100, 'short')).toEqual([
      { weightKg: 60, reps: 4 },
      { weightKg: 80, reps: 2 },
    ]);
    expect(warmupRamp(35, 'full')).toEqual([]);
  });
});
