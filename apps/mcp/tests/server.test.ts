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

  it('lists the reference tools with instructions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_exercise', 'lookup_barcode', 'search_exercises', 'search_foods']);
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
});
