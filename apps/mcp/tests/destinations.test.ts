import { describe, expect, it } from 'vitest';
import { cloudflareDestinations } from '../src/auth/destinations';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('Email Routing destinations', () => {
  const env = { CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'tok' };

  it('does nothing without the secrets', async () => {
    const f = (async () => { throw new Error('no call expected'); }) as unknown as typeof fetch;
    expect(await cloudflareDestinations({}, f)('a@example.com')).toEqual({ status: 'not_configured' });
  });

  it('posts the address with the token', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => (calls.push({ url, init }), reply(200, { success: true, result: {} }))) as unknown as typeof fetch;
    expect(await cloudflareDestinations(env, f)('a@example.com')).toEqual({ status: 'verification_sent' });
    expect(calls[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/email/routing/addresses');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(calls[0]!.init?.body).toBe('{"email":"a@example.com"}');
  });

  it('reports an address that already exists, and whether it is verified', async () => {
    for (const verified of [null, '2026-10-01T00:00:00Z']) {
      const f = (async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? reply(400, { success: false, errors: [{ message: 'duplicate' }] }) : reply(200, { success: true, result: [{ email: 'a@example.com', verified }] }))) as unknown as typeof fetch;
      expect(await cloudflareDestinations(env, f)('a@example.com')).toEqual({ status: 'already_registered', verified: verified !== null });
    }
  });

  it('reports a failure with the reason, never throwing', async () => {
    const denied = (async () => reply(403, { success: false, errors: [{ message: 'forbidden' }], result: [] })) as unknown as typeof fetch;
    expect(await cloudflareDestinations(env, denied)('a@example.com')).toEqual({ status: 'failed', reason: 'forbidden' });
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await cloudflareDestinations(env, down)('a@example.com')).toEqual({ status: 'failed', reason: 'offline' });
  });
});
