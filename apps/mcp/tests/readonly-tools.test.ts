import { describe, expect, it } from 'vitest';
import { createTestEnv } from './support/env';
import { connectAs, signedInUser } from './support/mcp';

/** Every row of every table, so two snapshots can be compared. */
async function snapshot(env: Env): Promise<Record<string, unknown[]>> {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>()).results;
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) out[name] = (await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results;
  return out;
}

describe('tools marked readOnlyHint', () => {
  it('change nothing in the database, not even a flag (OpenAI checks the hint against behaviour)', async () => {
    const { env: probe } = createTestEnv();
    const names = (await (await connectAs(probe, await signedInUser(probe, 'probe@example.com'))).listTools()).tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    expect(names.length).toBeGreaterThan(10);

    for (const name of names) {
      // A fresh account per tool: some first calls (like a setup offer) only write once.
      const { env } = createTestEnv();
      const client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
      const before = await snapshot(env);
      // Arguments are empty: a refusal is fine, a write is not. The Open Food Facts stub throws, which is also fine.
      await client.callTool({ name, arguments: {} }).catch(() => undefined);
      expect(await snapshot(env), `${name} is read-only but wrote`).toEqual(before);
    }
  }, 120_000);
});
