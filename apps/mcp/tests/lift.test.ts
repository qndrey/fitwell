// The lift page: the tool and its numbers on the server, and the built view in a real Chromium.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LiftProgress } from '../src/analytics/types';
import viewHtml from '../src/ui/generated/lift';
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

const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip';
const lift = async (args: Record<string, unknown>) => ((await call(client, 'show_lift_progress', args)).data as unknown as { lift: LiftProgress }).lift;
async function log(id: string, offset: number, sets: [number, number][]) {
  expect((await call(client, 'log_past_workout', { day: addD(today, offset), exercises: [{ id, sets: sets.map(([reps, weight_kg]) => ({ reps, weight_kg })) }] })).isError).toBe(false);
}
const open = async (l: LiftProgress) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { lift: l } });

describe('show_lift_progress', () => {
  it('is a read-only tool that opens the lift view', async () => {
    const t = (await client.listTools()).tools.find((x) => x.name === 'show_lift_progress')!;
    expect(t.annotations?.readOnlyHint).toBe(true);
    expect((t._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe('ui://fitwell/lift.html');
    const res = await client.readResource({ uri: 'ui://fitwell/lift.html' });
    expect((res.contents[0] as { text?: string }).text).not.toMatch(/<script[^>]+src=| style="/);
  });

  it('finds the lift by id and by name, and refuses an unknown one', async () => {
    await log(BENCH, -10, [[5, 60]]);
    expect((await lift({ id: BENCH })).id).toBe(BENCH);
    expect((await lift({ query: 'barbell bench press' })).sessions).toHaveLength(1);
    expect((await call(client, 'show_lift_progress', { id: 'ex:Nope' })).isError).toBe(true);
    expect((await call(client, 'show_lift_progress', {})).isError).toBe(true);
  });

  it('gives sessions with the reps at the top weight, new bests, and rep records', async () => {
    await log(BENCH, -30, [[5, 60], [5, 60]]);
    await log(BENCH, -20, [[5, 65], [5, 65], [3, 70]]);
    await log(BENCH, -10, [[5, 62.5]]);
    await log(BENCH, -2, [[1, 90], [8, 50]]);
    const l = await lift({ id: BENCH });
    expect(l.sessions.map((s) => [s.topSet, s.reps, s.isBest])).toEqual([
      [{ kg: 60, reps: 5 }, [5, 5], false],
      [{ kg: 70, reps: 3 }, [3], true], // 70 × 3 = 77 beats 65 × 5 = 75.8, so the 3 is the top set
      [{ kg: 62.5, reps: 5 }, [5], false],
      [{ kg: 90, reps: 1 }, [1], true],
    ]);
    expect(l.repRecords).toEqual([
      { reps: 1, kg: 90, day: addD(today, -2) },
      { reps: 3, kg: 70, day: addD(today, -20) },
      { reps: 5, kg: 65, day: addD(today, -20) },
      { reps: 8, kg: 50, day: addD(today, -2) },
    ]);
  });

  it('is empty for a lift never done and for a bodyweight one', async () => {
    const l = await lift({ id: BENCH });
    expect(l.sessions).toEqual([]);
    expect(l.repRecords.every((r) => r.kg === null && r.day === null)).toBe(true);
  });
});

describe('lift view', () => {
  it('draws the line with ◆ marks, rep records, the last 10 sessions and the hint; the period switch filters', async () => {
    const offsets = [-400, -300, -200, -100, -80, -70, -60, -50, -40, -30, -25, -20, -15, -10, -5];
    for (const [i, o] of offsets.entries()) await log(BENCH, o, [[5, 50 + i * 2.5]]);
    const l = await lift({ id: BENCH });
    const v = await open(l);
    const page = v.frame;
    await pwExpect(page.locator('h1')).toHaveText('Barbell Bench Press');
    await pwExpect(page.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
    await pwExpect(page.locator('section[aria-label="Estimated 1RM"] svg[role="img"]')).toHaveCount(1);
    const year = l.sessions.filter((s) => s.day >= addD(today, -364));
    expect(await page.locator('polygon.pr').count()).toBe(year.filter((s) => s.isBest).length);
    await pwExpect(page.getByText('◆ new best estimate')).toBeVisible();
    await pwExpect(page.locator('section[aria-label="Estimated 1RM"] .sr-only table tbody tr')).toHaveCount(year.length);
    await pwExpect(page.locator('section[aria-label="Last sessions"] tbody tr')).toHaveCount(10);
    await pwExpect(page.locator('section[aria-label="Last sessions"] tbody tr').first()).toContainText('5 × 85 kg');
    await pwExpect(page.locator('section[aria-label="Last sessions"] tbody tr').first()).toContainText('◆ best');
    await pwExpect(page.locator('section[aria-label="Rep records"] tbody tr')).toHaveCount(4);
    await pwExpect(page.getByText('Ask Claude for a progression plan.')).toBeVisible();
    expect(await page.getByRole('button').count()).toBe(3); // the period switch only

    await page.getByRole('button', { name: '90 days' }).click();
    const d90 = l.sessions.filter((s) => s.day >= addD(today, -89));
    await pwExpect(page.locator('section[aria-label="Estimated 1RM"] .sr-only table tbody tr')).toHaveCount(d90.length);
    await page.getByRole('button', { name: 'All' }).click();
    await pwExpect(page.locator('section[aria-label="Estimated 1RM"] .sr-only table tbody tr')).toHaveCount(l.sessions.length);
  }, 60_000);

  it('says so when there are no sessions, and draws no chart for a single one', async () => {
    const empty = await open(await lift({ id: BENCH }));
    await pwExpect(empty.frame.getByText('No sessions of this lift yet.')).toBeVisible();
    await pwExpect(empty.frame.locator('svg[role="img"]')).toHaveCount(0);
    await log(BENCH, -3, [[5, 60]]);
    const one = await open(await lift({ id: BENCH }));
    await pwExpect(one.frame.getByText('A line needs at least two sessions.')).toBeVisible();
    await pwExpect(one.frame.locator('svg[role="img"]')).toHaveCount(0);
    await pwExpect(one.frame.locator('section[aria-label="Last sessions"] tbody tr')).toHaveCount(1);
  }, 60_000);
});
