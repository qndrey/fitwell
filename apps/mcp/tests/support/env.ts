import type { Mail } from '../../src/auth/mailer';
import { createTestD1 } from './d1';
import { createTestKV } from './kv';

/** A full Worker env for tests: real SQL (node:sqlite), in-memory KV, captured emails. */
export function createTestEnv(overrides: Partial<Env> = {}) {
  const sent: Mail[] = [];
  const env = {
    DB: createTestD1(),
    OAUTH_KV: createTestKV(),
    EMAIL: {
      async send(m: { to: string; subject: string; text?: string; html?: string }) {
        sent.push({ to: m.to, subject: m.subject, text: m.text ?? '', html: m.html ?? '' });
        return { messageId: String(sent.length) };
      },
    },
    MAIL_FROM: 'login@fitwell.fyi',
    CONTACT_EMAIL: 'privacy@fitwell.test',
    PUBLIC_URL: 'https://mcp.fitwell.test',
    DEV_UNAUTHENTICATED: '',
    ...overrides,
  } as unknown as Env;
  return { env, sent };
}

export const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
