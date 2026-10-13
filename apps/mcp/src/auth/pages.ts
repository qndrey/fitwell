import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:light dark;--bg:#faf8f5;--surface:#f1ede7;--text:#1f1d1a;--muted:#6b655d;--border:#ddd6cc;--accent:#2f5d50;--on-accent:#fff;--danger:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--surface:#262421;--text:#f2efe9;--muted:#b2aba1;--border:#3a3733;--accent:#8fc7b4;--on-accent:#10201b;--danger:#f2b8b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:440px;margin:0 auto;padding:32px 16px calc(32px + env(safe-area-inset-bottom));display:grid;gap:16px}
h1{font-size:1.5rem;margin:0}p{margin:0}.muted{color:var(--muted)}.small{font-size:.875rem}.error{color:var(--danger)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;display:grid;gap:12px}
label{display:grid;gap:6px}input[type=email],input[type=text]{font:inherit;font-size:1.1rem;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--text);width:100%}
input.code{font-size:1.6rem;letter-spacing:.4em;text-align:center;font-variant-numeric:tabular-nums}
.check{display:flex;gap:10px;align-items:flex-start}.check input{width:22px;height:22px;margin-top:2px;flex:none}
button{font:inherit;min-height:48px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;padding:0 16px}
button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.actions{display:grid;gap:8px}a{color:inherit}
`;

/** A page with a nonce-based CSP: no external resources, no framing, inline style/script only with the nonce. */
export function page(title: string, body: string, opts: { script?: string; status?: number; headers?: Headers } = {}): Response {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style nonce="${nonce}">${STYLE}</style></head>
<body><main>${body}</main>${opts.script ? `<script nonce="${nonce}">${opts.script}</script>` : ''}</body></html>`;
  const headers = new Headers(opts.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  // No form-action: the final redirect after a form post goes to the client's callback on another origin.
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cache-Control', 'no-store');
  return new Response(html, { status: opts.status ?? 200, headers });
}

const PRIVACY_SUMMARY =
  'Fitwell stores the food, workout and body data you share with it, which is health data, to track it for you and show it back to you. ' +
  'It is kept in the EU, never sold or shared, and you can export or delete it at any time.';

export function emailPage(d: ConsentDescription, handle: string, opts: { email?: string; error?: string; contact?: string } = {}): string {
  const who = d.clientDomain ? `${escape(d.clientName)} (${escape(d.clientDomain)})` : `${escape(d.clientName)} <span class="muted small">(name not verified)</span>`;
  return `
<h1>Sign in to Fitwell</h1>
<div class="card">
  <p><strong>${who}</strong> wants to use your Fitwell account. Access goes to <strong>${escape(d.redirectHost)}</strong>.</p>
  ${d.redirectIsLoopback ? '<p class="error small"><strong>This sends access to an app on this computer.</strong> Continue only if you just started signing in from it.</p>' : ''}
</div>
<form method="post" class="card">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <label for="email">Your email</label>
  <input id="email" type="email" name="email" autocomplete="email" required maxlength="254" value="${escape(opts.email ?? '')}" autofocus>
  <div class="check"><input id="consent" type="checkbox" name="consent" value="yes" required aria-describedby="consent-text">
    <label for="consent" class="small" id="consent-text">${PRIVACY_SUMMARY} I agree to this.</label>
  </div>
  <p class="small"><a href="/privacy" target="_blank" rel="noopener">Privacy notice</a></p>
  ${opts.error ? `<p class="error small" role="alert">${escape(opts.error)}</p>` : ''}
  <div class="actions">
    <button class="primary" name="step" value="email">Email me a sign-in code</button>
    <button name="step" value="deny" formnovalidate>Cancel</button>
  </div>
</form>
<p class="muted small">Fitwell is invite-only. No password: we email you a code.${opts.contact ? ` Not invited yet? Ask at <strong>${escape(opts.contact)}</strong>.` : ''}</p>`;
}

/** After the email step. Polls for the link being opened (in any browser) while the code can be typed here. */
export function codePage(handle: string, loginId: string, email: string, error?: string, contact?: string): { body: string; script: string } {
  const body = `
<h1>Check your email</h1>
<p>If <strong>${escape(email)}</strong> is invited, a 6-digit code and a link are on their way. They expire in 10 minutes.</p>
<form method="post" class="card" id="code-form">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <input type="hidden" name="login" value="${escape(loginId)}">
  <label for="code">Code</label>
  <input id="code" class="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
  ${error ? `<p class="error small" role="alert">${escape(error)}</p>` : ''}
  <div class="actions"><button class="primary" name="step" value="code">Continue</button></div>
</form>
<p class="muted small" id="wait" aria-live="polite">Opened the link in this browser? This page continues by itself. On another device, type the code instead.</p>
<p class="muted small">Wrong address or no email? Close this window and start signing in again from Claude.${contact ? ` Not invited yet? Ask at <strong>${escape(contact)}</strong>.` : ''}</p>`;
  const script = `
const f=document.getElementById('code-form');
const body=new URLSearchParams({step:'poll',handle:f.handle.value,login:f.login.value});
let tries=0;
async function poll(){
  if(++tries>200)return;
  try{
    const r=await fetch('/authorize',{method:'POST',body,headers:{'content-type':'application/x-www-form-urlencoded'},credentials:'same-origin'});
    const j=await r.json();
    if(j.redirectTo){document.getElementById('wait').textContent='Signed in. Returning…';location.href=j.redirectTo;return}
    if(j.expired){document.getElementById('wait').textContent='This sign-in expired. Start again from Claude.';return}
  }catch(e){}
  setTimeout(poll,3000);
}
setTimeout(poll,3000);`;
  return { body, script };
}

export function messageBody(title: string, text: string): string {
  return `<h1>${escape(title)}</h1><div class="card"><p>${escape(text)}</p></div>`;
}

export function privacyBody(contact: string): string {
  return `
<h1>Privacy notice</h1>
<div class="card">
  <p><strong>What:</strong> your email address, and what you choose to share through Claude: profile and goals, foods you log, your own foods, and later workouts and body measurements. This includes health data.</p>
  <p><strong>Why:</strong> only to store it and show it back to you (tracking, plans, progress). Legal basis: your explicit consent, given at sign-in.</p>
  <p><strong>Where:</strong> Cloudflare (D1 database restricted to the EU). Sign-in emails are sent through Cloudflare. Food lookups send only search words or barcodes to Open Food Facts.</p>
  <p><strong>Not done:</strong> no ads, no analytics, no selling or sharing, no AI training by Fitwell.</p>
  <p><strong>Your rights:</strong> ask Claude to export your data (export_my_data) or delete your account (delete_my_account) at any time; this erases everything immediately. You can also withdraw consent or ask questions by email.</p>
  <p><strong>Contact:</strong> ${escape(contact)}</p>
</div>`;
}
