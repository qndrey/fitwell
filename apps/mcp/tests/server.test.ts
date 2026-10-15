import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { offClient } from '../src/off';
import { createTestEnv, ctx } from './support/env';
import { call as callTool, connectAs, signedInUser } from './support/mcp';

let env: Env;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
});

/** Reference tools for a signed-in person; Open Food Facts goes through the real client (fetch is stubbed per test). */
async function connect() {
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'), offClient());
  return client;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => callTool(c, name, args);

afterEach(() => vi.unstubAllGlobals());

describe('fitwell MCP server', () => {
  it('asks for sign-in on /mcp (OAuth challenge pointing at the resource metadata)', async () => {
    const res = await worker.fetch(new Request('https://mcp.fitwell.test/mcp', { method: 'POST', body: '{}' }), env, ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  });

  it('serves the local dev shortcut only on localhost and only when switched on', async () => {
    const post = (url: string, e: Env) => worker.fetch(new Request(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }), e, ctx);
    const dev = createTestEnv({ DEV_UNAUTHENTICATED: 'true' }).env;
    expect((await post('https://mcp.fitwell.test/mcp', dev)).status).toBe(401);
    expect((await post('http://localhost/mcp', env)).status).toBe(401);
    expect((await post('http://localhost/mcp', dev)).status).not.toBe(401);
  });

  it('lists the reference tools with instructions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['log_set', 'lookup_barcode', 'search_exercises', 'search_foods', 'start_workout', 'log_food', 'get_profile']));
    const search = tools.find((t) => t.name === 'search_exercises')!;
    // Muscles and equipment are enums taken from the dataset, so Claude sees the valid values.
    expect(JSON.stringify(search.inputSchema)).toContain('quadriceps');
  });

  it('answers planning tools with the role to take, from the Markdown instructions', async () => {
    const client = await connect();
    const texts = async (name: string, args: Record<string, unknown> = {}) => ((await client.callTool({ name, arguments: args })).content as { text?: string }[]).map((c) => c.text ?? '');
    expect((await texts('list_workout_templates')).at(-1)).toContain('personal trainer');
    expect((await texts('get_planning_context')).at(-1)).toContain('nutritionist');
    expect((await texts('get_progress')).at(-1)).toContain('reviewing progress');
    // Everything else answers with its result only, and the tool descriptions stay as they were (the list has a size budget).
    expect((await texts('get_profile')).join('\n')).not.toContain('Role for this tool');
    const { tools } = await client.listTools();
    expect(tools.some((t) => t.description?.includes('Role for this tool'))).toBe(false);
    expect(client.getInstructions()).toContain('Fitwell tracks food');
  });

  it('finds Frida foods with macros per 100 g and attribution, without going online', async () => {
    const offFetch = vi.fn();
    vi.stubGlobal('fetch', offFetch);
    const client = await connect();
    const { data, isError } = await call(client, 'search_foods', { query: 'oats' });
    expect(isError).toBe(false);
    const foods = data.foods as { id: string; source: string; per100g: { kcal: number } }[];
    expect(foods.length).toBeGreaterThan(0);
    expect(foods[0]!.id).toMatch(/^frida:\d+$/);
    expect(foods[0]!.source).toBe('frida');
    expect(foods[0]!.per100g.kcal).toBeGreaterThan(300);
    expect(JSON.stringify(data.sources)).toContain('CC BY 4.0');
    expect(offFetch).not.toHaveBeenCalled();
  });

  it('puts the plain food before foods that merely contain the word', async () => {
    const client = await connect();
    const top = async (query: string) => ((await call(client, 'search_foods', { query, limit: 3 })).data.foods as { name: string }[]).map((f) => f.name);
    expect((await top('egg'))[0]).toMatch(/^Egg, /); // not "Egg mayonnaise salad"
    expect((await top('rice'))[0]).toMatch(/^Rice, /); // not "Rice bran"
    expect((await top('tomato'))[0]).toMatch(/^Tomato, /);
    expect(await top('rice boiled')).toEqual(['Rice, boiled']);
  });

  it('adds Open Food Facts results when asked, with a User-Agent and no credentials option', async () => {
    const offFetch = vi.fn(async () =>
      Response.json({ products: [{ code: '5701234567892', product_name: 'Skyr Natural', brands: 'Arla', nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11, carbohydrates_100g: 4, fat_100g: 0.2 } }] }),
    );
    vi.stubGlobal('fetch', offFetch);
    const client = await connect();
    const { data } = await call(client, 'search_foods', { query: 'skyr', include_packaged: true });
    const foods = data.foods as { id: string; brand?: string }[];
    expect(foods.find((f) => f.id === 'off:5701234567892')?.brand).toBe('Arla');
    const [, init] = offFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('User-Agent')).toMatch(/^FitwellMCP\//);
    expect(init).not.toHaveProperty('credentials');
  });

  it('explains a bad barcode instead of calling Open Food Facts', async () => {
    const offFetch = vi.fn();
    vi.stubGlobal('fetch', offFetch);
    const client = await connect();
    const { isError, text } = await call(client, 'lookup_barcode', { barcode: '1234567890123' });
    expect(isError).toBe(true);
    expect(text).toMatch(/not a valid/);
    expect(offFetch).not.toHaveBeenCalled();
  });

  it('searches exercises by muscle and equipment, then returns instructions', async () => {
    const client = await connect();
    const { data } = await call(client, 'search_exercises', { query: 'squat', muscle: 'quadriceps', equipment: 'barbell', limit: 5 });
    const exercises = data.exercises as { id?: string; ref: string; equipment: string }[];
    expect(exercises.length).toBeGreaterThan(0);
    expect(exercises.every((e) => e.equipment === 'barbell')).toBe(true);
    const detail = await call(client, 'search_exercises', { id: exercises[0]!.ref });
    expect((detail.data.exercise as { instructions: string[] }).instructions.length).toBeGreaterThan(0);
  });

  it('puts the plain lift ahead of variations', async () => {
    const client = await connect();
    const { data } = await call(client, 'search_exercises', { query: 'bench press', equipment: 'barbell', limit: 3 });
    expect((data.exercises as { name: string }[])[0]!.name).toBe('Barbell Bench Press - Medium Grip');
  });

  it('rejects an unknown muscle as invalid input', async () => {
    const client = await connect();
    const res = await call(client, 'search_exercises', { muscle: 'wings' });
    expect(res.isError).toBe(true);
  });

  it('start_workout resolves library ids into a stored plan and points at the player view', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const start = tools.find((t) => t.name === 'start_workout')!;
    expect((start._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe('ui://fitwell/workout.html');
    const { data, isError } = await call(client, 'start_workout', {
      name: 'Legs',
      exercises: [
        { id: 'ex:Barbell_Squat', sets: 3, reps: 5, weight_kg: 80 },
        { id: 'ex:Pullups', sets: 2, reps: 8 },
      ],
    });
    expect(isError).toBe(false);
    const plan = data.workout as { workoutId: string; exercises: { name: string; restSec: number; bodyweight: boolean; sets: { id: string; targetReps: number; weightKg?: number; done: boolean }[] }[] };
    expect(plan.workoutId).toMatch(/^[0-9a-f-]{36}$/);
    expect(plan.exercises.map((e) => e.name)).toEqual(['Barbell Squat', 'Pullups']);
    expect(plan.exercises[0]!.sets).toEqual([
      { id: 's1.1', targetReps: 5, weightKg: 80, done: false },
      { id: 's1.2', targetReps: 5, weightKg: 80, done: false },
      { id: 's1.3', targetReps: 5, weightKg: 80, done: false },
    ]);
    expect(plan.exercises[1]).toMatchObject({ bodyweight: true, restSec: 90 });
    expect(plan.exercises[1]!.sets[0]!.weightKg).toBeUndefined();
  });

  it('start_workout names unknown exercise ids', async () => {
    const client = await connect();
    const { isError, text } = await call(client, 'start_workout', { exercises: [{ id: 'ex:Nope', sets: 1, reps: 1 }] });
    expect(isError).toBe(true);
    expect(text).toContain('ex:Nope');
  });

  it('serves the player as a single self-contained MCP Apps HTML resource', async () => {
    const client = await connect();
    const res = await client.readResource({ uri: 'ui://fitwell/workout.html' });
    const item = res.contents[0] as { mimeType?: string; text?: string };
    expect(item.mimeType).toBe('text/html;profile=mcp-app');
    expect(item.text).toMatch(/^<!doctype html>/i);
    expect(item.text).toContain('<script type="module">');
    expect(item.text).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/); // nothing external to load
  });

  it('log_set saves a set of a stored workout and refuses unknown sets', async () => {
    const client = await connect();
    const { data } = await call(client, 'start_workout', { exercises: [{ id: 'ex:Barbell_Squat', sets: 1, reps: 5, weight_kg: 80 }] });
    const workoutId = (data.workout as { workoutId: string }).workoutId;
    expect((await call(client, 'log_set', { workoutId, setId: 's1.1', reps: 5, weightKg: 82.5 })).data.saved).toBe(true);
    expect((await call(client, 'log_set', { workoutId, setId: 's9.9', reps: 5 })).isError).toBe(true);
  });
});
