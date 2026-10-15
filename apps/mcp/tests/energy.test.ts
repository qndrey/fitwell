import type { Client } from '@modelcontextprotocol/client';
import { addDays } from '@fitwell/core/domain/dates';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EnergyProgress } from '../src/analytics/types';
import type { WeekReview } from '../src/analytics/reviewTypes';
import type { User } from '../src/data/users';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
});

const RYE = 'frida:413'; // 209 kcal per 100 g
const TO = '2026-10-11'; // a Sunday, in the past (a review of a future week is refused)
const FIRST = addDays(TO, -27);

/** Four weeks of 1000 g rye (2090 kcal) a day while the weight drops 0.1 kg a day (0.7 kg a week), weighed every other day. */
async function seed() {
  for (let k = 0; k < 28; k++) {
    const day = addDays(FIRST, k);
    await call(client, 'log_food', { day, items: [{ food_id: RYE, grams: 1000 }] });
    if (k % 2 === 0) await call(client, 'log_body', { day, weight_kg: Math.round((84 - 0.1 * k) * 10) / 10 });
  }
  await call(client, 'set_goals', { kcal: 1800, goal_weight_kg: 78.5 });
}

describe('measured expenditure', () => {
  it('reports the burn, the calories for the goal and the goal date in get_progress', async () => {
    await seed();
    const p = (await call(client, 'get_progress', { days: 30, to: TO })).data as { energy: EnergyProgress & { method: string } };
    // 2090 kcal eaten + 0.1 kg × 7700 kcal a day lost = 2860.
    expect(p.energy).toMatchObject({ expenditureKcal: 2860, confidence: 'high', daysCounted: 28, weighIns: 14, intakeKcal: 2090, trendKgPerWeek: -0.7, direction: 'lose', suggestedKcal: 2310, suggestedRateKgPerWeek: 0.5, goalKcal: 1800 });
    // Trend line at 84 − 2.7 = 81.3 kg on the last day; 2.8 kg to go at 0.7 kg a week = 28 days.
    expect(p.energy.trendKg).toBe(81.3);
    expect(p.energy.goalDate).toBe(addDays(TO, 28));
    expect(p.energy.method).toContain('7700');
  });

  it('says what is missing instead of guessing', async () => {
    await call(client, 'log_body', { day: TO, weight_kg: 80 });
    const p = (await call(client, 'get_progress', { days: 30, to: TO })).data as { energy: EnergyProgress };
    expect(p.energy.expenditureKcal).toBeNull();
    expect(p.energy.reason).toContain('(0 so far)');
    expect(p.energy.suggestedKcal).toBeNull();
  });

  it('turns it into a check-in in the weekly review', async () => {
    await seed();
    const r = (await call(client, 'show_weekly_review', { week_start: addDays(TO, -6) })).data as unknown as { review: WeekReview };
    expect(r.review.energy.expenditureKcal).toBe(2860);
    expect(r.review.suggestions.join('\n')).toContain('a burn of about 2860 kcal a day. To lose 0.5 kg a week, that means about 2310 kcal a day; the goal is 1800.');
    expect(r.review.highlights.join('\n')).toContain(`goal weight of 78.5 kg is reached around ${addDays(TO, 28)}`);
  });

  it('gives full targets from the measured burn, without an activity level', async () => {
    await call(client, 'update_profile', { sex: 'female', birth_year: 1992, height_cm: 168, weight_kg: 70 });
    expect((await call(client, 'suggest_targets', { goal: 'lose' })).text).toContain('activity_level');
    const { data } = await call(client, 'suggest_targets', { goal: 'lose', expenditure_kcal: 2400 });
    expect(data.targets).toMatchObject({ tdee: 2400, kcal: 1850, proteinG: 140 });
    expect(data.method).toContain('measured expenditure');
  });
});
