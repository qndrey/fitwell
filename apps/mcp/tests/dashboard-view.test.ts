// The dashboard as a person sees it: the built view in a real Chromium, fed the progress the server really computes.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const progress = async (days = 90) => ((await call(client, 'get_dashboard_data', { days })).data as unknown as { progress: Progress }).progress;
const open = async (p: Progress) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { progress: p } });

async function logLift(id: string, session: [number, number, number][]) {
  for (const [offset, reps, kg] of session) await call(client, 'log_past_workout', { day: addD(today, offset), exercises: [{ id, sets: [{ reps, weight_kg: kg }] }] });
}
const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip';

describe('strength card', () => {
  it('has the sessions of a lift on the server: top set, estimate and new bests', async () => {
    await logLift(BENCH, [[-20, 5, 60], [-13, 5, 65], [-6, 5, 62.5], [-2, 5, 70]]);
    const lift = (await progress()).records.exercises[0]!;
    expect(lift.sessions.map((s) => [s.topSet, s.isBest])).toEqual([[{ kg: 60, reps: 5 }, false], [{ kg: 65, reps: 5 }, true], [{ kg: 62.5, reps: 5 }, false], [{ kg: 70, reps: 5 }, true]]);
    expect(lift.sessions[3]!.e1rm).toBe(81.7);
  });

  it('keeps up to 12 lifts, the most trained first', async () => {
    const ids = ['Barbell_Squat', 'Barbell_Curl', 'Barbell_Deadlift', 'Bent_Over_Barbell_Row', 'Standing_Military_Press', 'Barbell_Bench_Press_-_Medium_Grip', 'Dumbbell_Bicep_Curl', 'Dumbbell_Shoulder_Press', 'Barbell_Shrug', 'Close-Grip_Barbell_Bench_Press', 'Barbell_Incline_Bench_Press_-_Medium_Grip', 'Barbell_Full_Squat', 'Front_Barbell_Squat'];
    for (const [i, id] of ids.entries()) await logLift(`ex:${id}`, [[-3 - i, 5, 50]]);
    const p = await progress();
    expect(p.records.exercises.length).toBeLessThanOrEqual(12);
    expect(p.records.exercises.length).toBeGreaterThan(6);
  });

  it('opens a lift to its chart with ◆ marks and the last five sessions, and shows all lifts on request', async () => {
    await logLift(BENCH, [[-40, 5, 55], [-33, 5, 60], [-26, 5, 65], [-19, 5, 62.5], [-12, 5, 67.5], [-5, 5, 70], [-1, 3, 80]]);
    const ids = ['Barbell_Squat', 'Barbell_Curl', 'Barbell_Deadlift', 'Bent_Over_Barbell_Row', 'Standing_Military_Press', 'Dumbbell_Bicep_Curl', 'Barbell_Shrug'];
    for (const [i, id] of ids.entries()) await logLift(`ex:${id}`, [[-3 - i, 5, 50]]);
    const p = await progress();
    const v = await open(p);
    const card = await showCard(v, 'strength', 'Strength');
    const lifts = card.locator('details.lift');
    await pwExpect(lifts).toHaveCount(p.records.exercises.length); // every lift is a row; the card scrolls
    await pwExpect(card.getByRole('button')).toHaveCount(0);

    const bench = lifts.filter({ hasText: 'Barbell Bench Press' }).first();
    await pwExpect(bench.locator('.name')).toHaveText('Barbell Bench Press'); // short name in the row
    await pwExpect(bench.locator('summary')).toHaveAttribute('aria-label', /^Barbell Bench Press - Medium Grip: /); // the full library name for assistive tech
    await bench.locator('summary').click();
    expect(await bench.locator('polygon.pr').count()).toBe(p.records.exercises.find((e) => e.id === BENCH)!.sessions.filter((s) => s.isBest).length);
    await pwExpect(bench.getByText('◆ new best estimate')).toBeVisible();
    await pwExpect(bench.getByText('Open full lift page: ask Claude to show your Barbell Bench Press progress.')).toBeVisible(); // a hint, not a button
    await pwExpect(bench.getByRole('button')).toHaveCount(0);
    const rows = bench.locator('table.sessions tbody tr');
    await pwExpect(rows).toHaveCount(5);
    await pwExpect(rows.first()).toContainText('3 × 80 kg'); // the newest session first
    await pwExpect(rows.first()).toContainText('◆ best');
    await pwExpect(bench.locator('table.sessions caption')).toHaveText('Last 5 sessions');
    await pwExpect(card.getByText('Epley estimate from sets of 12 reps or fewer', { exact: false })).toBeAttached();
    await bench.locator('summary').click(); // closes again
    await pwExpect(bench.locator('table.sessions')).toBeHidden();
  }, 60_000);
});

describe('sleep goal in the habits card', () => {
  async function habits(goal: number | null) {
    for (const [d, h] of [[-4, 6.5], [-3, 7], [-2, 8], [-1, 7.5]] as const) await call(client, 'log_body', { day: addD(today, d), sleep_hours: h });
    if (goal !== null) await call(client, 'set_goals', { sleep_h: goal });
    const v = await open(await progress(30));
    return showCard(v, 'habits', 'Sleep, steps, water');
  }

  it('draws the line, the legend entry and the text when there is a goal', async () => {
    const card = await habits(7.5);
    await pwExpect(card.getByText('average on 4 logged nights, goal 7.5 h')).toBeVisible();
    await pwExpect(card.getByText('hours slept · dashed: sleep goal 7.5 h')).toBeVisible();
    await pwExpect(card.locator('svg line.goal')).toHaveCount(1);
  }, 30_000);

  it('draws no line and makes no claim without a goal', async () => {
    const card = await habits(null);
    await pwExpect(card.getByText('hours slept', { exact: true })).toBeVisible();
    await pwExpect(card.getByText('average on 4 logged nights', { exact: true })).toBeVisible();
    await pwExpect(card.locator('svg line.goal')).toHaveCount(0);
    await pwExpect(card.getByText(/goal/i)).toHaveCount(0);
    await pwExpect(card.getByText(/\b8 h\b/)).toHaveCount(0);
  }, 30_000);
});

describe('muscle rows', () => {
  it('say hard sets a week with the level in words, the 10 and 20 ticks, and point to the muscle map', async () => {
    const sets = (n: number) => Array.from({ length: n }, () => ({ reps: 8, weight_kg: 40 }));
    for (const off of [-2, -3, -4]) expect((await call(client, 'log_past_workout', { day: addD(today, off), exercises: [{ id: BENCH, sets: sets(8) }, ...(off === -2 ? [{ id: 'ex:Barbell_Squat', sets: sets(4) }] : [])] })).isError).toBe(false);
    const v = await open(await progress(30));
    const card = await showCard(v, 'volume', 'Volume');
    await pwExpect(card.getByText('Hard sets a week, by muscle')).toBeVisible();
    await pwExpect(card.getByText('Working sets')).toHaveCount(0);
    await pwExpect(card.locator('.row', { hasText: 'chest' })).toContainText('over 20');
    await pwExpect(card.locator('.row', { hasText: 'quadriceps' })).toContainText('under 10');
    await pwExpect(card.locator('.row').first().locator('i.tick')).toHaveCount(2);
    await pwExpect(card.getByText(/Ask Claude to show the muscle map\./)).toBeVisible();
    await pwExpect(card.getByText(/1 for the muscles an exercise mainly works and 0\.5/)).toBeVisible();
  }, 30_000);
});
