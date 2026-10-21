// Wording of the dashboard's energy card. Pure (no DOM), so the tests can reach it.
import type { EnergyProgress } from '../../src/analytics/types';
import { fmtDay, num } from '../shared/chartMath';

export const NO_ESTIMATE = 'No estimate yet: needs about 2 weeks of logged food and 3 or more weigh-ins.';
export const ASK_GOAL = 'Ask Claude to update your calorie goal.';
export const CONFIDENCE_WORD = { high: 'reliable', medium: 'fair', low: 'rough' } as const;

const signed = (n: number, digits: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n), digits)}`;

export interface EnergyView {
  /** Set when there is no estimate: the card shows only this (and `reason`). */
  empty: string | null;
  reason: string | null;
  burned: number | null;
  eaten: number | null;
  /** One line over both bars: the estimate and how far to trust it. */
  headline: string;
  /** Eaten minus burned, in words, and the weight trend a week. */
  gap: string | null;
  trend: string | null;
  /** Only with a goal weight. */
  target: string | null;
  goalDate: string | null;
  /** Shown when a target is. */
  ask: string | null;
  basis: string;
}

export function energyView(e: EnergyProgress): EnergyView {
  if (e.expenditureKcal === null) return { empty: NO_ESTIMATE, reason: e.reason, burned: null, eaten: null, headline: '', gap: null, trend: null, target: null, goalDate: null, ask: null, basis: '' };
  const burned = e.expenditureKcal;
  const eaten = e.intakeKcal;
  const diff = eaten === null ? null : Math.round(eaten - burned);
  const withGoal = e.direction !== null && e.suggestedKcal !== null;
  const aim = e.direction === 'maintain' ? 'To keep the weight' : `To ${e.direction} ${num(e.suggestedRateKgPerWeek ?? 0, 2)} kg a week`;
  return {
    empty: null,
    reason: null,
    burned,
    eaten,
    headline: `~${num(burned, 0)} kcal a day burned (${CONFIDENCE_WORD[e.confidence ?? 'low']} estimate)`,
    gap: diff === null ? null : diff === 0 ? 'Eaten and burned are level.' : `Eating ~${num(Math.abs(diff), 0)} kcal a day ${diff < 0 ? 'under' : 'over'} what you burn.`,
    trend: e.trendKgPerWeek === null ? null : `Weight trend: ${signed(e.trendKgPerWeek, 2)} kg a week`,
    target: withGoal ? `${aim}: ~${num(e.suggestedKcal!, 0)} kcal a day${e.goalKcal ? ` (your goal is ${num(e.goalKcal, 0)})` : ''}` : null,
    goalDate: e.goalDate ? `Goal weight around ${fmtDay(e.goalDate, e.goalDate.slice(0, 4) !== e.to.slice(0, 4))} at the current trend` : null,
    ask: withGoal ? ASK_GOAL : null,
    basis: `Estimate from ${fmtDay(e.from)} to ${fmtDay(e.to)}: ${e.daysCounted} logged days, ${e.weighIns} weigh-ins.`,
  };
}
