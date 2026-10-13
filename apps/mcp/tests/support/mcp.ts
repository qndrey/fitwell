import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { OffClient } from '@fitwell/core/off/client';
import { cachedOff } from '../../src/data/offCache';
import { deleteUser, inviteUser, recordLogin, type User } from '../../src/data/users';
import { createServer, type ServerDeps } from '../../src/server';

export type Structured = Record<string, unknown>;

/** Never reached unless a test opts in: tool results that need Open Food Facts fail loudly. */
export const offlineOff: OffClient = {
  search: async () => {
    throw new Error('Open Food Facts called in a test that did not stub it');
  },
  product: async () => {
    throw new Error('Open Food Facts called in a test that did not stub it');
  },
};

/** A signed-in person (invited, consented). */
export async function signedInUser(env: Env, email: string): Promise<User> {
  const u = await inviteUser(env.DB, email);
  await recordLogin(env.DB, u.id);
  return u;
}

/** A real MCP client connected in-process to a server for `user`, as the Worker serves it after sign-in. */
export async function connectAs(env: Env, user: Pick<User, 'id' | 'email'>, off: OffClient = offlineOff, extra: Partial<ServerDeps> = {}) {
  const handler = createMcpHandler(() => createServer({ off: cachedOff(env.DB, off), db: env.DB, publicUrl: 'https://mcp.fitwell.test', user, deleteAccount: () => deleteUser(env.DB, user), ...extra }));
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: (input, init) => handler.fetch(new Request(input, init)) }));
  return client;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  return { isError: res.isError === true, data: res.structuredContent as Structured, text: (res.content as { text?: string }[])[0]?.text ?? '' };
}

/** Tools that open a view answer the model with a sentence followed by JSON; this reads the JSON. */
export function jsonInText<T = Structured>(text: string): T {
  return JSON.parse(text.slice(text.indexOf('{'))) as T;
}
