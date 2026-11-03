// Injuries and limitations (A11): saved only through the person's own tools, flagging exercises and ranking swaps around them, and never reaching friends. Health data: in the export, gone with the account.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { flagExercise, unflaggedFirst } from '../src/training/injuries';
import { deleteUser, type User } from '../src/data/users';
import { todayIn } from '../src/data/time';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const today = todayIn('Europe/Copenhagen');
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const OHP = 'ex:Standing_Military_Press'; // shoulders
const SQUAT = 'ex:Barbell_Squat'; // quadriceps
const CURL = 'ex:Barbell_Curl'; // biceps

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
});

const add = (args: Record<string, unknown> = {}, c: Client = client) => call(c, 'add_injury', { area: 'shoulder', note: 'Left shoulder pinches overhead', avoid: 'overhead pressing', ...args });
const profileInjuries = async (c: Client = client) => ((await call(c, 'get_profile')).data as unknown as { injuries: { id: string; area: string; note: string; until: string | null }[] }).injuries;
const search = async (query: string, extra: Record<string, unknown> = {}) => ((await call(client, 'search_exercises', { query, ...extra })).data as unknown as { exercises: { ref: string; name: string; injuryFlags?: { area: string; why: string }[] }[] }).exercises;

describe('the pure rules', () => {
  const injuries = [{ area: 'shoulder' as const, avoid: 'overhead pressing, deep squats' }];
  it('flags what loads the area and what the person said to avoid, with why, and nothing else', () => {
    expect(flagExercise({ name: 'Barbell Curl', primary: ['biceps'] }, injuries)).toEqual([]);
    expect(flagExercise({ name: 'Dumbbell Fly', primary: ['chest'] }, injuries)).toEqual([{ area: 'shoulder', why: 'loads the shoulder' }]);
    expect(flagExercise({ name: 'Overhead Pressing Machine', primary: ['triceps'] }, injuries)).toEqual([{ area: 'shoulder', why: 'you said to avoid "overhead pressing"' }]);
    expect(flagExercise({ name: 'Anything', primary: ['shoulders'] }, [{ area: 'other', avoid: '' }])).toEqual([]); // "other" has no muscles
    expect(flagExercise({ name: 'Anything', primary: ['shoulders'] }, [{ area: 'other', avoid: 'a' }])).toEqual([]); // a stray letter matches nothing
  });
  it('puts what is not flagged first and keeps the order within each part', () => {
    const list = [{ name: 'A', primary: ['chest'] }, { name: 'B', primary: ['biceps'] }, { name: 'C', primary: ['shoulders'] }, { name: 'D', primary: ['calves'] }];
    expect(unflaggedFirst(list, injuries).map((e) => e.name)).toEqual(['B', 'D', 'A', 'C']);
    expect(unflaggedFirst(list, []).map((e) => e.name)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('saving and ending', () => {
  it('is empty until the person says something, then shows in get_profile with their words', async () => {
    expect(await profileInjuries()).toEqual([]);
    expect((await add()).isError).toBe(false);
    expect(await profileInjuries()).toMatchObject([{ area: 'shoulder', note: 'Left shoulder pinches overhead', until: null }]);
  });

  it('keeps their words as plain text and refuses an end day before the start', async () => {
    await add({ note: '<b>Sore</b> see https://evil.example/x\nnow', avoid: '' });
    expect((await profileInjuries())[0]!.note).toBe('Sore see now');
    expect((await add({ since: '2026-05-10', until: '2026-05-01' })).isError).toBe(true);
    expect((await call(client, 'add_injury', { area: 'spleen', note: '' })).isError).toBe(true); // a fixed list of areas
    expect(await profileInjuries()).toHaveLength(1);
  });

  it('an end day in the past stops it applying; one in the future keeps it going', async () => {
    await add({ until: addDays(today, -1) });
    expect(await profileInjuries()).toEqual([]);
    await add({ until: addDays(today, 10) });
    expect(await profileInjuries()).toHaveLength(1);
  });

  it('ending one stops its flags from today, keeps it in the export, and refuses someone else\'s or an unknown one', async () => {
    await add();
    const id = (await profileInjuries())[0]!.id;
    expect((await search('military press')).find((e) => e.ref === OHP)?.injuryFlags).toBeTruthy();
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    expect((await call(bo, 'end_injury', { id })).isError).toBe(true); // Ana's, not Bo's
    expect((await call(client, 'end_injury', { id: crypto.randomUUID() })).isError).toBe(true);
    expect((await call(client, 'end_injury', { id })).isError).toBe(false);
    expect(await profileInjuries()).toEqual([]);
    expect((await search('military press')).find((e) => e.ref === OHP)?.injuryFlags).toBeUndefined();
    expect(((await call(client, 'export_my_data')).data as { injuries: unknown[] }).injuries).toHaveLength(1);
  });

  it('delete_item removes it for good, and only the owner\'s', async () => {
    await add();
    const id = (await profileInjuries())[0]!.id;
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    expect((await call(bo, 'delete_item', { kind: 'injury', id })).isError).toBe(true);
    expect((await call(client, 'delete_item', { kind: 'injury', id })).isError).toBe(false);
    expect(((await call(client, 'export_my_data')).data as { injuries: unknown[] }).injuries).toEqual([]);
  });
});

describe('flags and swaps', () => {
  it('search_exercises flags exercises that load the area and says why; with no injury nothing is flagged', async () => {
    expect((await search('military press')).every((e) => !e.injuryFlags)).toBe(true);
    await add();
    const hits = await search('military press');
    expect(hits.find((e) => e.ref === OHP)?.injuryFlags).toEqual([{ area: 'shoulder', why: expect.stringMatching(/loads the shoulder|avoid/) }]);
    expect((await search('barbell curl')).find((e) => e.ref === CURL)?.injuryFlags).toBeUndefined();
  });

  it('substitutes put exercises that do not load the area first', async () => {
    await add({ area: 'knee', note: 'Right knee hurts on stairs', avoid: '' });
    const subs = ((await call(client, 'search_exercises', { similar_to: SQUAT, limit: 15 })).data as unknown as { exercises: { name: string; injuryFlags?: unknown[] }[] }).exercises;
    expect(subs.length).toBeGreaterThan(3);
    const firstFlagged = subs.findIndex((e) => e.injuryFlags);
    if (firstFlagged >= 0) expect(subs.slice(firstFlagged).every((e) => e.injuryFlags)).toBe(true); // once flagged ones start, no clear one follows
  });

  it('start_workout flags the exercises in its answer so Claude can say so and offer a swap, and still opens the workout', async () => {
    await add();
    const r = await call(client, 'start_workout', { name: 'Push', exercises: [{ id: OHP, sets: 3, reps: 8 }, { id: CURL, sets: 3, reps: 10 }] });
    expect(r.isError).toBe(false);
    expect((r.data as { injuryFlags: { exercise: string; why: string }[] }).injuryFlags).toMatchObject([{ exercise: expect.stringMatching(/press/i) }]);
    expect(r.text).toMatch(/swap/);
    expect(r.text).toMatch(/do not diagnose/);
  });

  it('save_workout_template and list_workout_templates flag them too', async () => {
    await add();
    const saved = await call(client, 'save_workout_template', { name: 'Push day', exercises: [{ id: OHP, sets: 3, reps: 8 }] });
    expect((saved.data as { injuryFlags: unknown[] }).injuryFlags).toHaveLength(1);
    expect(((await call(client, 'list_workout_templates')).data as { templates: { injuryFlags?: unknown[] }[] }).templates[0]!.injuryFlags).toHaveLength(1);
  });
});

describe('who can see it', () => {
  it('is not in a friend\'s view, a sent item, the crew feed or a card: it is read only by the person\'s own tools', async () => {
    const bo = await signedInUser(env, 'bo@example.com');
    const boC = await connectAs(env, bo);
    await call(client, 'request_friend', { email: 'bo@example.com' });
    const incoming = ((await call(boC, 'list_friends')).data as { incoming: { connectionId: string }[] }).incoming[0]!.connectionId;
    await call(boC, 'accept_friend', { connection_id: incoming });
    await add({ note: 'secret knee story' });
    for (const [c, tool] of [[boC, 'list_friends'], [boC, 'show_crew_feed'], [boC, 'list_received_items'], [boC, 'get_profile']] as const) {
      const r = await call(c, tool);
      expect(JSON.stringify(r.data) + r.text, tool).not.toMatch(/secret knee|shoulder/i);
    }
    expect(await profileInjuries(boC)).toEqual([]); // Bo's own list, which is empty
  });

  it('is in the export and deleted with the account', async () => {
    await add();
    expect(((await call(client, 'export_my_data')).data as { injuries: { area: string }[] }).injuries).toMatchObject([{ area: 'shoulder' }]);
    await deleteUser(env.DB, ana);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM injuries').first<{ n: number }>())!.n).toBe(0);
  });
});
