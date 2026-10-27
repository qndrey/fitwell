// Anthropic's connector directory requires a title (annotations.title) and an explicit readOnlyHint or destructiveHint on every tool;
// Claude uses them for permissions (read-only tools run without asking, destructive ones always ask).
import { describe, expect, it } from 'vitest';
import { createTestEnv } from './support/env';
import { connectAs, signedInUser } from './support/mcp';

/** Tools that can overwrite or remove what the person already has. Everything else that writes only adds. */
const DESTRUCTIVE = [
  'delete_item',
  'delete_my_account',
  'edit_food_entry', // changes a logged entry
  'edit_workout_set', // changes a logged set
  'log_body', // a value logged for a day replaces the one already there
  'cancel_friend_invite', // takes back an invitation
  'decline_invite_request', // deletes a request
  'remove_invitation', // takes back an invitation
  'save_meal_plan', // saving a week again replaces its plan
  'save_recipe', // saving under an existing name replaces it
  'save_workout_template', // the same
  'set_goals',
  'update_profile',
];

/** Tools that reach outside Fitwell: Open Food Facts, a web page, or an email to someone else. */
const OPEN_WORLD = ['search_foods', 'lookup_barcode', 'import_recipe', 'send_friend_invite', 'approve_invite_request'];

async function listTools(isAdmin: boolean) {
  const { env } = createTestEnv();
  const client = await connectAs(env, await signedInUser(env, 'owner@example.com'), undefined, { isAdmin });
  return (await client.listTools()).tools;
}

describe('tool annotations', () => {
  it('covers the admin-only tool too', async () => {
    expect((await listTools(true)).map((t) => t.name)).toContain('approve_invite_request');
  });

  it.each([false, true])('every tool has a title and explicit hints (admin: %s)', async (isAdmin) => {
    for (const tool of await listTools(isAdmin)) {
      const a = tool.annotations ?? {};
      expect(tool.title, tool.name).toBeTruthy();
      expect(a.title, `${tool.name} annotations.title`).toBe(tool.title); // the directory reads this one
      // OpenAI's plugin scan wants all three as explicit booleans on every tool.
      for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) expect(typeof a[hint], `${tool.name} ${hint}`).toBe('boolean');
      expect(a.openWorldHint, `${tool.name} openWorldHint`).toBe(OPEN_WORLD.includes(tool.name));
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
