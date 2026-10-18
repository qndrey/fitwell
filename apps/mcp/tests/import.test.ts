// Importing a backup file from the (retired) web app: the one-time link, the chunked upload the page performs, and what lands.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { User } from '../src/data/users';
import { createTestEnv, ctx } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { backupSchema } from './support/webBackup';

const T = 1_760_000_000_000;
const base = (id: string, extra: Record<string, unknown> = {}) => ({ id, createdAt: T, updatedAt: T, rev: 1, ...extra });
const rye = { ref: { kind: 'bundled', id: 'frida:413' }, name: 'Rye bread, light', group: 'Bread', per100g: { kcal: 209, protein: 5.8, carbs: 40.2, fat: 1.2 }, portions: [] };
const oats = { ref: { kind: 'custom', id: 'cf1' }, name: 'Protein oats', per100g: { kcal: 380, protein: 25, carbs: 50, fat: 7 }, portions: [{ label: 'bowl', grams: 80 }] };
const skyr = { ref: { kind: 'off', id: '5701234567892' }, name: 'Skyr Natural', brand: 'Arla', per100g: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }, portions: [] };

/** A backup the way the web app writes it, including the records an importer has to cope with. */
function makeBackup() {
  const entry = (id: string, extra: Record<string, unknown>) => base(id, { day: '2026-10-12', slot: 'breakfast', state: 'resolved', quantity: { amount: 100, unit: 'g' }, ...extra });
  return {
    app: 'fitwell',
    schemaVersion: 1,
    exportedAt: T,
    installId: 'test-install',
    data: {
      settings: { id: 'settings', units: 'imperial', theme: 'system', habitOnly: false, hideBodyTracking: false, fallbackWeightKg: 82, backupReminderDays: 14, updatedAt: T },
      goals: { id: 'goals', kcal: 2300, proteinG: 150, workoutsPerWeek: 3, goalWeightKg: 78, updatedAt: T },
      customFoods: [base('cf1', { name: 'Protein oats', per100g: oats.per100g, portions: oats.portions })],
      foodEntries: [
        entry('e1', { food: rye, grams: 150, nutrition: { kcal: 313.5, protein: 8.7, carbs: 60.3, fat: 1.8 } }),
        entry('e2', { food: oats, quantity: { amount: 2, unit: 'portion', portionLabel: 'bowl' }, nutrition: { kcal: 608, protein: 40, carbs: 80, fat: 11.2 } }), // 2 bowls of 80 g
        entry('e3', { slot: 'lunch', food: skyr, quantity: { amount: 200, unit: 'g' }, grams: 200, nutrition: { kcal: 126, protein: 22, carbs: 8, fat: 0.4 } }),
        entry('e4', { state: 'pending', queryText: 'something with rice', quantity: { amount: 0, unit: 'g' } }),
        entry('e5', { food: rye, grams: 50, nutrition: { kcal: 100, protein: 3, carbs: 20, fat: 1 }, deletedAt: T + 1 }),
        entry('e6', { food: { ...rye, per100g: { kcal: 200, protein: 5, carbs: 40, fat: 1 } }, quantity: { amount: 1, unit: 'portion', portionLabel: 'a slice' }, nutrition: { kcal: 100, protein: 2.5, carbs: 20, fat: 0.5 } }), // 50 g, from calories
        entry('e7', { food: { ...rye, per100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 } }, quantity: { amount: 1, unit: 'portion', portionLabel: 'a slice' }, nutrition: { kcal: 0, protein: 0, carbs: 0, fat: 0 } }), // no way to know the weight
      ],
      workouts: [
        base('w1', {
          day: '2026-10-10',
          type: 'strength',
          name: 'Legs',
          startedAt: T - 3_000_000,
          exercises: [{ uid: 'u1', exerciseRef: 'ex:Barbell_Squat', exerciseName: 'Barbell Squat', sets: [1, 2, 3].map((n) => ({ id: `s${n}`, type: 'working', reps: 5, weightKg: 100, done: true })) }],
        }),
        base('w2', { day: '2026-10-11', type: 'cardio', cardio: { activityRef: 'act:run-10', activityName: 'Running, about 10 km/h', met: 9.8, durationMin: 30, distanceKm: 5, kcalEstimated: 392 } }),
        base('w3', { day: '2026-10-09', type: 'strength', exercises: [], deletedAt: T + 1 }),
      ],
      workoutTemplates: [
        base('t1', { name: 'Push day', type: 'strength', exercises: [{ exerciseRef: 'ex:Barbell_Bench_Press_-_Medium_Grip', exerciseName: 'Bench', sets: [1, 2, 3].map(() => ({ type: 'working', reps: 8, weightKg: 60 })) }] }),
        base('t2', { name: 'My own', type: 'strength', exercises: [{ exerciseRef: 'cx:abc', exerciseName: 'Odd lift', sets: [{ type: 'working', reps: 8, weightKg: 20 }] }] }),
        base('t3', { name: 'Run', type: 'cardio', cardio: { activityRef: 'act:run-10', activityName: 'Running', met: 9.8, durationMin: 30 } }),
      ],
      weightEntries: [base('x1', { day: '2026-10-01', kg: 83 }), base('x2', { day: '2026-10-07', kg: 81.8 }), base('x3', { day: '2026-10-13', kg: 80.6 })],
      measurementTypes: [],
      measurementEntries: [base('m1', { day: '2026-10-13', values: { 'mt:waist': 84.5, 'mt:hips': 99, 'mt:body-fat': 21, 'mc:custom-thing': 40 } })],
    },
  };
}

it('the fixture is a valid backup of the web app (so the importer is tested against the real format)', () => {
  expect(() => backupSchema.parse(makeBackup())).not.toThrow();
});

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
});

const req = (url: string, init?: RequestInit) => worker.fetch(new Request(url, init), env, ctx);
const post = (url: string, path: string, body: unknown) => {
  const u = new URL(url);
  return req(`${u.origin}${path}${u.search}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
};
const linkOf = async (c = client) => (await call(c, 'import_fitwell_backup', {})).data.url as string;

/** What the page's script does: kinds in order, 150 records at a time, then finish. */
async function upload(url: string, backup = makeBackup(), chunk = 150) {
  const order = ['settings', 'goals', 'customFoods', 'weightEntries', 'measurementEntries', 'workouts', 'workoutTemplates', 'foodEntries'] as const;
  const data = backup.data as unknown as Record<string, unknown>;
  for (const kind of order) {
    const all = kind === 'settings' || kind === 'goals' ? (data[kind] ? [data[kind]] : []) : ((data[kind] as unknown[]) ?? []);
    for (let i = 0; i < all.length; i += chunk) {
      const res = await post(url, '/import/chunk', { kind, records: all.slice(i, i + chunk) });
      expect(res.status, `${kind} chunk`).toBe(200);
    }
  }
  const done = await post(url, '/import/finish', {});
  expect(done.status).toBe(200);
  return ((await done.json()) as { lines: string[] }).lines;
}

describe('the link', () => {
  it('opens the upload page, and refuses a wrong token, an expired link and a second use', async () => {
    const url = await linkOf();
    expect(url).toMatch(/^https:\/\/mcp\.fitwell\.test\/import\?l=[0-9a-f-]{36}&t=[\w-]{40,}$/);
    const page = await req(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Import a Fitwell backup');
    expect((await req(url.replace(/t=.{6}/, 't=AAAAAA'))).status).toBe(400);
    expect((await post(url.replace(/t=.{6}/, 't=AAAAAA'), '/import/chunk', { kind: 'weightEntries', records: [] })).status).toBe(401);

    await upload(url, { ...makeBackup(), data: {} } as ReturnType<typeof makeBackup>);
    expect((await req(url)).status).toBe(400); // finished: used up
    expect((await post(url, '/import/chunk', { kind: 'weightEntries', records: [] })).status).toBe(401);

    const second = await linkOf();
    await env.DB.prepare('UPDATE import_links SET expires_at = ? WHERE finished_at IS NULL').bind(Date.now() - 1).run();
    expect((await req(second)).status).toBe(400);
  });

  it('a new link replaces the earlier unfinished one', async () => {
    const first = await linkOf();
    const second = await linkOf();
    expect((await req(first)).status).toBe(400);
    expect((await req(second)).status).toBe(200);
  });

  it('refuses bad requests: unknown kind, oversized chunk, wrong content type, not JSON', async () => {
    const url = await linkOf();
    expect((await post(url, '/import/chunk', { kind: 'users', records: [] })).status).toBe(400);
    expect((await post(url, '/import/chunk', { kind: 'workouts', records: new Array(251).fill({}) })).status).toBe(400);
    const u = new URL(url);
    expect((await req(`${u.origin}/import/chunk${u.search}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await req(`${u.origin}/import/chunk${u.search}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'nope' })).status).toBe(400);
    expect((await req(`${u.origin}/import/finish${u.search}`, { method: 'PUT' })).status).toBe(405);
  });

  it('only people who are signed in can make a link, and it belongs to them', async () => {
    const bo = await signedInUser(env, 'bo@example.com');
    const boClient = await connectAs(env, bo);
    const url = await linkOf(boClient);
    await upload(url);
    expect(((await call(boClient, 'get_food_log', { day: '2026-10-12' })).data.entries as unknown[]).length).toBe(4);
    expect(((await call(client, 'get_food_log', { day: '2026-10-12' })).data.entries as unknown[]).length).toBe(0); // Ana got nothing
    expect((await call(client, 'import_fitwell_backup', { check_result: true })).isError).toBe(true);
  });
});

describe('what an import brings in', () => {
  it('imports food entries with grams from the file, from portions, or from calories, and reports what it skipped', async () => {
    const lines = await upload(await linkOf());
    const day = (await call(client, 'get_food_log', { day: '2026-10-12' })).data as { entries: { food: string; grams: number; kcal: number; slot: string; foodId?: string; brand?: string }[]; totals: { kcal: number } };
    const by = (grams: number) => day.entries.find((e) => e.grams === grams)!;
    expect(by(150)).toMatchObject({ food: 'Rye bread, light', kcal: 314, slot: 'breakfast', foodId: 'frida:413' });
    expect(by(160)).toMatchObject({ food: 'Protein oats', kcal: 608 }); // 2 bowls of 80 g
    expect(by(160).foodId).toMatch(/^custom:/);
    expect(by(200)).toMatchObject({ food: 'Skyr Natural', brand: 'Arla', foodId: 'off:5701234567892', slot: 'lunch' });
    expect(day.entries.length).toBe(4); // e1, e2, e3 and the slice of e6 (50 g worked back from 100 kcal at 200 kcal/100 g)
    expect(day.entries.find((e) => e.grams === 50)).toMatchObject({ kcal: 100 });
    expect(lines.find((l) => l.startsWith('food entries'))).toBe('food entries: 4 added, 1 still waiting for a lookup, 1 deleted in the app, 1 no weight could be worked out');
  });

  it('imports workouts so history, progression, records and the dashboard see them', async () => {
    await upload(await linkOf());
    const hist = (await call(client, 'get_workout_history', { days: 30, to: '2026-10-13' })).data.workouts as { type: string; day: string; name?: string; finished?: boolean; minutes?: number; activity?: string }[];
    expect(hist.map((w) => `${w.day} ${w.type}`)).toEqual(['2026-10-11 cardio', '2026-10-10 strength']);
    expect(hist[1]).toMatchObject({ name: 'Legs', finished: true });
    expect(hist[0]).toMatchObject({ activity: 'Running, about 10 km/h', minutes: 30 });
    const next = (await call(client, 'suggest_progression', { exercise_ids: ['ex:Barbell_Squat'] })).data.exercises as { lastTime: string; next: { action: string; weightKg: number } }[];
    expect(next[0]).toMatchObject({ lastTime: '3×5 @ 100 kg', next: { action: 'increase', weightKg: 102.5 } });
    const p = (await call(client, 'get_progress', { days: 30, to: '2026-10-13' })).data as { training: { sessions: { strength: number; cardio: number } }; records: { name: string; bestE1rmKg: number }[] };
    expect(p.training.sessions).toEqual({ strength: 1, cardio: 1 });
    expect(p.records[0]).toMatchObject({ name: 'Barbell Squat', bestE1rmKg: 116.7 });
  });

  it('imports weigh-ins, measurements (own types skipped), templates, own foods and goals', async () => {
    const lines = await upload(await linkOf());
    const p = (await call(client, 'get_progress', { days: 30, to: '2026-10-13' })).data as { weight: { latestKg: number; weighIns: number; goalKg: number }; measurements: { key: string; latest: number }[] };
    expect(p.weight).toMatchObject({ latestKg: 80.6, weighIns: 3, goalKg: 78 });
    expect(Object.fromEntries(p.measurements.map((m) => [m.key, m.latest]))).toEqual({ waist: 84.5, hips: 99, 'body-fat': 21 });
    const templates = (await call(client, 'list_workout_templates', {})).data.templates as { name: string; exercises: string[] }[];
    expect(templates).toEqual([expect.objectContaining({ name: 'Push day', exercises: ['Barbell Bench Press - Medium Grip 3×8 @ 60 kg'] })]);
    const found = (await call(client, 'search_foods', { query: 'protein oats' })).data.foods as { id: string; source: string }[];
    expect(found[0]).toMatchObject({ source: 'custom' });
    const profile = (await call(client, 'get_profile', {})).data as { profile: { units: string; weightKg: number }; goals: { kcal: number; proteinG: number; workoutsPerWeek: number } };
    expect(profile.profile).toMatchObject({ units: 'imperial', weightKg: 80.6 }); // the newest weigh-in, not the app's fallback weight
    expect(profile.goals).toMatchObject({ kcal: 2300, proteinG: 150, workoutsPerWeek: 3 });
    expect(lines).toEqual(expect.arrayContaining(['measurement sets: 1 added, 1 your own measurement types', 'workout templates: 1 added, 1 with your own or timed exercises, 1 cardio templates', 'weigh-ins: 3 added']));
  });

  it('can be repeated without adding anything twice, and never overwrites what the person already has', async () => {
    // Already in the account before the import: a weigh-in on the same day, a waist measurement, a calorie goal.
    await call(client, 'log_body', { weight_kg: 79.9, day: '2026-10-13' });
    await call(client, 'log_body', { measurements: { waist: 85 }, day: '2026-10-13' });
    await call(client, 'set_goals', { kcal: 2000 });

    await upload(await linkOf());
    const once = (await call(client, 'export_my_data', {})).data as { foodEntries: unknown[]; workouts: unknown[]; weights: { day: string; kg: number }[]; measurements: { values: Record<string, number> }[]; goals: { kcal: number; proteinG: number } };
    expect(once.weights.find((w) => w.day === '2026-10-13')!.kg).toBe(79.9); // kept
    expect(once.weights.length).toBe(3);
    expect(once.measurements[0]!.values).toMatchObject({ waist: 85, hips: 99, 'body-fat': 21 }); // waist kept, the others filled in
    expect(once.goals).toMatchObject({ kcal: 2000, proteinG: 150 }); // kcal kept, protein filled in

    const lines = await upload(await linkOf());
    const twice = (await call(client, 'export_my_data', {})).data as typeof once;
    expect(twice.foodEntries.length).toBe(once.foodEntries.length);
    expect(twice.workouts.length).toBe(once.workouts.length);
    expect(lines.find((l) => l.startsWith('food entries'))).toContain('0 added, 4 already there');
    expect(lines.find((l) => l.startsWith('workouts'))).toContain('0 added, 2 already there');
  });

  it('works in small chunks and reports through check_result', async () => {
    await upload(await linkOf(), makeBackup(), 2);
    const last = (await call(client, 'import_fitwell_backup', { check_result: true })).data as { summary: string[]; finishedAt: string };
    expect(last.summary.find((l) => l.startsWith('food entries'))).toContain('4 added');
    expect(new Date(last.finishedAt).getTime()).toBeGreaterThan(0);
  });

  it('skips records it cannot read instead of failing the whole import', async () => {
    const backup = makeBackup();
    const data = backup.data as unknown as Record<string, unknown[]>;
    data.weightEntries!.push({ id: 'bad', day: 'yesterday', kg: 80 }, 'junk', null, { id: 'bad2', day: '2026-10-02', kg: 5000 });
    data.workouts!.push({ id: 'bw', day: '2026-10-08', type: 'strength', exercises: [{ exerciseRef: 'ex:x' }] });
    const lines = await upload(await linkOf(), backup);
    expect(lines.find((l) => l.startsWith('weigh-ins'))).toBe('weigh-ins: 3 added, 4 not readable');
    expect(lines.find((l) => l.startsWith('workouts'))).toBe('workouts: 2 added, 1 deleted in the app, 1 not readable');
  });
});

describe('privacy', () => {
  it('two people importing the same file each get all of it', async () => {
    const boClient = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    await upload(await linkOf());
    const lines = await upload(await linkOf(boClient));
    expect(lines.find((l) => l.startsWith('food entries'))).toContain('4 added');
    for (const c of [client, boClient]) {
      const e = (await call(c, 'export_my_data', {})).data as { foodEntries: unknown[]; workouts: unknown[]; customFoods: unknown[] };
      expect([e.foodEntries.length, e.workouts.length, e.customFoods.length]).toEqual([4, 2, 1]);
    }
  });


  it('imports are erased with the account', async () => {
    await upload(await linkOf());
    await call(client, 'delete_my_account', { confirm: 'delete my account' });
    const left = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM food_entries) + (SELECT COUNT(*) FROM workouts) + (SELECT COUNT(*) FROM weights) + (SELECT COUNT(*) FROM measurements) + (SELECT COUNT(*) FROM custom_foods) + (SELECT COUNT(*) FROM workout_templates) + (SELECT COUNT(*) FROM import_links) AS n').first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
