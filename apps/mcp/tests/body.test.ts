import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Progress } from '../src/analytics/types';
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

const TO = '2026-10-13';
/** 83.0 down to 80.6 over two weeks, every other day. */
async function logWeights() {
  const rows: [string, number][] = [['2026-10-01', 83], ['2026-10-03', 82.6], ['2026-10-05', 82.2], ['2026-10-07', 81.8], ['2026-10-09', 81.4], ['2026-10-11', 81], ['2026-10-13', 80.6]];
  for (const [day, kg] of rows) await call(client, 'log_body', { weight_kg: kg, day });
}

describe('weight', () => {
  it('replaces a weigh-in on the same day, and only the latest one updates the profile weight', async () => {
    await call(client, 'log_body', { weight_kg: 80, day: '2026-10-10' });
    await call(client, 'log_body', { weight_kg: 81, day: '2026-10-10' });
    expect(((await call(client, 'get_profile', {})).data.profile as { weightKg: number }).weightKg).toBe(81);
    await call(client, 'log_body', { weight_kg: 79, day: '2026-10-12' });
    await call(client, 'log_body', { weight_kg: 90, day: '2026-10-01' }); // an old weigh-in, entered late
    expect(((await call(client, 'get_profile', {})).data.profile as { weightKg: number }).weightKg).toBe(79);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM weights WHERE user_id = ?').bind(ana.id).first<{ n: number }>();
    expect(rows!.n).toBe(3);
  });

  it('reports the 7-day average, not the raw reading, once there are enough weigh-ins', async () => {
    await logWeights();
    const last = await call(client, 'log_body', { weight_kg: 80.6, day: TO });
    expect(last.data).toMatchObject({ logged: { day: TO, weightKg: 80.6, sevenDayAverageKg: 81.2 } });
    const p = (await call(client, 'get_progress', { days: 30, to: TO })).data as { weight: { latestKg: number; trendChangeKg: number; weighIns: number } };
    // Average of 10-07..10-13 = (81.8 + 81.4 + 81 + 80.6) / 4 = 81.2; first average (10-05) = 82.6.
    expect(p.weight).toMatchObject({ latestKg: 80.6, weighIns: 7, trendChangeKg: -1.4 });
  });

  it('says a trend needs more weigh-ins, and validates the weight', async () => {
    const first = await call(client, 'log_body', { weight_kg: 80, day: TO });
    const logged = first.data.logged as { sevenDayAverageKg: number | null; note: string };
    expect(logged.sevenDayAverageKg).toBeNull();
    expect(logged.note).toContain('3 weigh-ins');
    expect((await call(client, 'log_body', { weight_kg: 8 })).isError).toBe(true);
    expect((await call(client, 'log_body', { weight_kg: 80, day: '13-10-2026' })).isError).toBe(true);
  });

  it('deletes a weigh-in', async () => {
    await call(client, 'log_body', { weight_kg: 80, day: TO });
    expect((await call(client, 'delete_item', { kind: 'weigh_in', day: TO })).data.deleted).toEqual({ kind: 'weigh_in', day: TO });
    expect((await call(client, 'delete_item', { kind: 'weigh_in', day: TO })).isError).toBe(true);
  });
});

describe('measurements', () => {
  it('merges values logged on the same day and rejects unknown types and impossible body fat', async () => {
    await call(client, 'log_body', { measurements: { waist: 84 }, day: TO });
    const second = await call(client, 'log_body', { measurements: { hips: 99.5, waist: 83.5 }, day: TO });
    expect((second.data.logged as { measurements: unknown }).measurements).toEqual({ waist: 83.5, hips: 99.5 });
    expect((await call(client, 'log_body', { measurements: { wings: 30 } })).isError).toBe(true);
    expect((await call(client, 'log_body', { measurements: {} })).isError).toBe(true);
    expect((await call(client, 'log_body', { measurements: { 'body-fat': 120 } })).isError).toBe(true);
  });

  it('returns a body-fat trend once there are two readings in two weeks', async () => {
    const first = await call(client, 'log_body', { measurements: { 'body-fat': 22 }, day: '2026-10-01' });
    expect((first.data.logged as { bodyFat: { fourteenDayAveragePct: number | null; note?: string } }).bodyFat).toMatchObject({ percent: 22, fourteenDayAveragePct: null });
    const second = await call(client, 'log_body', { measurements: { 'body-fat': 21 }, day: '2026-10-08' });
    expect((second.data.logged as { bodyFat: unknown }).bodyFat).toMatchObject({ percent: 21, fourteenDayAveragePct: 21.5 });
  });

  it('shows first-to-latest change per type in the progress report', async () => {
    await call(client, 'log_body', { measurements: { waist: 86, 'body-fat': 22 }, day: '2026-09-20' });
    await call(client, 'log_body', { measurements: { waist: 84.5 }, day: TO });
    const p = (await call(client, 'get_progress', { days: 60, to: TO })).data as { measurements: { key: string; unit: string; first: number; latest: number; change: number }[] };
    expect(p.measurements.find((m) => m.key === 'waist')).toMatchObject({ unit: 'cm', first: 86, latest: 84.5, change: -1.5 });
    expect(p.measurements.find((m) => m.key === 'body-fat')).toMatchObject({ unit: '%', first: 22, latest: 22, change: 0 });
  });
});

describe('progress and dashboard', () => {
  it('averages nutrition per week and protein per kg of trend weight', async () => {
    // 1000 g rye bread = 2090 kcal, 58 g protein. Two logged days in the week of Monday 12 Oct, one in the next.
    for (const [day, grams] of [['2026-10-12', 1000], ['2026-10-14', 500], ['2026-10-20', 1000]] as const) await call(client, 'log_food', { day, items: [{ food_id: 'frida:413', grams }] });
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14']) await call(client, 'log_body', { day, weight_kg: 80 });
    const p = ((await call(client, 'get_dashboard_data', { days: 90 })).data as unknown as { progress: { nutrition: { weeks: { week: string; kcal: number; protein: number; daysLogged: number }[]; proteinPerKg: number | null } } }).progress.nutrition;
    expect(p.weeks).toEqual([{ week: '2026-10-12', kcal: 1568, protein: 43.5, daysLogged: 2 }, { week: '2026-10-19', kcal: 2090, protein: 58, daysLogged: 1 }]);
    expect(p.proteinPerKg).toBe(0.6); // (58 + 29 + 58) / 3 = 48.3 g a day over 80 kg
    const summary = (await call(client, 'get_progress', { days: 90 })).data as { nutrition: { proteinPerKg: number | null } };
    expect(summary.nutrition.proteinPerKg).toBe(0.6);
  });

  it('summarises food against goals, training and records', async () => {
    await call(client, 'set_goals', { kcal: 2000, protein_g: 100, workouts_per_week: 3 });
    // 100 g rye bread = 209 kcal, 5.8 g protein per 100 g. Three days around the calorie goal, one far off.
    for (const [day, grams] of [['2026-10-10', 950], ['2026-10-11', 1000], ['2026-10-12', 100], ['2026-10-13', 960]] as const) await call(client, 'log_food', { day, items: [{ food_id: 'frida:413', grams }] });
    const plan = (await call(client, 'start_workout', { exercises: [{ id: 'ex:Barbell_Squat', sets: 2, reps: 5, weight_kg: 80 }] })).data.workout as { workoutId: string };
    for (const setId of ['s1.1', 's1.2']) await call(client, 'log_set', { workoutId: plan.workoutId, setId, reps: 5, weightKg: 80 });
    await call(client, 'finish_workout', { workoutId: plan.workoutId });
    await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30 });

    const p = (await call(client, 'get_progress', { days: 30 })).data as {
      nutrition: { daysLogged: number; adherence: { kcalWithin10Pct: number; proteinReached: number; ofDays: number } };
      training: { sessions: { strength: number; cardio: number }; goalWorkoutsPerWeek: number; setsPerWeekByMuscle: { muscle: string; sets: number }[] };
      records: { name: string; bestE1rmKg: number }[];
    };
    expect(p.nutrition.daysLogged).toBe(4);
    // 950 g → 1986 kcal, 1000 g → 2090, 960 g → 2006: within 10 % of 2000; 100 g → 209: not.
    expect(p.nutrition.adherence).toMatchObject({ kcalWithin10Pct: 3, ofDays: 4 });
    expect(p.nutrition.adherence.proteinReached).toBe(0); // 55 g, 58 g, 5.8 g and 55.7 g are all under 90 % of the 100 g goal
    expect(p.training).toMatchObject({ sessions: { strength: 1, cardio: 1 }, goalWorkoutsPerWeek: 3 });
    expect(p.training.setsPerWeekByMuscle.find((m) => m.muscle === 'quadriceps')!.sets).toBeGreaterThan(0);
    expect(p.records[0]).toMatchObject({ name: 'Barbell Squat', bestE1rmKg: 93.3 });
  });

  it('opens the dashboard with the full series as structured data and a short text for the model', async () => {
    await logWeights();
    const { tools } = await client.listTools();
    const show = tools.find((t) => t.name === 'show_dashboard')!;
    expect((show._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe('ui://fitwell/dashboard.html');
    const app = tools.find((t) => t.name === 'get_dashboard_data')!;
    expect((app._meta as { ui?: { visibility?: string[] } }).ui?.visibility).toEqual(['app']);

    const res = await client.callTool({ name: 'show_dashboard', arguments: { days: 30 } });
    const progress = (res.structuredContent as { progress: Progress }).progress;
    expect(progress.days).toBe(30);
    expect(progress.weight.daily.length).toBe(7);
    expect(progress.weight.average.length).toBeGreaterThan(0);
    const text = (res.content as { text: string }[])[0]!.text;
    expect(text).toContain('dashboard is open');
    expect(text.length).toBeLessThan(2500); // the model gets a summary, not 30 days of points

    const res2 = await client.callTool({ name: 'get_dashboard_data', arguments: { days: 365 } });
    expect((res2.structuredContent as { progress: Progress }).progress.days).toBe(365);
  });

  it('serves the dashboard as a single self-contained MCP Apps HTML resource', async () => {
    const res = await client.readResource({ uri: 'ui://fitwell/dashboard.html' });
    const item = res.contents[0] as { mimeType?: string; text?: string };
    expect(item.mimeType).toBe('text/html;profile=mcp-app');
    expect(item.text).toMatch(/^<!doctype html>/i);
    expect(item.text).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet| style="/); // nothing external, no inline style attributes
  });

  it('handles a person with no data at all', async () => {
    const p = (await call(client, 'get_progress', { days: 30 })).data as { weight: { latestKg: null; weighIns: number }; nutrition: { daysLogged: number; averagePerLoggedDay: null }; records: unknown[] };
    expect(p.weight).toMatchObject({ latestKg: null, weighIns: 0 });
    expect(p.nutrition).toMatchObject({ daysLogged: 0, averagePerLoggedDay: null });
    expect(p.records).toEqual([]);
    const res = await client.callTool({ name: 'show_dashboard', arguments: {} });
    expect(res.isError).not.toBe(true);
  });
});

describe('privacy', () => {
  it('keeps weights and measurements per person, and exports and erases them', async () => {
    await logWeights();
    await call(client, 'log_body', { measurements: { waist: 84 }, day: TO });
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    const theirs = (await call(bo, 'get_progress', { days: 30, to: TO })).data as { weight: { weighIns: number }; measurements: unknown[] };
    expect(theirs.weight.weighIns).toBe(0);
    expect(theirs.measurements).toEqual([]);
    expect((await call(bo, 'delete_item', { kind: 'weigh_in', day: TO })).isError).toBe(true); // Bo has no weigh-in that day; Ana's is untouched
    expect(((await call(client, 'get_progress', { days: 30, to: TO })).data.weight as { weighIns: number }).weighIns).toBe(7);

    const exported = (await call(client, 'export_my_data', {})).data as { weights: unknown[]; measurements: unknown[] };
    expect(exported.weights.length).toBe(7);
    expect(exported.measurements.length).toBe(1);
    await call(client, 'delete_my_account', { confirm: 'delete my account' });
    const left = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM weights) + (SELECT COUNT(*) FROM measurements) AS n').first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
