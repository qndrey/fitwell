import { describe, expect, it } from 'vitest';
import type { EnergyProgress } from '../src/analytics/types';
import { ASK_GOAL, energyView, NO_ESTIMATE } from '../ui/dashboard/energy';

const base: EnergyProgress = { expenditureKcal: 2760, reason: null, confidence: 'high', from: '2026-09-14', to: '2026-10-11', daysCounted: 27, daysExcluded: 1, weighIns: 20, intakeKcal: 2350, trendKgPerWeek: -0.35, trendKg: 80, goalKcal: 1800, direction: 'lose', suggestedKcal: 2210, suggestedRateKgPerWeek: 0.5, goalDate: '2026-11-24', notes: [] };

describe('dashboard energy card', () => {
  it('says why there is no estimate', () => {
    const v = energyView({ ...base, expenditureKcal: null, reason: 'Needs, within the last 28 days, 3 weigh-ins.' });
    expect(v.empty).toBe(NO_ESTIMATE);
    expect(v.reason).toBe('Needs, within the last 28 days, 3 weigh-ins.');
    expect(v.burned).toBeNull();
  });
  it('shows eaten against burned, the gap, the target and the goal date, all marked as estimates', () => {
    const v = energyView(base);
    expect(v.headline).toBe('~2,760 kcal a day burned (reliable estimate)');
    expect(v).toMatchObject({ eaten: 2350, burned: 2760, gap: 'Eating ~410 kcal a day under what you burn.', trend: 'Weight trend: −0.35 kg a week', target: 'To lose 0.5 kg a week: ~2,210 kcal a day (your goal is 1,800)', goalDate: 'Goal weight around 24 Nov at the current trend', ask: ASK_GOAL });
  });
  it('hides the target row without a goal weight', () => {
    const v = energyView({ ...base, direction: null, suggestedKcal: null, suggestedRateKgPerWeek: null, goalDate: null });
    expect(v.target).toBeNull();
    expect(v.ask).toBeNull();
    expect(v.goalDate).toBeNull();
  });
  it('words the other directions and a rough estimate', () => {
    expect(energyView({ ...base, direction: 'maintain', suggestedRateKgPerWeek: null }).target).toContain('To keep the weight: ~2,210');
    expect(energyView({ ...base, confidence: 'low', intakeKcal: 3000 })).toMatchObject({ headline: '~2,760 kcal a day burned (rough estimate)', gap: 'Eating ~240 kcal a day over what you burn.' });
  });
});
