// show_celebration (F3): which milestones are shown, once each, what they say, and the view that draws them.
import { addDays } from '@fitwell/core/domain/dates';
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toCelebrate } from '../src/analytics/celebrate';
import type { Celebration } from '../src/analytics/celebrationTypes';
import type { Achievement } from '../src/data/achievements';
import { todayIn } from '../src/data/time';
import type { User } from '../src/data/users';
import celebrationHtml from '../src/ui/generated/celebration';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView } from './support/viewHost';

const today = todayIn('Europe/Copenhagen');
const a = (kind: Achievement['kind'], threshold: number, back: number): Achievement => ({ kind, threshold, achievedAt: addDays(today, -back), celebratedAt: null });

describe('toCelebrate', () => {
  it('picks the highest recent milestone of each streak, skips old and future ones, in a fixed order', () => {
    const unseen = [a('logging_days', 3, 0), a('logging_days', 7, 1), a('logging_days', 5, 3), a('training_weeks', 2, 6), a('protein_days', 30, 7), a('goal_weight', 1, 0), a('logging_weeks', 1, -1)];
    expect(toCelebrate(unseen, today).map((x) => `${x.kind}:${x.threshold}`)).toEqual(['goal_weight:1', 'training_weeks:2', 'logging_days:7']);
    expect(toCelebrate([], today)).toEqual([]);
  });
});

describe('show_celebration', () => {
  let env: Env;
  let ana: User;
  let client: Client;
  beforeEach(async () => {
    env = createTestEnv().env;
    ana = await signedInUser(env, 'ana@example.com');
    client = await connectAs(env, ana);
  });
  const logFood = (day: string) => call(client, 'log_food', { day, items: [{ food_id: 'frida:59', grams: 300 }] });
  const celebrations = (r: Awaited<ReturnType<typeof call>>) => (r.data as unknown as { celebrations: Celebration[] }).celebrations;
  const seen = async () => (await env.DB.prepare('SELECT kind, threshold, celebrated_at FROM achievements WHERE user_id = ? ORDER BY kind, threshold').bind(ana.id).all<{ kind: string; threshold: number; celebrated_at: number | null }>()).results;

  it('has nothing to say for a new account', async () => {
    const r = await call(client, 'show_celebration');
    expect(r.text).toBe('Nothing new to celebrate right now.');
    expect(celebrations(r)).toEqual([]);
  });

  it('shows the highest new milestone with what it took and what is next, then marks all seen, once', async () => {
    for (const back of [2, 1, 0]) await logFood(addDays(today, -back));
    const r = await call(client, 'show_celebration');
    expect(r.text).toContain('3 days of logging');
    expect(celebrations(r)).toEqual([
      {
        kind: 'logging_days', threshold: 3, achievedAt: today, title: '3 days of logging', detail: 'Food logged every day', atLeast: false, goalKg: null,
        took: [{ label: 'Days logged', value: 3 }, { label: 'Entries', value: 3 }], next: { threshold: 5, remaining: 2, unit: 'day' },
      },
    ]);
    // Milestones 1 and 2 are marked seen too, without a view of their own.
    expect((await seen()).map((s) => s.celebrated_at !== null)).toEqual([true, true, true]);
    expect(celebrations(await call(client, 'show_celebration'))).toEqual([]);
  });

  it('marks an old milestone seen without showing it', async () => {
    await env.DB.prepare("INSERT INTO achievements (user_id, kind, threshold, achieved_at) VALUES (?, 'training_weeks', 7, ?)").bind(ana.id, addDays(today, -40)).run();
    expect(celebrations(await call(client, 'show_celebration'))).toEqual([]);
    expect((await seen())[0]!.celebrated_at).not.toBeNull();
  });

  it('says what training took, in the person\'s own workouts', async () => {
    await call(client, 'update_profile', { weight_kg: 80 });
    await call(client, 'set_goals', { workouts_per_week: 1 });
    const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
    // A workout last week and one today: two weeks in a row, the second met today.
    for (const day of [addDays(monday, -7), today]) await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day });
    const [c] = celebrations(await call(client, 'show_celebration'));
    expect(c).toMatchObject({ kind: 'training_weeks', threshold: 2, title: '2 weeks of training', detail: '1 workout or more each week', took: [{ label: 'Workouts', value: 2 }], next: { threshold: 3, remaining: 1, unit: 'week' } });
  });

  it('keeps clear of review words in everything it says', async () => {
    for (const back of [0, 1, 2, 3, 4, 5, 6]) await logFood(addDays(today, -back));
    const text = JSON.stringify(await call(client, 'show_celebration'));
    expect(text).not.toMatch(/cheat|guilty|bad|lazy|behind|off track|missed|failed|healthy|great|only|stalled|should|must|need to|broke|lost/);
  });
});

describe('the milestone view', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);
  const result = (celebrations: Celebration[]) => ({ content: [{ type: 'text', text: 'open' }], structuredContent: { celebrations } });
  const week: Celebration = { kind: 'training_weeks', threshold: 7, achievedAt: '2026-10-20', title: '7 weeks of training', detail: '3 workouts or more each week', atLeast: false, goalKg: null, took: [{ label: 'Workouts', value: 21 }, { label: 'Sets', value: 310 }], next: { threshold: 14, remaining: 7, unit: 'week' } };

  it('shows the number, what it took and what is next', async () => {
    const v = await openView(celebrationHtml, result([week]));
    await pwExpect(v.frame.getByRole('heading', { name: '7 weeks of training' })).toBeVisible();
    await pwExpect(v.frame.getByText('3 workouts or more each week')).toBeVisible();
    await pwExpect(v.frame.getByText('Workouts', { exact: true })).toBeVisible();
    await pwExpect(v.frame.getByText('21', { exact: true })).toBeVisible();
    await pwExpect(v.frame.getByText('Next: 14 weeks, 7 weeks to go.')).toBeVisible();
  }, 30_000);

  it('says "at least" for a run that reaches the first day Fitwell looked at', async () => {
    const v = await openView(celebrationHtml, result([{ ...week, atLeast: true }]));
    await pwExpect(v.frame.getByRole('heading', { name: 'At least 7 weeks of training' })).toBeVisible();
    await pwExpect(v.frame.getByText(/may be higher/)).toBeVisible();
  }, 30_000);

  it('draws the goal weight as a tick, with no weight on it', async () => {
    const goal: Celebration = { kind: 'goal_weight', threshold: 1, achievedAt: '2026-10-20', title: 'Goal weight reached', detail: 'Seven days in a row at your goal, by the trend', atLeast: false, goalKg: 75, took: [], next: null };
    const v = await openView(celebrationHtml, result([goal]));
    await pwExpect(v.frame.getByRole('heading', { name: 'Goal weight reached' })).toBeVisible();
    expect(await v.frame.locator('body').innerText()).not.toMatch(/\bkg\b/);
  }, 30_000);

  it('says so when there is nothing new', async () => {
    const v = await openView(celebrationHtml, result([]));
    await pwExpect(v.frame.getByText('No new milestone right now.')).toBeVisible();
  }, 30_000);

  it('animates the ring, but not for a person who prefers reduced motion', async () => {
    const animation = (v: Awaited<ReturnType<typeof openView>>, selector: string) =>
      v.frame.locator(selector).evaluate((el) => (globalThis as unknown as { getComputedStyle(e: unknown): { animationName: string } }).getComputedStyle(el).animationName);
    const animated = await openView(celebrationHtml, result([week]));
    await pwExpect(animated.frame.locator('.ring')).toBeVisible();
    expect(await animation(animated, '.ring')).toBe('draw');
    const still = await openView(celebrationHtml, result([week]));
    await still.page.emulateMedia({ reducedMotion: 'reduce' });
    await pwExpect(still.frame.locator('.ring')).toBeVisible();
    expect(await animation(still, '.ring')).toBe('none');
    expect(await animation(still, '.badge-number')).toBe('none');
  }, 30_000);
});
