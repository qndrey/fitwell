// The public form for asking for an invitation.
//   GET  /request-access   the form
//   POST /request-access   store the request (nothing is emailed; the owner reviews it with list_invite_requests)
// The landing page (fitwell.fyi) has the same form and posts it here with fetch and `Accept: application/json`, so the
// visitor stays on that page: those answers are JSON, readable by the landing origins only (CORS).
// The answer is the same whether the address is new, already waiting, already invited or already signed in, so the form
// reveals nothing about who is on the list. Checks: POST from this site or the landing page only, a hidden field only bots
// fill, a strict address shape, a few requests per IP per hour and a cap on waiting requests.
import { addInviteRequest, countInviteRequests, countInviteRequestsFromIp, EMAIL, PLATFORMS, type Platform } from '../data/inviteRequests';
import { pruneExpiredInvitations } from '../data/memberInvites';
import { findUserByEmail, normalizeEmail } from '../data/users';
import { messageBody, page, requestAccessPage } from './pages';

const PER_IP_PER_HOUR = 5;
export const MAX_WAITING = 200;
const MAX_BODY = 2048;
/** The landing page's origins, allowed to post the form with fetch and read the JSON answer. */
export const LANDING_ORIGINS = ['https://fitwell.fyi', 'https://www.fitwell.fyi'];

export interface RequestAccessDeps {
  db: D1Database;
  /** Shown on the page as the other way to ask. */
  contact?: string;
  now?: () => number;
  /** Defaults to LANDING_ORIGINS. */
  landingOrigins?: readonly string[];
}

const THANKS = 'Your request is in. If it is approved you will get an email at that address with the next steps. Nothing else is sent.';

export async function handleRequestAccess(request: Request, deps: RequestAccessDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/request-access') return new Response('Not found', { status: 404 });
  if (request.method === 'GET') return page('Ask for an invite', requestAccessPage({ contact: deps.contact }));
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Only a form submitted from this very page, or the landing page's fetch. This page sends no referrer, so browsers send
  // `Origin: null` with its form: Sec-Fetch-Site (sent by every current browser) is what tells a same-site post apart, and
  // Origin only decides when it is missing. A fetch always carries its real Origin, whatever the referrer policy.
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  const fromLanding = origin !== null && (deps.landingOrigins ?? LANDING_ORIGINS).includes(origin);
  const sameSite = site !== null ? site === 'same-origin' : origin === null || origin === url.origin;
  if (!sameSite && !fromLanding) return new Response('Forbidden', { status: 403 });

  // The landing page asks for JSON; this page's own form gets HTML back.
  const json = fromLanding && (request.headers.get('Accept') ?? '').includes('application/json');
  const cors: Record<string, string> = fromLanding ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  const thanks = () =>
    json ? Response.json({ ok: true, message: THANKS }, { headers: cors }) : page('Request received', messageBody('Thanks', THANKS));
  const problem = (text: string, status: number, email?: string, platform?: string) =>
    json
      ? Response.json({ ok: false, error: text }, { status, headers: cors })
      : page('Ask for an invite', requestAccessPage({ error: text, email, platform, contact: deps.contact }), { status });

  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return new Response('Too large', { status: 413, headers: cors });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad request', { status: 400, headers: cors });
  }
  const field = (k: string) => String(form.get(k) ?? '');
  // A person never sees this field; a filled one is a bot, which gets the normal answer and nothing is stored.
  if (field('website') !== '') return thanks();

  const email = normalizeEmail(field('email'));
  const platform = (PLATFORMS as readonly string[]).includes(field('platform')) ? (field('platform') as Platform) : null;
  if (email.length > 254 || !EMAIL.test(email)) return problem('That email address does not look right.', 400, field('email').slice(0, 254), platform ?? '');
  if (field('consent') !== 'yes') return problem('Please tick the box so we may keep your address until we have answered.', 400, email, platform ?? '');

  const now = deps.now?.() ?? Date.now();
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if ((await countInviteRequestsFromIp(deps.db, ip, now - 3_600_000)) >= PER_IP_PER_HOUR) return problem('Too many requests from here. Try again in an hour.', 429);
  if ((await countInviteRequests(deps.db)) >= MAX_WAITING) return problem('Requests are paused for now.' + (deps.contact ? ` Ask at ${deps.contact} instead.` : ''), 503);

  await pruneExpiredInvitations(deps.db, now);
  if (!(await findUserByEmail(deps.db, email))) await addInviteRequest(deps.db, { email, platform, ip, now });
  return thanks();
}
