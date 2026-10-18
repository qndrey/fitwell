// Email sign-in for the OAuth /authorize endpoint.
//   GET  /authorize               validate the client's request, ask for an email (+ consent)
//   POST /authorize step=email    create a sign-in request; email a code + link if the address is invited
//   POST /authorize step=code     check the code, finish
//   POST /authorize step=poll     (from the code page) finish once the link was opened in this browser
//   GET  /authorize/link          the emailed link: counts only in the browser that started the sign-in
//                                 (its secret cookie), so a link clicked by someone else can't sign an attacker in
// The pending OAuth request lives server-side behind the library's consent handle, bound to the browser
// that started it, so only that browser can complete the sign-in.
import { AuthorizationError, CimdFetchError, type AuthRequest, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { findUser, findUserByEmail, normalizeEmail, recordLogin } from '../data/users';
import { signInMail, type Mailer } from './mailer';
import { codePage, emailPage, messageBody, page } from './pages';
import { randomCode, randomToken, sameDigest, sha256 } from './secrets';

export const SCOPE = 'fitwell';
const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const PER_EMAIL_PER_HOUR = 5;
const PER_IP_PER_HOUR = 20;
// The reviewers' code is fixed, so guesses add up across sign-ins: in REVIEW_WINDOW_MS at most this many wrong codes
// can ever be typed at it (open sign-ins count as if all their tries were used), after which that address gets a
// random, emailed code like anyone else until the count ages out or the stored requests are cleared.
// 20 guesses at a 6-digit code is a 1 in 50,000 chance.
const REVIEW_MAX_WRONG = 20;
const REVIEW_WINDOW_MS = 30 * 86_400_000;
// Sign-in requests (email, IP address, times, hashed codes) are kept only as long as a limit needs them: the
// longest is the reviewers' guess count above. Older ones are deleted whenever someone asks for a code.
const KEEP_LOGIN_REQUESTS_MS = REVIEW_WINDOW_MS;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BROWSER_COOKIE = '__Host-fitwell-signin';

function cookie(request: Request, name: string): string {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export interface LoginDeps {
  db: D1Database;
  oauth: OAuthHelpers;
  mailer: Mailer;
  publicUrl: string;
  /** Where people can ask for an invite; shown on the sign-in pages. */
  contact?: string;
  /** The directory reviewers' demo account, which signs in with a fixed code instead of an email (see parseReviewLogin). */
  review?: ReviewLogin;
  now?: () => number;
}

export interface ReviewLogin {
  email: string;
  code: string;
}

/**
 * The secret REVIEW_LOGIN, "email:code" with a 6-digit code: Anthropic's directory reviewers can't receive our
 * sign-in emails, so this one address signs in with a code they are given instead. It still has to be invited,
 * tick the consent box and stay within the same expiry, attempt and rate limits; only the email is skipped.
 * Wrong codes are also counted across sign-ins (REVIEW_MAX_WRONG). Anything malformed turns it off. Delete the
 * secret when no review is running.
 */
export function parseReviewLogin(raw: string | undefined): ReviewLogin | undefined {
  const value = (raw ?? '').trim();
  const at = value.lastIndexOf(':');
  if (at < 0) return undefined;
  const email = normalizeEmail(value.slice(0, at));
  const code = value.slice(at + 1).trim();
  return EMAIL_RE.test(email) && /^\d{6}$/.test(code) ? { email, code } : undefined;
}

interface LoginRow {
  id: string;
  email: string;
  user_id: string | null;
  code_hash: string;
  link_hash: string;
  expires_at: number;
  attempts: number;
  browser_hash: string;
  verified_at: number | null;
  completed_at: number | null;
}

const html = (title: string, body: string, status = 200, headers?: Headers) => page(title, body, { status, headers });
const problem = (text: string, status = 400) => html('Sign-in problem', messageBody('Something went wrong', text), status);

export async function handleAuthorize(request: Request, deps: LoginDeps): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/authorize/link' && request.method === 'GET') return await openLink(request, url, deps);
    if (url.pathname !== '/authorize') return new Response('Not found', { status: 404 });
    if (request.method === 'GET') return await start(request, deps);
    if (request.method === 'POST') return await submit(request, deps);
    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return problem(`${error.description ?? 'This sign-in is no longer valid'}. Close this window and start again from Claude.`);
    if (error instanceof CimdFetchError) return problem('The app asking for access could not be verified.');
    throw error;
  }
}

async function start(request: Request, deps: LoginDeps): Promise<Response> {
  const authRequest = await deps.oauth.parseAuthRequest(request);
  const details = await deps.oauth.describeConsent(authRequest);
  const consent = await deps.oauth.beginConsent(authRequest);
  return html('Sign in to Fitwell', emailPage(details, consent.handle, { contact: deps.contact }), 200, consent.headers);
}

async function submit(request: Request, deps: LoginDeps): Promise<Response> {
  const form = await request.formData();
  const field = (k: string) => String(form.get(k) ?? '');
  const step = field('step');
  const handle = field('handle');
  if (step === 'deny') {
    const denied = await deps.oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  if (step === 'email') return sendCode(request, deps, handle, field('email'), field('consent') === 'yes');
  if (step === 'code') return checkCode(request, deps, handle, field('login'), field('code'));
  if (step === 'poll') return poll(request, deps, handle, field('login'));
  return problem('Unknown step.');
}

async function sendCode(request: Request, deps: LoginDeps, handle: string, rawEmail: string, consented: boolean): Promise<Response> {
  const now = deps.now?.() ?? Date.now();
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email) || !consented) {
    // The handle is still unused: re-render the same form. (Client details come from the stored request.)
    return problem(!consented ? 'Please tick the consent box to continue. Go back and try again.' : 'That email address does not look right. Go back and try again.');
  }
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const user = await findUserByEmail(deps.db, email);
  const id = crypto.randomUUID();
  let reviewer = deps.review?.email === email; // settled below, once this request is recorded
  let code = reviewer ? deps.review!.code : randomCode();
  const token = randomToken();
  const browserSecret = randomToken();
  await deps.db
    .prepare('INSERT INTO login_requests (id, email, user_id, code_hash, link_hash, browser_hash, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, user?.id ?? null, await sha256(`${id}:${code}`), await sha256(token), await sha256(browserSecret), ip, now, now + TTL_MS)
    .run();
  await deps.db.prepare('DELETE FROM login_requests WHERE created_at < ?').bind(now - KEEP_LOGIN_REQUESTS_MS).run();
  // Rate limits, counted after recording this attempt so parallel requests can't slip past them.
  const hourAgo = now - 3_600_000;
  const recent = await deps.db
    .prepare('SELECT (SELECT COUNT(*) FROM login_requests WHERE email = ? AND created_at > ?) AS by_email, (SELECT COUNT(*) FROM login_requests WHERE ip = ? AND created_at > ?) AS by_ip')
    .bind(email, hourAgo, ip, hourAgo)
    .first<{ by_email: number; by_ip: number }>();
  if (!recent || recent.by_email > PER_EMAIL_PER_HOUR || recent.by_ip > PER_IP_PER_HOUR) {
    await deps.db.prepare('UPDATE login_requests SET completed_at = ? WHERE id = ?').bind(now, id).run(); // void it
    return problem('Too many sign-in attempts. Wait an hour and try again.', 429);
  }
  // The fixed code only while the guesses it could still take fit the allowance; checked after recording this
  // request (which counts as open), so parallel sign-ins can't each see room for themselves.
  if (reviewer && (await reviewGuessesCommitted(deps.db, email, now)) > REVIEW_MAX_WRONG) {
    reviewer = false;
    code = randomCode();
    await deps.db.prepare('UPDATE login_requests SET code_hash = ? WHERE id = ?').bind(await sha256(`${id}:${code}`), id).run();
  }
  // Only invited addresses get an email; the page is the same either way, so it reveals nothing.
  // The reviewers' account gets none: they were given its code.
  if (user && !reviewer) {
    const link = `${deps.publicUrl}/authorize/link?l=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
    try {
      await deps.mailer.send(signInMail(email, code, link, 'Claude'));
    } catch (e) {
      console.error('sign-in email failed', e instanceof Error ? e.message : e);
    }
  }
  const { body, script } = codePage(handle, id, email, undefined, deps.contact);
  // Lax: sent when the emailed link is opened in this same browser (a top-level navigation from the mail app).
  const headers = new Headers({ 'Set-Cookie': `${BROWSER_COOKIE}=${browserSecret}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}` });
  return page('Check your email', body, { script, headers });
}

/**
 * Wrong codes this address has typed recently, plus every try still open: a succeeded sign-in counts its tries but
 * the last (that one was right), an open one all MAX_ATTEMPTS (it could still take them), a finished one what it took.
 */
async function reviewGuessesCommitted(db: D1Database, email: string, now: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE
         WHEN verified_at IS NOT NULL THEN MAX(attempts - 1, 0)
         WHEN completed_at IS NULL AND expires_at > ?1 AND attempts < ?2 THEN ?2
         ELSE attempts END), 0) AS guesses
       FROM login_requests WHERE email = ?3 AND created_at > ?4`,
    )
    .bind(now, MAX_ATTEMPTS, email, now - REVIEW_WINDOW_MS)
    .first<{ guesses: number }>();
  return row?.guesses ?? 0;
}

async function loadLogin(db: D1Database, id: string): Promise<LoginRow | null> {
  return id ? db.prepare('SELECT * FROM login_requests WHERE id = ?').bind(id).first<LoginRow>() : null;
}

const usable = (l: LoginRow | null, now: number): l is LoginRow => !!l && !l.completed_at && l.expires_at > now && l.attempts < MAX_ATTEMPTS;

async function checkCode(request: Request, deps: LoginDeps, handle: string, loginId: string, code: string): Promise<Response> {
  const now = deps.now?.() ?? Date.now();
  const login = await loadLogin(deps.db, loginId);
  // Count the try before comparing, in one statement: parallel guesses can't get past the limit.
  const counted = login
    ? await deps.db
        .prepare('UPDATE login_requests SET attempts = attempts + 1 WHERE id = ? AND completed_at IS NULL AND expires_at > ? AND attempts < ? RETURNING attempts')
        .bind(login.id, now, MAX_ATTEMPTS)
        .first<{ attempts: number }>()
    : null;
  if (!login || !counted) return problem('This code has expired or was used too many times. Close this window and start again from Claude.');
  const ok = login.user_id !== null && /^\d{6}$/.test(code) && sameDigest(await sha256(`${login.id}:${code}`), login.code_hash);
  if (!ok) {
    const left = MAX_ATTEMPTS - counted.attempts;
    const { body, script } = codePage(handle, login.id, login.email, left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Start again from Claude.', deps.contact);
    return page('Check your email', body, { script, status: 400 });
  }
  await deps.db.prepare('UPDATE login_requests SET verified_at = COALESCE(verified_at, ?) WHERE id = ?').bind(now, login.id).run();
  const { redirectTo, headers } = await finish(request, deps, handle, login, now);
  headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers });
}

async function poll(request: Request, deps: LoginDeps, handle: string, loginId: string): Promise<Response> {
  const now = deps.now?.() ?? Date.now();
  const login = await loadLogin(deps.db, loginId);
  if (!usable(login, now)) return Response.json({ expired: true });
  if (!login.verified_at || !login.user_id) return Response.json({ waiting: true });
  const { redirectTo, headers } = await finish(request, deps, handle, login, now);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ redirectTo }), { headers });
}

/**
 * The emailed link. It counts only in the browser that started the sign-in (its secret cookie): otherwise
 * someone could start a sign-in with your address and get in when you click the link they caused to be sent.
 * It only marks the request verified; the waiting sign-in page in that browser finishes it.
 */
async function openLink(request: Request, url: URL, deps: LoginDeps): Promise<Response> {
  const now = deps.now?.() ?? Date.now();
  const login = await loadLogin(deps.db, url.searchParams.get('l') ?? '');
  const token = url.searchParams.get('t') ?? '';
  if (!usable(login, now) || !login.user_id || !sameDigest(await sha256(token), login.link_hash)) {
    return html('Link expired', messageBody('This link has expired', 'Sign-in links work once, for 10 minutes. Start again from Claude.'), 400);
  }
  const browser = cookie(request, BROWSER_COOKIE);
  if (!browser || !login.browser_hash || !sameDigest(await sha256(browser), login.browser_hash)) {
    return html(
      'Use the code',
      messageBody('Type the code instead', 'This link only works in the browser where the sign-in started. Type the 6-digit code from the email into the Fitwell sign-in window. If you did not start a sign-in, ignore the email.'),
      403,
    );
  }
  await deps.db.prepare('UPDATE login_requests SET verified_at = COALESCE(verified_at, ?) WHERE id = ?').bind(now, login.id).run();
  return html('Signed in', messageBody('You are signed in', 'Go back to the Fitwell sign-in window. It continues by itself in a few seconds. You can close this tab.'));
}

async function finish(request: Request, deps: LoginDeps, handle: string, login: LoginRow, now: number): Promise<{ redirectTo: string; headers: Headers }> {
  const user = await findUser(deps.db, login.user_id!);
  if (!user) throw new AuthorizationError('access_denied', { description: 'This account no longer exists' });
  // Only the browser that started the sign-in can finish it (the handle is bound to its cookie)...
  const approved = await deps.oauth.approveConsent(request, handle, { scope: [SCOPE] });
  // ...and only once, so a code and the link can't both complete it.
  const claimed = await deps.db.prepare('UPDATE login_requests SET completed_at = ? WHERE id = ? AND completed_at IS NULL').bind(now, login.id).run();
  if (claimed.meta.changes === 0) throw new AuthorizationError('access_denied', { description: 'This sign-in was already used' });
  const { redirectTo } = await deps.oauth.completeAuthorization({
    request: approved.request as AuthRequest,
    userId: user.id,
    metadata: { email: user.email },
    scope: approved.request.scope,
    props: { userId: user.id, email: user.email },
  });
  await recordLogin(deps.db, user.id, now);
  return { redirectTo, headers: approved.headers };
}

