// Asking for an invite (the public form) and the owner's review of it from Claude.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Mail } from '../src/auth/mailer';
import { handleRequestAccess, MAX_WAITING } from '../src/auth/requestAccess';
import { addInviteRequest, countInviteRequests, listInviteRequests } from '../src/data/inviteRequests';
import { findUserByEmail, inviteUser } from '../src/data/users';
import { createTestEnv } from './support/env';
import { call, connectAs } from './support/mcp';

const ORIGIN = 'https://mcp.fitwell.test';
let env: Env;
beforeEach(() => {
  ({ env } = createTestEnv());
});

function submit(fields: Record<string, string>, opts: { ip?: string; headers?: Record<string, string> } = {}, now?: number) {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, 'cf-connecting-ip': opts.ip ?? '203.0.113.9', ...opts.headers });
  return handleRequestAccess(new Request(`${ORIGIN}/request-access`, { method: 'POST', headers, body: new URLSearchParams(fields) }), { db: env.DB, contact: 'ask@fitwell.test', now: now ? () => now : undefined });
}
const valid = { email: 'New.Person@Example.com', platform: 'iphone', consent: 'yes', website: '' };
const waiting = async () => (await listInviteRequests(env.DB)).map((r) => [r.email, r.platform]);

describe('the request form', () => {
  it('shows the form with a hidden field for bots and the privacy link', async () => {
    const res = await handleRequestAccess(new Request(`${ORIGIN}/request-access`), { db: env.DB });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('name="website"');
    expect(html).toContain('/privacy');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('stores a request, and answers the same for a repeat', async () => {
    const first = await submit(valid);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('Your request is in');
    expect(await waiting()).toEqual([['new.person@example.com', 'iphone']]);
    const again = await submit({ ...valid, platform: 'web' });
    expect(await again.text()).toContain('Your request is in');
    expect(await waiting()).toEqual([['new.person@example.com', 'iphone']]);
  });

  describe('the owner notice', () => {
    let notices: Mail[];
    let fail = false;
    const notify = { mailer: { send: async (m: Mail) => { if (fail) throw new Error('down'); notices.push(m); } }, to: 'hello@fitwell.test' };
    const post = (fields: Record<string, string>) => {
      const headers = { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9' };
      return handleRequestAccess(new Request(`${ORIGIN}/request-access`, { method: 'POST', headers, body: new URLSearchParams(fields) }), { db: env.DB, notify });
    };
    beforeEach(() => {
      notices = [];
      fail = false;
    });

    it('emails the owner the address and device of a new request, once', async () => {
      await post(valid);
      await post({ ...valid, platform: 'web' });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ to: 'hello@fitwell.test', subject: 'New Fitwell invite request' });
      expect(notices[0]!.text).toContain('new.person@example.com');
      expect(notices[0]!.text).toContain('Uses: iphone');
    });

    it('sends nothing for a known member, a bot or a bad request', async () => {
      await inviteUser(env.DB, 'ana@example.com');
      await post({ ...valid, email: 'ana@example.com' });
      await post({ ...valid, website: 'http://spam.example' });
      await post({ ...valid, email: 'bad' });
      await post({ ...valid, consent: '' });
      expect(notices).toEqual([]);
    });

    it('still stores the request and answers the same when the notice cannot be sent', async () => {
      fail = true;
      const res = await post(valid);
      expect(await res.text()).toContain('Your request is in');
      expect(await waiting()).toEqual([['new.person@example.com', 'iphone']]);
    });
  });

  it('answers the same for someone already invited and stores nothing', async () => {
    await inviteUser(env.DB, 'ana@example.com');
    const res = await submit({ ...valid, email: 'ana@example.com' });
    expect(await res.text()).toContain('Your request is in');
    expect(await countInviteRequests(env.DB)).toBe(0);
  });

  it('drops a filled honeypot quietly', async () => {
    const res = await submit({ ...valid, website: 'http://spam.example' });
    expect(await res.text()).toContain('Your request is in');
    expect(await countInviteRequests(env.DB)).toBe(0);
  });

  it('accepts the browser form post, which carries Origin: null because the page sends no referrer', async () => {
    const res = await submit({ ...valid, email: 'browser@example.com' }, { headers: { origin: 'null', 'sec-fetch-site': 'same-origin' } });
    expect(res.status).toBe(200);
    expect(await waiting()).toEqual([['browser@example.com', 'iphone']]);
  });

  it('answers the landing page in JSON it may read, and keeps the same checks', async () => {
    const landing = { origin: 'https://fitwell.fyi', 'sec-fetch-site': 'same-site', accept: 'application/json' };
    const ok = await submit({ ...valid, email: 'landing@example.com' }, { headers: landing });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://fitwell.fyi');
    expect(await ok.json()).toMatchObject({ ok: true });
    expect(await waiting()).toContainEqual(['landing@example.com', 'iphone']);

    const bad = await submit({ ...valid, email: 'bad' }, { headers: { ...landing, origin: 'https://www.fitwell.fyi' } });
    expect(bad.status).toBe(400);
    expect(bad.headers.get('access-control-allow-origin')).toBe('https://www.fitwell.fyi');
    expect(await bad.json()).toEqual({ ok: false, error: 'That email address does not look right.' });

    // Another subdomain is same-site too, but not the landing page.
    const other = await submit(valid, { headers: { ...landing, origin: 'https://evil.fitwell.fyi' } });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses another site, a bad address and a missing tick', async () => {
    expect((await submit(valid, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await submit(valid, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await submit({ ...valid, email: 'bad' }, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' } })).status).toBe(400); // Sec-Fetch-Site decides when it is sent: past the origin check
    expect((await submit({ ...valid, email: 'null.origin@example.com' }, { headers: { origin: 'null' } })).status).toBe(403); // no Sec-Fetch-Site: a null Origin is not trusted
    expect((await submit({ ...valid, email: 'not an address' })).status).toBe(400);
    expect((await submit({ ...valid, email: `${'a'.repeat(250)}@example.com` })).status).toBe(400);
    const noTick = await submit({ ...valid, consent: '' });
    expect(noTick.status).toBe(400);
    expect(await noTick.text()).toContain('Please tick the box');
    expect(await countInviteRequests(env.DB)).toBe(0);
  });

  it('takes an unknown device as none, and only POST or GET', async () => {
    await submit({ ...valid, platform: 'toaster' });
    expect(await waiting()).toEqual([['new.person@example.com', null]]);
    expect((await handleRequestAccess(new Request(`${ORIGIN}/request-access`, { method: 'PUT' }), { db: env.DB })).status).toBe(405);
  });

  it('limits one IP to 5 requests an hour, and the waiting list to its cap', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect((await submit({ ...valid, email: `p${i}@example.com` }, {}, now)).status).toBe(200);
    expect((await submit({ ...valid, email: 'p5@example.com' }, {}, now)).status).toBe(429);
    expect((await submit({ ...valid, email: 'p5@example.com' }, {}, now + 3_700_000)).status).toBe(200);
    for (let i = 0; i < MAX_WAITING; i++) await addInviteRequest(env.DB, { email: `bulk${i}@example.com`, platform: null, ip: `10.0.${i}.1`, now });
    expect((await submit({ ...valid, email: 'late@example.com' }, { ip: '198.51.100.1' }, now)).status).toBe(503);
  });

  it('forgets requests older than 30 days', async () => {
    const now = Date.now();
    await addInviteRequest(env.DB, { email: 'old@example.com', platform: null, ip: 'x', now: now - 31 * 86_400_000 });
    await submit(valid, {}, now);
    expect(await waiting()).toEqual([['new.person@example.com', 'iphone']]);
  });
});

describe('the owner reviews requests from Claude', () => {
  let sent: Mail[];
  let fail: boolean;
  const owner = { id: 'owner-1', email: 'owner@example.com' };
  const connect = () => connectAs(env, owner, undefined, { isAdmin: true, publicUrl: ORIGIN, contact: 'ask@fitwell.test', mailer: { send: async (m) => { if (fail) throw new Error('down'); sent.push(m); } } });
  beforeEach(async () => {
    sent = [];
    fail = false;
    await inviteUser(env.DB, owner.email);
    await submit(valid);
  });

  it('lists what is waiting', async () => {
    const r = await call(await connect(), 'list_invite_requests', {});
    expect(r.data.waiting).toEqual([{ email: 'new.person@example.com', uses: 'iphone', requestedAt: new Date().toISOString().slice(0, 10) }]);
  });

  it('list shows the waiting requests too, so asking about invites finds them', async () => {
    const r = await call(await connect(), 'list_invitations', {});
    expect((r.data.waitingRequests as { email: string }[]).map((w) => w.email)).toEqual(['new.person@example.com']);
    expect((r.data.people as { email: string }[]).map((p) => p.email)).toEqual(['owner@example.com']);
  });

  it('approve invites them, emails the instructions, then removes the request', async () => {
    const c = await connect();
    const r = await call(c, 'approve_invite_request', { email: 'new.person@example.com' });
    expect(r.data).toMatchObject({ approved: true, emailed: true });
    expect((await findUserByEmail(env.DB, 'new.person@example.com'))?.status).toBe('invited');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('new.person@example.com');
    expect(sent[0]!.text).toContain(`${ORIGIN}/mcp`);
    expect(await countInviteRequests(env.DB)).toBe(0);
    expect((await call(c, 'approve_invite_request', { email: 'new.person@example.com' })).isError).toBe(true);
  });

  it('keeps the request when the email fails, so approve can be tried again', async () => {
    const c = await connect();
    fail = true;
    const r = await call(c, 'approve_invite_request', { email: 'new.person@example.com' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('request stays');
    expect(await countInviteRequests(env.DB)).toBe(1);
    fail = false;
    expect((await call(c, 'approve_invite_request', { email: 'new.person@example.com' })).data.approved).toBe(true);
    expect(await countInviteRequests(env.DB)).toBe(0);
  });

  it('decline deletes the request and sends nothing', async () => {
    const r = await call(await connect(), 'decline_invite_request', { email: 'new.person@example.com' });
    expect(r.data.declined).toBe(true);
    expect(sent).toHaveLength(0);
    expect(await findUserByEmail(env.DB, 'new.person@example.com')).toBeNull();
    expect(await countInviteRequests(env.DB)).toBe(0);
  });

  it('answers for an address with no waiting request', async () => {
    const c = await connect();
    expect((await call(c, 'approve_invite_request', { email: 'nobody@example.com' })).isError).toBe(true);
    expect((await call(c, 'decline_invite_request', { email: 'nobody@example.com' })).isError).toBe(true);
  });

  it('add also clears a waiting request for that address', async () => {
    await call(await connect(), 'add_invitation', { email: 'new.person@example.com' });
    expect(await countInviteRequests(env.DB)).toBe(0);
  });
});
