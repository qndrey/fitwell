// The muscle map's strength mode (A10): how the best estimated 1RM of the lifts that mainly work each muscle changed against the period before.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MuscleMap } from '../src/analytics/muscleTypes';
import viewHtml from '../src/ui/generated/exercise';
import { heatColours, STRENGTH_HEAT } from '../ui/shared/muscleHeat';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView } from './support/viewHost';

let client: Client;
beforeAll(launch, 60_000);
afterAll(closeAll);
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip';
const SQUAT = 'ex:Barbell_Squat';
const lift = (kg: number, n = 4) => Array.from({ length: n }, () => ({ reps: 8, weight_kg: kg }));
const map = async (weeks = 1, to = '2026-10-11') => ((await call(client, 'show_muscle_map', { weeks, to })).data as unknown as { muscleMap: MuscleMap }).muscleMap;
const by = (m: MuscleMap) => Object.fromEntries(m.muscles.map((x) => [x.muscle, x]));
/** This week (5 Oct): bench at `now` kg. The week before (28 Sep): bench at `before` kg and squats at 80 kg. */
async function seed(now: number, before: number) {
  await call(client, 'log_past_workout', { day: '2026-10-08', exercises: [{ id: BENCH, sets: lift(now) }] });
  await call(client, 'log_past_workout', { day: '2026-09-29', exercises: [{ id: BENCH, sets: lift(before) }, { id: SQUAT, sets: lift(80) }] });
}

describe('the trend per muscle', () => {
  it('is up when the best estimated 1RM of the lifts that mainly work it went up, with the percent and how many lifts', async () => {
    await seed(60, 50);
    const chest = by(await map()).chest!.strength!;
    expect(chest).toMatchObject({ trend: 'up', lifts: 1 });
    expect(chest.changePct).toBeCloseTo(20, 0); // 60 kg against 50 kg at the same reps
  });

  it('is down for a lower best, and about the same within 2 percent', async () => {
    await seed(45, 50);
    expect(by(await map()).chest!.strength).toMatchObject({ trend: 'down' });
    const { env } = createTestEnv();
    client = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    await seed(50.5, 50);
    expect(by(await map()).chest!.strength).toMatchObject({ trend: 'same' });
  });

  it('has nothing to compare for a muscle whose lifts were not done in both periods, or never', async () => {
    await seed(60, 50);
    const m = by(await map());
    expect(m.quadriceps!.strength).toEqual({ trend: 'none', changePct: null, lifts: 0 }); // squats only in the week before
    expect(m.calves!.strength).toEqual({ trend: 'none', changePct: null, lifts: 0 });
  });

  it('counts only finished work with weight: a bodyweight set has no estimate', async () => {
    await call(client, 'log_past_workout', { day: '2026-10-08', exercises: [{ id: 'ex:Dips_-_Triceps_Version', sets: [{ reps: 10 }] }] });
    await call(client, 'log_past_workout', { day: '2026-09-29', exercises: [{ id: 'ex:Dips_-_Triceps_Version', sets: [{ reps: 8 }] }] });
    expect(by(await map()).triceps!.strength!.trend).toBe('none');
  });

  it('is in the text Claude reads, with percentages', async () => {
    await seed(60, 50);
    expect((await call(client, 'show_muscle_map', { weeks: 1, to: '2026-10-11' })).text).toMatch(/Strength \(best estimated 1RM.*up: chest \+2\d(\.\d)? %/);
  });
});

describe('the strength mode in the view', () => {
  it('colours by direction in four told-apart colours per theme', async () => {
    await seed(60, 50);
    const m = await map();
    for (const dark of [false, true]) {
      const c = heatColours(m, dark, 'strength');
      expect(c.get('chest')).toBe(STRENGTH_HEAT[dark ? 'dark' : 'light'].up);
      expect(c.get('calves')).toBe(STRENGTH_HEAT[dark ? 'dark' : 'light'].none);
      expect(new Set(Object.values(STRENGTH_HEAT[dark ? 'dark' : 'light'])).size).toBe(4);
    }
  });

  it('has a toggle that lists the muscles by direction with the percent, and goes back to sets', async () => {
    await seed(60, 50);
    const v = await openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { muscleMap: await map() } });
    const f = v.frame;
    const toggle = f.getByRole('button', { name: 'Strength change' });
    await pwExpect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await pwExpect(toggle).toHaveAttribute('aria-pressed', 'true');
    await pwExpect(f.getByRole('heading', { name: /Estimated 1RM up \(1\)/ })).toBeVisible();
    await pwExpect(f.locator('details', { hasText: 'Chest' }).first().locator('.sets')).toHaveText(/^\+\d+(\.\d)? % over 1 lift$/);
    await pwExpect(f.locator('.musclemap .delta')).toHaveCount(0);
    await toggle.click();
    await pwExpect(f.locator('details', { hasText: 'Chest' }).first().locator('.sets')).toHaveText('4 sets a week');
  }, 60_000);
});
