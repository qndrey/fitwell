// The server instructions and the role Claude takes for each group of tools, written as Markdown next to this file
// (imported as text: a Wrangler rule for the Worker, a small Vite plugin for the tests).
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import nutritionist from './nutritionist.md';
import progressCoach from './progress-coach.md';
import server from './server.md';
import trainer from './trainer.md';

export const SERVER_INSTRUCTIONS = server.trim();

export const ROLES = { trainer, nutritionist, progressCoach } as const;
export type Role = keyof typeof ROLES;

/**
 * The server as the register* functions see it: each tool named in `roles` answers with that role's instructions after
 * its own result. They go with the results, not the descriptions: the role matters when Claude is about to plan or
 * advise, which these tools come just before.
 */
export function withRoles(target: McpServer, roles: Record<Role, readonly string[]>): McpServer {
  const roleOf = new Map(Object.entries(roles).flatMap(([role, names]) => names.map((n) => [n, ROLES[role as Role].trim()] as const)));
  const registerTool = (name: string, config: unknown, callback: (...args: unknown[]) => CallToolResult | Promise<CallToolResult>) => {
    const text = roleOf.get(name);
    const cb = text ? async (...args: unknown[]) => addRole(await callback(...args), text) : callback;
    return (target.registerTool as (...args: unknown[]) => unknown).call(target, name, config, cb);
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'registerTool') return registerTool;
      const v: unknown = Reflect.get(t, prop, t);
      // Bound, so the SDK's own methods run on the real server (private fields do not resolve through a proxy).
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

const addRole = (res: CallToolResult, text: string): CallToolResult => (res.isError ? res : { ...res, content: [...res.content, { type: 'text', text }] });
