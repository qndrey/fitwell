// Anthropic's connector directory requires a title and an explicit readOnlyHint or destructiveHint on every tool;
// Claude uses them for permissions (read-only tools run without asking, destructive ones always ask).
import { describe, expect, it } from 'vitest';
import { createTestEnv } from './support/env';
import { connectAs, signedInUser } from './support/mcp';

/** Tools that can overwrite or remove what the person already has. Everything else that writes only adds. */
const DESTRUCTIVE = [
  'delete_item',
  'delete_my_account',
  'edit_food_entry', // changes a logged entry
  'manage_invites', // remove takes back an invitation
  'save_meal_plan', // saving a week again replaces its plan
  'save_recipe', // saving under an existing name replaces it
  'save_workout_template', // the same
  'set_goals',
  'update_profile',
];

async function listTools(isAdmin: boolean) {
  const { env } = createTestEnv();
  const client = await connectAs(env, await signedInUser(env, 'owner@example.com'), undefined, { isAdmin });
  return (await client.listTools()).tools;
}

describe('tool annotations', () => {
  it('covers the admin-only tool too', async () => {
    expect((await listTools(true)).map((t) => t.name)).toContain('manage_invites');
  });

  it.each([false, true])('every tool has a title and explicit hints (admin: %s)', async (isAdmin) => {
    for (const tool of await listTools(isAdmin)) {
      const a = tool.annotations ?? {};
      expect(tool.title, tool.name).toBeTruthy();
      expect(typeof a.readOnlyHint, `${tool.name} readOnlyHint`).toBe('boolean');
      if (a.readOnlyHint) {
        expect(a.destructiveHint, `${tool.name} is read-only`).not.toBe(true);
      } else {
        expect(a.destructiveHint, `${tool.name} destructiveHint`).toBe(DESTRUCTIVE.includes(tool.name));
      }
    }
  });

  it('names only real tools as destructive', async () => {
    const names = (await listTools(true)).map((t) => t.name);
    for (const name of DESTRUCTIVE) expect(names).toContain(name);
  });
});
