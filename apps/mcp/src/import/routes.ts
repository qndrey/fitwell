// The upload page for importing a Fitwell backup, and its two endpoints. The page is opened from a one-time link
// (created by the import_fitwell_backup tool): a random token bound to one person, expiring, used up at the end.
// The browser reads the backup file itself and sends it in small chunks, so no request is big enough to strain the
// free plan's CPU time, and the file never has to pass through the chat.
import { randomToken, sameDigest, sha256 } from '../auth/secrets';
import { messageBody, page } from '../auth/pages';
import { KINDS, MAX_CHUNK, type Kind } from './convert';
import { addToReport, describeReport, finishImport, importChunk, type Report } from './store';

export const LINK_MINUTES = 30;
const MAX_BODY = 1_500_000;
const MAX_ROWS = 200_000;

interface LinkRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  finished_at: number | null;
  rows_seen: number;
  report: string;
}

/** Makes a link for a person (replacing any earlier unfinished one). Returns the URL to open. */
export async function createImportLink(db: D1Database, userId: string, publicUrl: string, now = Date.now()): Promise<{ url: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const token = randomToken();
  const expiresAt = now + LINK_MINUTES * 60_000;
  await db.batch([
    db.prepare('DELETE FROM import_links WHERE user_id = ? AND finished_at IS NULL').bind(userId),
    db.prepare('INSERT INTO import_links (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(id, userId, await sha256(token), now, expiresAt),
  ]);
  return { url: `${publicUrl}/import?l=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`, expiresAt };
}

async function authorize(db: D1Database, url: URL, now: number): Promise<LinkRow | null> {
  const id = url.searchParams.get('l') ?? '';
  const token = url.searchParams.get('t') ?? '';
  if (!id || !token) return null;
  const link = await db.prepare('SELECT * FROM import_links WHERE id = ?').bind(id).first<LinkRow>();
  if (!link || link.finished_at !== null || link.expires_at <= now || !sameDigest(await sha256(token), link.token_hash)) return null;
  return link;
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function handleImport(request: Request, deps: { db: D1Database; now?: () => number }): Promise<Response> {
  const url = new URL(request.url);
  const now = deps.now?.() ?? Date.now();
  const link = await authorize(deps.db, url, now);

  if (url.pathname === '/import' && request.method === 'GET') {
    if (!link) return page('Link expired', messageBody('This link has expired', 'Import links work for 30 minutes and once. Ask Claude for a new one.'), { status: 400 });
    return page('Import a Fitwell backup', importPageBody(), { script: importScript(url.searchParams.get('l')!, url.searchParams.get('t')!) });
  }

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!link) return jsonResponse({ error: 'This link has expired. Ask Claude for a new one.' }, 401);
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return jsonResponse({ error: 'Expected JSON.' }, 415);
  const text = await request.text();
  if (text.length > MAX_BODY) return jsonResponse({ error: 'That chunk is too large.' }, 413);
  let body: { kind?: unknown; records?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return jsonResponse({ error: 'Not valid JSON.' }, 400);
  }

  if (url.pathname === '/import/chunk') {
    const kind = body.kind as Kind;
    if (!KINDS.includes(kind) || !Array.isArray(body.records) || body.records.length > MAX_CHUNK) return jsonResponse({ error: 'Unknown kind or too many records.' }, 400);
    if (link.rows_seen + body.records.length > MAX_ROWS) return jsonResponse({ error: 'This backup is larger than one import allows.' }, 413);
    const result = await importChunk(deps.db, link.user_id, kind, body.records);
    const report = addToReport(JSON.parse(link.report) as Report, kind, result);
    await deps.db.prepare('UPDATE import_links SET rows_seen = rows_seen + ?, report = ? WHERE id = ?').bind(body.records.length, JSON.stringify(report), link.id).run();
    return jsonResponse({ ok: true, imported: result.imported });
  }

  if (url.pathname === '/import/finish') {
    await finishImport(deps.db, link.user_id);
    await deps.db.prepare('UPDATE import_links SET finished_at = ? WHERE id = ?').bind(now, link.id).run();
    return jsonResponse({ ok: true, lines: describeReport(JSON.parse(link.report) as Report) });
  }

  return new Response('Not found', { status: 404 });
}

/** The latest finished import's summary for a person, so Claude can report it afterwards. */
export async function lastImport(db: D1Database, userId: string): Promise<{ finishedAt: number; lines: string[] } | null> {
  const r = await db.prepare('SELECT finished_at, report FROM import_links WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1').bind(userId).first<{ finished_at: number; report: string }>();
  return r ? { finishedAt: r.finished_at, lines: describeReport(JSON.parse(r.report) as Report) } : null;
}

export function importPageBody(): string {
  return `
<h1>Import a Fitwell backup</h1>
<div class="card">
  <p>In the Fitwell app: Settings → Your data → <strong>Save backup</strong>. Then choose that file here.</p>
  <p class="small muted">Your browser reads the file and sends the food, workouts, weigh-ins and measurements to your Fitwell account (health data, kept in the EU). Nothing is sent anywhere else. Entries you already have are never changed or duplicated, so you can safely try again.</p>
</div>
<div class="card">
  <label for="file">Backup file</label>
  <input id="file" type="file" accept=".json,application/json">
  <p id="found" class="small muted" aria-live="polite"></p>
  <div class="actions"><button id="go" class="primary" disabled>Import</button></div>
  <p id="status" class="small" role="status" aria-live="polite"></p>
  <ul id="report" class="small"></ul>
</div>`;
}

/** The page's script. Ids come from our own link (uuid and base64url) and are still embedded as JSON, escaped. */
function importScript(id: string, token: string): string {
  const q = JSON.stringify(`?l=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`).replace(/</g, '\\u003c');
  return `
const Q = ${q};
const CHUNK = 150;
const ORDER = ['settings', 'goals', 'customFoods', 'weightEntries', 'measurementEntries', 'workouts', 'workoutTemplates', 'foodEntries'];
const $ = (x) => document.getElementById(x);
const file = $('file'), go = $('go'), found = $('found'), status = $('status'), list = $('report');
let data = null;
const count = (k) => (data && Array.isArray(data[k]) ? data[k].length : 0);
async function post(path, body) {
  const res = await fetch(path + Q, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'The server said ' + res.status);
  return j;
}
file.addEventListener('change', async () => {
  go.disabled = true; data = null; found.textContent = ''; status.textContent = '';
  const f = file.files && file.files[0];
  if (!f) return;
  try {
    if (f.size > 80 * 1024 * 1024) throw new Error('big');
    const j = JSON.parse(await f.text());
    if (!j || j.app !== 'fitwell' || typeof j.data !== 'object' || j.data === null) throw new Error('not fitwell');
    data = j.data;
    found.textContent = 'Found ' + count('foodEntries') + ' food entries, ' + count('workouts') + ' workouts, ' + count('weightEntries') + ' weigh-ins, ' + count('measurementEntries') + ' measurement sets, ' + count('customFoods') + ' own foods and ' + count('workoutTemplates') + ' templates.';
    go.disabled = false;
  } catch (e) {
    found.textContent = 'That does not look like a Fitwell backup. Use Settings → Your data → Save backup in the Fitwell app.';
  }
});
go.addEventListener('click', async () => {
  go.disabled = true; file.disabled = true; list.replaceChildren();
  try {
    for (const kind of ORDER) {
      const all = kind === 'settings' || kind === 'goals' ? (data[kind] ? [data[kind]] : []) : Array.isArray(data[kind]) ? data[kind] : [];
      for (let i = 0; i < all.length; i += CHUNK) {
        status.textContent = 'Importing ' + kind + '… ' + Math.min(i + CHUNK, all.length) + ' of ' + all.length;
        await post('/import/chunk', { kind, records: all.slice(i, i + CHUNK) });
      }
    }
    status.textContent = 'Finishing…';
    const done = await post('/import/finish', {});
    status.textContent = 'Done. You can close this page and tell Claude.';
    for (const line of done.lines) { const li = document.createElement('li'); li.textContent = line; list.append(li); }
  } catch (e) {
    status.textContent = 'Stopped: ' + e.message + ' What was already imported is kept, and trying again skips it.';
    go.disabled = false; file.disabled = false;
  }
});`;
}
