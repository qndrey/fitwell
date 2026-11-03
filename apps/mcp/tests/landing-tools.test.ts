// The Tools page of the landing site (apps/landing/site/src/lib/tools.ts) describes every tool by name. This keeps it honest: a name that is not a
// real tool, a real tool that was added or renamed without the page being updated, and the hints the page shows (looks only, asks first) must match.
import { describe, expect, it } from 'vitest';
import { CATEGORIES, UNLISTED_TOOLS } from '../../landing/site/src/lib/tools';
import { createTestEnv } from './support/env';
import { connectAs, signedInUser } from './support/mcp';

async function realTools() {
  const { env } = createTestEnv();
  const client = await connectAs(env, await signedInUser(env, 'owner@example.com'), undefined, { isAdmin: true });
  return (await client.listTools()).tools;
}

describe('the Tools page lists what the server really has', () => {
  const listed = CATEGORIES.flatMap((c) => c.tools);

  it('names no tool twice, and only real ones', async () => {
    const real = new Set((await realTools()).map((t) => t.name));
    const names = listed.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => !real.has(n))).toEqual([]);
    expect(UNLISTED_TOOLS.filter((n) => !real.has(n))).toEqual([]);
  });

  it('lists every real tool, or skips it on purpose', async () => {
    const names = new Set([...listed.map((t) => t.name), ...UNLISTED_TOOLS]);
    const missing = (await realTools()).map((t) => t.name).filter((n) => !names.has(n));
    expect(missing, `add these to apps/landing/site/src/lib/tools.ts (CATEGORIES, or UNLISTED_TOOLS if the pages call them): ${missing.join(', ')}`).toEqual([]);
    expect(UNLISTED_TOOLS.filter((n) => listed.some((t) => t.name === n))).toEqual([]);
  });

  it('says "looks only" for read-only tools and "asks first" for the ones that can overwrite or remove', async () => {
    const real = new Map((await realTools()).map((t) => [t.name, t]));
    const wrongReads = listed.filter((t) => t.kind === 'reads' && real.get(t.name)?.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(wrongReads, 'listed as looks-only but not read-only on the server').toEqual([]);
    // Whatever the server marks destructive, the page says the assistant asks first (and only those).
    const destructive = listed.filter((t) => real.get(t.name)?.annotations?.destructiveHint === true).map((t) => t.name);
    expect(listed.filter((t) => t.asks).map((t) => t.name).sort()).toEqual(destructive.sort());
  });

  it('shows a page only for tools that open one', async () => {
    const real = new Map((await realTools()).map((t) => [t.name, t]));
    for (const t of listed.filter((x) => x.kind === 'opens')) {
      const ui = (real.get(t.name)?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui;
      expect(ui?.resourceUri, `${t.name} is listed as opening a page`).toBeTruthy();
    }
    for (const t of listed.filter((x) => x.kind !== 'opens')) expect(t.shots, `${t.name} has screenshots but does not open a page`).toBeUndefined();
  });
});
