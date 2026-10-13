import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const devEnv = { DEV_UNAUTHENTICATED: 'true' } as Env;

/** A real MCP client talking to the Worker's fetch handler in-process. */
async function connect(env: Env = devEnv) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (input, init) => worker.fetch(new Request(input, init), env),
  });
  await client.connect(transport);
  return client;
}

type Structured = Record<string, unknown>;
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const res = await client.callTool({ name, arguments: args });
  return { isError: res.isError === true, data: res.structuredContent as Structured, text: (res.content as { text?: string }[])[0]?.text ?? '' };
};

afterEach(() => vi.unstubAllGlobals());

describe('fitwell MCP server', () => {
  it('refuses to serve /mcp unless local dev mode is on', async () => {
    const res = await worker.fetch(new Request('http://localhost/mcp', { method: 'POST', body: '{}' }), {} as Env);
    expect(res.status).toBe(503);
  });

  it('serves a deployed test server only at the secret path', async () => {
    const token = 'a'.repeat(40);
    const env = { SPIKE_TOKEN: token } as Env;
    const post = (path: string, e: Env) => worker.fetch(new Request(`http://localhost${path}`, { method: 'POST', body: '{}' }), e);
    expect((await post('/mcp', env)).status).toBe(503);
    expect((await post('/mcp/wrong', env)).status).toBe(503);
    expect((await post(`/mcp/${token}`, { SPIKE_TOKEN: 'short' } as Env)).status).toBe(503);
    expect((await post('/mcp/short', { SPIKE_TOKEN: 'short' } as Env)).status).toBe(503);
    expect((await post(`/mcp/${token}`, { DEV_UNAUTHENTICATED: 'true' } as Env)).status).toBe(503);
    expect((await post(`/mcp/${token}`, env)).status).not.toBe(503);
  });

  it('lists the reference tools with instructions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_exercise', 'log_set', 'lookup_barcode', 'search_exercises', 'search_foods', 'start_workout']);
    const search = tools.find((t) => t.name === 'search_exercises')!;
    // Muscles and equipment are enums taken from the dataset, so Claude sees the valid values.
    expect(JSON.stringify(search.inputSchema)).toContain('quadriceps');
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
    const detail = await call(client, 'get_exercise', { id: exercises[0]!.ref });
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

  it('start_workout resolves library ids into a plan and points at the player view', async () => {
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
    const plan = data.workout as { workoutId: string; exercises: { name: string; restSec: number; sets: { reps: number; weightKg?: number }[] }[] };
    expect(plan.workoutId).toMatch(/^[0-9a-f-]{36}$/);
    expect(plan.exercises.map((e) => e.name)).toEqual(['Barbell Squat', 'Pullups']);
    expect(plan.exercises[0]!.sets).toEqual([{ reps: 5, weightKg: 80 }, { reps: 5, weightKg: 80 }, { reps: 5, weightKg: 80 }]);
    expect(plan.exercises[1]!.sets[0]!.weightKg).toBeUndefined();
    expect(plan.exercises[0]!.restSec).toBe(90);
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

  it('log_set acknowledges a set from the player', async () => {
    const client = await connect();
    const { data } = await call(client, 'log_set', { workoutId: crypto.randomUUID(), exerciseId: 'ex:Barbell_Squat', setNumber: 1, reps: 5, weightKg: 80 });
    expect(data.saved).toBe(true);
  });
});
