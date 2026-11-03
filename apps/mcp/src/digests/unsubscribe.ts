// The unsubscribe link in every digest. GET only shows a page with a button (mail scanners and link previews open links, and must not unsubscribe anyone);
// the button, or the one-click POST that mail apps send for the List-Unsubscribe header, switches the digest off.
import { page } from '../auth/pages';
import { DIGEST_KINDS, unsubscribe, validToken, type DigestKind } from '../data/digests';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function handleUnsubscribe(request: Request, deps: { db: D1Database }): Promise<Response> {
  const url = new URL(request.url);
  const u = url.searchParams.get('u') ?? '';
  const t = url.searchParams.get('t') ?? '';
  const k = url.searchParams.get('k') ?? '';
  const kind: DigestKind | 'all' = (DIGEST_KINDS as readonly string[]).includes(k) ? (k as DigestKind) : 'all';
  const invalid = () => page('Unsubscribe', '<h1>This link does not work</h1><p>It may be old. To change what Fitwell emails you, ask Claude, or write to us from the privacy notice.</p>', { status: 400 });
  if (!u || !t || u.length > 64 || t.length > 128) return invalid();
  if (request.method === 'POST') {
    if (!(await unsubscribe(deps.db, u, t, kind))) return invalid();
    // A mail app's one-click request wants a plain success; a person pressing the button sees the page.
    if ((await request.text()).includes('List-Unsubscribe=One-Click')) return new Response('Unsubscribed', { status: 200 });
    return page('Unsubscribed', `<h1>You are unsubscribed</h1><p>Fitwell will not send you ${kind === 'weekly' ? 'the weekly summary' : kind === 'nudge' ? 'reminders' : 'these emails'} any more. You can turn them on again by asking Claude.</p>`);
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
  if (!(await validToken(deps.db, u, t))) return invalid(); // a link that cannot work says so now, not after the button
  const what = kind === 'weekly' ? 'the weekly summary' : kind === 'nudge' ? 'reminders' : 'these emails';
  return page(
    'Unsubscribe',
    `<h1>Stop ${what}?</h1><p>Press the button to stop Fitwell emailing you ${what}.</p><form method="post" action="/unsubscribe?u=${encodeURIComponent(u)}&amp;t=${encodeURIComponent(t)}&amp;k=${escape(kind)}"><button type="submit">Unsubscribe</button></form>`,
  );
}
