import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
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

const texts = async (c: Client = client) => ((await c.callTool({ name: 'get_profile', arguments: {} })).content as { text?: string }[]).map((t) => t.text ?? '');
const offeredAt = async (u: User = ana) => (await env.DB.prepare('SELECT setup_offered_at AS at FROM users WHERE id = ?').bind(u.id).first<{ at: number | null }>())!.at;

describe('guided first session (H1)', () => {
  it('adds the setup guide to the first get_profile of a new account, and only once', async () => {
    const first = await call(client, 'get_profile');
    expect(first.data.newAccount).toBe(true);
    expect(await texts()).toHaveLength(1); // the second call: the profile JSON only
    expect(await offeredAt()).toEqual(expect.any(Number));

    // The guide itself is the result's last text, after the JSON Claude reads first.
    const env2 = createTestEnv().env;
    const bo = await signedInUser(env2, 'bo@example.com');
    const fresh = await texts(await connectAs(env2, bo));
    expect(fresh).toHaveLength(2);
    expect(JSON.parse(fresh[0]!)).toHaveProperty('profile');
    expect(fresh[1]).toContain('new to Fitwell');
    expect(fresh[1]).toContain('suggest_targets');
    expect(fresh[1]).toContain('set_goals only after they agree');
  });

  it('never offers it to an account that already has something saved', async () => {
    await call(client, 'set_goals', { kcal: 2200 });
    expect((await call(client, 'get_profile')).data.newAccount).toBeUndefined();
    expect(await texts()).toHaveLength(1);
    expect(await offeredAt()).toBeNull();
  });

  it('treats a logged meal, a weigh-in or profile details as having started', async () => {
    const accounts: [string, (c: Client) => Promise<unknown>][] = [
      ['meal', (c) => call(c, 'log_food', { day: '2026-10-20', items: [{ food_id: 'frida:413', grams: 100 }] })],
      ['weight', (c) => call(c, 'log_body', { day: '2026-10-20', weight_kg: 80 })],
      ['profile', (c) => call(c, 'update_profile', { height_cm: 180 })],
      ['equipment', (c) => call(c, 'update_profile', { equipment: ['barbell'] })],
    ];
    for (const [name, act] of accounts) {
      const u = await signedInUser(env, `${name}@example.com`);
      const c = await connectAs(env, u);
      await act(c);
      expect(await texts(c), name).toHaveLength(1);
    }
  });

  it('a time zone or units alone do not count, so the guide still comes', async () => {
    await call(client, 'update_profile', { time_zone: 'Europe/Berlin', units: 'imperial' });
    expect((await call(client, 'get_profile')).data.newAccount).toBe(true);
  });
});
