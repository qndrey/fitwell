// Weekly volume on the dashboard's training card: tonnage on the server, hard sets by region, and the Sets / Volume control in the built view.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MUSCLE_GROUPS, REGION_OF, setsByRegion } from '../src/analytics/muscleTypes';
import type { Progress } from '../src/analytics/types';
import viewHtml from '../src/ui/generated/dashboard';
import { createTestEnv } from './support/env';
import { showCard } from './support/cards';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView } from './support/viewHost';

let client: Client;
beforeAll(launch, 60_000);
afterAll(closeAll);
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip';
const SQUAT = 'ex:Barbell_Squat';
const progress = async (days = 90) => ((await call(client, 'get_dashboard_data', { days })).data as unknown as { progress: Progress }).progress;
const open = async (p: Progress) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { progress: p } });

async function seed() {
  for (const off of [-30, -23, -16, -9, -2]) {
    expect((await call(client, 'log_past_workout', { day: addD(today, off), exercises: [{ id: BENCH, sets: [{ reps: 5, weight_kg: 60 }, { reps: 5, weight_kg: 60 }] }, { id: SQUAT, sets: [{ reps: 5, weight_kg: 80 }] }, { id: 'ex:Pullups', sets: [{ reps: 8 }] }] })).isError).toBe(false);
  }
}

describe('weekly tonnage', () => {
  it('adds reps × weight of the working sets of finished strength workouts, with bodyweight sets adding nothing', async () => {
    await seed();
    const weeks = (await progress()).training.weeks;
    expect(weeks.reduce((n, w) => n + w.tonnageKg, 0)).toBe(5 * (2 * 5 * 60 + 5 * 80));
    expect(weeks.every((w) => Number.isInteger(w.tonnageKg))).toBe(true);
    expect(weeks.filter((w) => w.tonnageKg === 0).length).toBeLessThan(weeks.length);
  });

  it('is zero for a person without strength workouts', async () => {
    expect((await progress(30)).training.weeks.every((w) => w.tonnageKg === 0)).toBe(true);
  });
});

describe('sets by region', () => {
  it('puts every muscle group of the map in upper, lower or core', () => {
    for (const m of MUSCLE_GROUPS) expect(['upper', 'lower', 'core']).toContain(REGION_OF[m]);
    expect(setsByRegion({ chest: 8, triceps: 4, quadriceps: 3, glutes: 1.5, abdominals: 2, 'lower back': 1 })).toEqual({ upper: 12, lower: 4.5, core: 3 });
  });
});

describe('training volume in the dashboard', () => {
  it('shows stacked sets with the 10 and 20 lines by default, a hidden table, and a 44 px Sets / Volume control', async () => {
    await seed();
    const v = await open(await progress());
    const card = await showCard(v, 'volume', 'Volume');
    const group = card.getByRole('group', { name: 'Volume measure' });
    await pwExpect(group.getByRole('button', { name: 'Sets' })).toHaveAttribute('aria-pressed', 'true');
    for (const b of await group.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const chart = card.locator('.chartbox').filter({ hasText: 'Upper body (sets)' });
    await pwExpect(chart.locator('svg line.goal')).toHaveCount(2);
    await pwExpect(chart.locator('svg rect[fill^="url(#hatch"]').first()).toBeAttached();
    await pwExpect(chart.locator('table.sr-only th')).toHaveText(['Week', 'Upper body (sets)', 'Lower body (sets)', 'Core (sets)']);
    for (const w of ['upper body', 'lower body', 'core']) await pwExpect(card.locator('.legend', { hasText: w })).toBeVisible();
    await pwExpect(card.getByText(/dashed lines: 10 and 20 sets a week/)).toBeVisible();
  }, 60_000);

  it('switches to tonnage per week and back', async () => {
    await seed();
    const p = await progress();
    const v = await open(p);
    const card = await showCard(v, 'volume', 'Volume');
    await card.getByRole('button', { name: 'Volume' }).click();
    await pwExpect(card.getByRole('button', { name: 'Volume' })).toHaveAttribute('aria-pressed', 'true');
    const table = card.locator('table.sr-only').filter({ hasText: 'Volume (kg)' });
    await pwExpect(table).toBeAttached();
    expect(await table.locator('tbody tr').count()).toBe(p.training.weeks.length);
    await pwExpect(table.locator('tbody tr td:nth-child(2)').filter({ hasText: '1,000' }).first()).toBeAttached();
    await pwExpect(card.locator('svg line.goal')).toHaveCount(0);
    await card.getByRole('button', { name: 'Sets' }).click();
    await pwExpect(card.getByText(/dashed lines: 10 and 20/)).toBeVisible();
  }, 60_000);

  it('says so when there is nothing to stack', async () => {
    await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day: addD(today, -2) });
    const v = await open(await progress(30));
    const card = await showCard(v, 'volume', 'Volume');
    await pwExpect(card.getByText('No finished strength sets in this period.')).toBeVisible();
  }, 60_000);
});
