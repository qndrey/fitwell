// The whole sign-in as Claude does it: register the client, /authorize, email code or link, token, MCP call.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Mail } from '../src/auth/mailer';
import { findUserByEmail, inviteUser } from '../src/data/users';
import worker from '../src/index';
import { createTestEnv, ctx } from './support/env';

const ORIGIN = 'https://mcp.fitwell.test';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let env: Env;
let sent: Mail[];
beforeEach(async () => {
  ({ env, sent } = createTestEnv());
  await inviteUser(env.DB, 'ana@example.com');
});

const b64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** One browser: keeps cookies between requests, like the sign-in window Claude opens. */
function browser(ip = '203.0.113.7') {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    headers.set('cf-connecting-ip', ip);
    const res = await worker.fetch(new Request(ORIGIN + path, { ...init, headers, redirect: 'manual' }), env, ctx);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      jar.set(pair!.slice(0, i), pair!.slice(i + 1));
    }
    return res;
  };
}

const form = (fields: Record<string, string>) => ({ method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const hidden = (html: string, name: string) => html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1] ?? '';

async function registerClient() {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) }),
    env,
    ctx,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/** Opens /authorize like Claude would; returns the browser, the page and the PKCE verifier. */
async function startSignIn(clientId: string, b = browser()) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'fitwell', state: 'st8', code_challenge: challenge, code_challenge_method: 'S256', resource: `${ORIGIN}/mcp` });
  const res = await b(`/authorize?${q}`);
  const html = await res.text();
  return { b, verifier, html, status: res.status, csp: res.headers.get('content-security-policy') ?? '', frame: res.headers.get('x-frame-options') };
}

async function exchange(clientId: string, redirectTo: string, verifier: string) {
  const url = new URL(redirectTo);
  expect(url.origin + url.pathname).toBe(REDIRECT);
  expect(url.searchParams.get('state')).toBe('st8');
  const res = await worker.fetch(
    new Request(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: `${ORIGIN}/mcp` }),
    }),
    env,
    ctx,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { access_token: string; refresh_token: string; scope: string };
}

async function mcpAs(token: string) {
  const client = new Client({ name: 'claude-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
      fetch: (input, init) => {
        const req = new Request(input, init);
        req.headers.set('Authorization', `Bearer ${token}`);
        return worker.fetch(req, env, ctx);
      },
    }),
  );
  return client;
}

const codeIn = (mail: Mail) => mail.subject.match(/(\d{6})/)![1]!;
const linkIn = (mail: Mail) => new URL(mail.text.match(/https:\/\/\S+\/authorize\/link\S+/)![0]);

describe('email sign-in', () => {
  it('signs an invited person in with the emailed code, and the token works for MCP', async () => {
    const clientId = await registerClient();
    const { b, verifier, html, status, csp, frame } = await startSignIn(clientId);
    expect(status).toBe(200);
    expect(html).toContain('Claude');
    expect(html).toContain('claude.ai'); // where access goes
    expect(csp).toContain("frame-ancestors 'none'");
    expect(frame).toBe('DENY');

    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'Ana@Example.com ', consent: 'yes' }))).text();
    expect(page).toContain('Check your email');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ana@example.com');

    const done = await b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code: codeIn(sent[0]!) }));
    expect(done.status).toBe(302);
    const tokens = await exchange(clientId, done.headers.get('Location')!, verifier);
    expect(tokens.scope).toBe('fitwell');

    const client = await mcpAs(tokens.access_token);
    const res = await client.callTool({ name: 'get_profile', arguments: {} });
    expect((res.structuredContent as { email: string }).email).toBe('ana@example.com');
    const user = await findUserByEmail(env.DB, 'ana@example.com');
    expect(user).toMatchObject({ status: 'active' });
    expect(user!.consented_at).toBeGreaterThan(0);
  });

  it('finishes in the waiting window when the link is opened in the same browser', async () => {
    const clientId = await registerClient();
    const { b, verifier, html } = await startSignIn(clientId);
    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).text();
    const poll = () => b('/authorize', form({ step: 'poll', handle: hidden(page, 'handle'), login: hidden(page, 'login') })).then((r) => r.json() as Promise<{ waiting?: boolean; redirectTo?: string }>);

    expect(await poll()).toEqual({ waiting: true });
    const link = linkIn(sent[0]!);
    const opened = await b(link.pathname + link.search); // a second tab of the same browser
    expect(await opened.text()).toContain('You are signed in');
    const { redirectTo } = await poll();
    await exchange(clientId, redirectTo!, verifier);
  });

  it('ignores the link in any other browser (someone else started the sign-in with your address)', async () => {
    const clientId = await registerClient();
    // The attacker starts a sign-in with Ana's address in their own browser...
    const { b: attacker, html } = await startSignIn(clientId, browser('198.51.100.66'));
    const page = await (await attacker('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).text();
    // ...Ana gets the email and clicks the link in her own browser.
    const link = linkIn(sent[0]!);
    const ana = await browser('203.0.113.7')(link.pathname + link.search);
    expect(ana.status).toBe(403);
    expect(await ana.text()).toContain('Type the code instead');
    // The attacker's waiting window gets nothing.
    const res = await attacker('/authorize', form({ step: 'poll', handle: hidden(page, 'handle'), login: hidden(page, 'login') }));
    expect(await res.json()).toEqual({ waiting: true });
  });

  it('sends nothing to an address that is not invited, and shows the same page', async () => {
    const clientId = await registerClient();
    const { b, html } = await startSignIn(clientId);
    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'stranger@example.com', consent: 'yes' }))).text();
    expect(page).toContain('Check your email');
    expect(sent).toHaveLength(0);
    // Both pages say where to ask for an invite, the same for everyone.
    expect(html).toContain('Not invited yet? Ask at <strong>privacy@fitwell.test</strong>');
    expect(page).toContain('Not invited yet? Ask at <strong>privacy@fitwell.test</strong>');
    // No code can work for it.
    const res = await b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code: '123456' }));
    expect(res.status).toBe(400);
  });

  it('needs the consent box', async () => {
    const { b, html } = await startSignIn(await registerClient());
    const res = await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com' }));
    expect(await res.text()).toContain('consent');
    expect(sent).toHaveLength(0);
  });

  it('allows 5 wrong codes, then voids the sign-in', async () => {
    const { b, html } = await startSignIn(await registerClient());
    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).text();
    const right = codeIn(sent[0]!);
    const wrong = right === '000000' ? '111111' : '000000';
    const attempt = (code: string) => b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code }));
    for (let i = 0; i < 5; i++) expect((await attempt(wrong)).status).toBe(400);
    const last = await attempt(right);
    expect(last.status).toBe(400);
    expect(await last.text()).toContain('expired or was used too many times');
  });

  it('counts parallel guesses too: at most 5 codes are ever compared', async () => {
    const { b, html } = await startSignIn(await registerClient());
    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).text();
    const right = codeIn(sent[0]!);
    const guesses = Array.from({ length: 30 }, (_, i) => String(i).padStart(6, '0')).filter((c) => c !== right);
    await Promise.all(guesses.map((code) => b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code }))));
    const row = await env.DB.prepare('SELECT attempts FROM login_requests WHERE id = ?').bind(hidden(page, 'login')).first<{ attempts: number }>();
    expect(row!.attempts).toBe(5);
    expect((await b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code: right }))).status).toBe(400);
  });

  it('does not let another browser finish with the code', async () => {
    const clientId = await registerClient();
    const { b, html } = await startSignIn(clientId);
    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).text();
    const other = browser('198.51.100.9');
    const res = await other('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code: codeIn(sent[0]!) }));
    expect(res.status).toBe(400);
    // The real browser can still finish.
    const ok = await b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code: codeIn(sent[0]!) }));
    expect(ok.status).toBe(302);
  });

  it('limits sign-in emails per address', async () => {
    const clientId = await registerClient();
    for (let i = 0; i < 5; i++) {
      const { b, html } = await startSignIn(clientId);
      expect((await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).status).toBe(200);
    }
    const { b, html } = await startSignIn(clientId);
    expect((await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).status).toBe(429);
    expect(sent).toHaveLength(5);
  });

  it('keeps the email limit under parallel requests', async () => {
    const clientId = await registerClient();
    const starts = await Promise.all(Array.from({ length: 12 }, () => startSignIn(clientId)));
    await Promise.all(starts.map(({ b, html }) => b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))));
    expect(sent.length).toBeLessThanOrEqual(5);
  });

  it('refuses the token once the account is deleted', async () => {
    const clientId = await registerClient();
    const { b, verifier, html } = await startSignIn(clientId);
    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email: 'ana@example.com', consent: 'yes' }))).text();
    const done = await b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code: codeIn(sent[0]!) }));
    const { access_token } = await exchange(clientId, done.headers.get('Location')!, verifier);
    const client = await mcpAs(access_token);
    await client.callTool({ name: 'delete_my_account', arguments: { confirm: 'delete my account' } });
    expect(await findUserByEmail(env.DB, 'ana@example.com')).toBeNull();
    const after = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'content-type': 'application/json' }, body: '{}' }), env, ctx);
    expect(after.status).toBe(401);
  });

  it('serves the privacy notice', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/privacy`), env, ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('EU');
    expect(text).toContain('privacy@fitwell.test');
  });
});

describe('directory reviewer sign-in (REVIEW_LOGIN)', () => {
  const REVIEW = 'review@fitwell.fyi';
  const CODE = '246810';
  async function withReviewLogin(secret: string, extra: Partial<Env> = {}) {
    ({ env, sent } = createTestEnv({ REVIEW_LOGIN: secret, ...extra } as Partial<Env>));
    await inviteUser(env.DB, 'ana@example.com');
    await inviteUser(env.DB, REVIEW);
  }
  async function enterEmail(email: string) {
    const clientId = await registerClient();
    const { b, verifier, html } = await startSignIn(clientId);
    const page = await (await b('/authorize', form({ step: 'email', handle: hidden(html, 'handle'), email, consent: 'yes' }))).text();
    const code = (c: string) => b('/authorize', form({ step: 'code', handle: hidden(page, 'handle'), login: hidden(page, 'login'), code: c }));
    return { clientId, verifier, page, code };
  }

  it('signs the review address in with the fixed code and sends no email', async () => {
    await withReviewLogin(` Review@Fitwell.fyi:${CODE} `);
    const { clientId, verifier, page, code } = await enterEmail(REVIEW);
    expect(page).toContain('Check your email');
    expect(sent).toHaveLength(0);
    const done = await code(CODE);
    expect(done.status).toBe(302);
    const tokens = await exchange(clientId, done.headers.get('Location')!, verifier);
    const res = await (await mcpAs(tokens.access_token)).callTool({ name: 'get_profile', arguments: {} });
    expect((res.structuredContent as { email: string }).email).toBe(REVIEW);
  });

  it('keeps the attempt limit and leaves everyone else on emailed codes', async () => {
    await withReviewLogin(`${REVIEW}:${CODE}`);
    const review = await enterEmail(REVIEW);
    expect((await review.code('111111')).status).toBe(400);
    expect((await review.code(CODE)).status).toBe(302);

    const ana = await enterEmail('ana@example.com');
    expect(sent.map((m) => m.to)).toEqual(['ana@example.com']);
    if (codeIn(sent[0]!) !== CODE) expect((await ana.code(CODE)).status).toBe(400);
    expect((await ana.code(codeIn(sent[0]!))).status).toBe(302);
  });

  it('does nothing for an address that is not invited', async () => {
    ({ env, sent } = createTestEnv({ REVIEW_LOGIN: `${REVIEW}:${CODE}` } as Partial<Env>));
    const { code } = await enterEmail(REVIEW);
    expect(sent).toHaveLength(0);
    expect((await code(CODE)).status).toBe(400);
  });

  it('is off when the secret is malformed or names an admin', async () => {
    for (const [secret, extra] of [[`${REVIEW}:12345`, {}], [REVIEW, {}], [`${REVIEW}:${CODE}`, { ADMIN_EMAILS: `owner@example.com, ${REVIEW}` }]] as const) {
      await withReviewLogin(secret, extra as Partial<Env>);
      const { code } = await enterEmail(REVIEW);
      expect(sent.map((m) => m.to)).toEqual([REVIEW]); // back to an emailed random code
      if (codeIn(sent[0]!) !== CODE) expect((await code(CODE)).status).toBe(400);
    }
  });
});
