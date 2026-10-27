import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:light dark;--bg:#faf8f5;--surface:#f1ede7;--text:#1f1d1a;--muted:#6b655d;--border:#ddd6cc;--accent:#4a4743;--on-accent:#fff;--btn:#5a5650;--on-btn:#faf8f5;--danger:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--surface:#262421;--text:#f2efe9;--muted:#b2aba1;--border:#3a3733;--accent:#d6d0c6;--on-accent:#1b1a18;--btn:#cfc9bf;--on-btn:#1b1a18;--danger:#f2b8b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:440px;margin:0 auto;padding:32px 16px calc(32px + env(safe-area-inset-bottom));display:grid;gap:16px}
h1{font-size:1.5rem;margin:0}p{margin:0}.muted{color:var(--muted)}.small{font-size:.875rem}.error{color:var(--danger)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;display:grid;gap:12px}
label{display:grid;gap:6px}input[type=email],input[type=text]{font:inherit;font-size:1.1rem;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--text);width:100%}
input.code{font-size:1.6rem;letter-spacing:.4em;text-align:center;font-variant-numeric:tabular-nums}
.check{display:flex;gap:10px;align-items:flex-start}.check input{width:22px;height:22px;margin-top:2px;flex:none}
button{font:inherit;min-height:48px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;padding:0 16px}
button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:var(--btn);border-color:var(--btn);color:var(--on-btn);font-weight:600}
.actions{display:grid;gap:8px}a{color:inherit}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
select{font:inherit;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--text);width:100%}
input[type=checkbox]{accent-color:var(--btn)}input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid var(--btn);outline-offset:2px}
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

export function emailPage(d: ConsentDescription, handle: string, opts: { email?: string; error?: string } = {}): string {
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
<p class="muted small">Fitwell is invite-only. No password: we email you a code. Not invited yet? <a href="/request-access">Ask for an invite</a>.</p>`;
}

/** After the email step. Polls for the link being opened (in any browser) while the code can be typed here. */
export function codePage(handle: string, loginId: string, email: string, error?: string): { body: string; script: string } {
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
<p class="muted small">Wrong address or no email? Close this window and start signing in again from Claude. Not invited yet? <a href="/request-access">Ask for an invite</a>.</p>`;
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

/** The form for asking for an invitation (see requestAccess.ts). The hidden "website" field is for bots. */
export function requestAccessPage(opts: { email?: string; platform?: string; error?: string; contact?: string } = {}): string {
  const choice = (value: string, label: string) => `<option value="${value}"${opts.platform === value ? ' selected' : ''}>${label}</option>`;
  return `
<h1>Ask for an invite</h1>
<p>Fitwell is invite-only. Leave your email and we will look at your request. If it is approved, we email you how to add Fitwell to Claude. We never email you before that.</p>
<form method="post" class="card">
  <label for="email">Your email</label>
  <input id="email" type="email" name="email" autocomplete="email" required maxlength="254" value="${escape(opts.email ?? '')}" autofocus>
  <label for="platform">I use Claude on <span class="muted small">(optional)</span></label>
  <select id="platform" name="platform">${choice('', 'Not sure yet')}${choice('desktop', 'The desktop app')}${choice('web', 'The website (claude.ai)')}${choice('iphone', 'iPhone')}</select>
  <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
  <div class="check"><input id="consent" type="checkbox" name="consent" value="yes" required>
    <label for="consent" class="small">Keep my email address until you have answered (at most 30 days) so you can approve or decline it.</label>
  </div>
  <p class="small"><a href="/privacy" target="_blank" rel="noopener">Privacy notice</a></p>
  ${opts.error ? `<p class="error small" role="alert">${escape(opts.error)}</p>` : ''}
  <div class="actions"><button class="primary" type="submit">Ask for an invite</button></div>
</form>
${opts.contact ? `<p class="muted small">Prefer email? Write to <strong>${escape(opts.contact)}</strong>.</p>` : ''}`;
}

export function messageBody(title: string, text: string): string {
  return `<h1>${escape(title)}</h1><div class="card"><p>${escape(text)}</p></div>`;
}

export function supportBody(contact: string): string {
  return `
<h1>Fitwell support</h1>
<div class="card">
  <p>Questions, something broken, a sign-in code that stopped working, or you want your data exported or erased? Write to <strong>${escape(contact)}</strong>. One person reads it, usually within a few days.</p>
  <p><strong>Not invited yet?</strong> Fitwell is invite-only during early access. <a href="/request-access">Ask for an invite</a>.</p>
  <p><strong>On your own:</strong> ask your assistant to export your data (export_my_data) or delete your account (delete_my_account) at any time.</p>
  <p class="small"><a href="/privacy">Privacy notice</a> · <a href="/terms">Terms of service</a> · <a href="https://fitwell.fyi">About Fitwell</a></p>
</div>`;
}

export function termsBody(contact: string): string {
  return `
<h1>Terms of service</h1>
<div class="card">
  <p><strong>What Fitwell is:</strong> a connector that lets an AI assistant (Claude, ChatGPT) log your food, plan meals, build and run workouts and show your progress. Fitwell is in early access and by invitation only. It is run by one person, not a company with a support team.</p>
  <p><strong>Not medical advice:</strong> calorie and macro targets, training suggestions and weekly reviews are general guidance, estimated from what you enter. They are not medical, dietary or other professional advice, and nothing in Fitwell diagnoses or treats anything. Talk to a doctor or a dietitian before big changes to your diet or training, and if you have a medical condition, an eating disorder, or are pregnant. Stop exercising if something hurts. Food data comes from public databases and from you, and can be wrong: check allergens on the package.</p>
  <p><strong>Your account:</strong> you sign in with your own email address, and you are responsible for what is done with your account. Use Fitwell lawfully, do not try to break it, get around its limits, or reach anyone else's data, and do not use it to send invitations to people who would not want them. You can invite friends only as far as Fitwell allows. We may refuse or end access to anyone who breaks these terms or abuses the service.</p>
  <p><strong>Your data:</strong> it stays yours. Fitwell stores it only to run the service for you, as described in the <a href="/privacy">privacy notice</a>. You can export it (export_my_data) or erase it together with your account (delete_my_account) at any time.</p>
  <p><strong>The service:</strong> Fitwell is free during early access and is provided as it is, without promises that it will always be available, error-free or kept in its current form. Features, limits and the invitation rule can change, and the service can be changed or stopped; if that happens we will give you a chance to export your data first where we can.</p>
  <p><strong>Liability:</strong> to the extent the law allows, Fitwell and its owner are not liable for indirect or consequential loss, or for any decision you make from the numbers and suggestions it shows. Nothing here limits rights you have by law that cannot be limited, or liability for intent or gross negligence.</p>
  <p><strong>Changes:</strong> if these terms change in a way that matters, the new version is posted here and the date below is updated. Using Fitwell after that means you accept it.</p>
  <p><strong>Contact:</strong> ${escape(contact)}</p>
  <p class="muted small">Last updated 27 October 2026.</p>
</div>`;
}

export function privacyBody(contact: string): string {
  return `
<h1>Privacy notice</h1>
<div class="card">
  <p><strong>What:</strong> your email address, and what you choose to share through Claude: your profile (time zone, sex, birth year, height, weight, activity level, equipment, diet preferences and allergies) and goals; the foods you log and your own foods; recipes, meal plans and shopping-list ticks; workouts, workout templates and exercise notes; weigh-ins, body measurements, sleep, steps and water; the short written reviews of a week or month that Claude saves for you. This includes health data. For sign-in we also record the email address, IP address and time of each request for a code. We also note when Fitwell first offered you its setup, so it is offered only once. If you ask for an invite through the form, we keep your email address, the optional device you chose and your IP address. If a member invites a friend, we keep the friend's email address and who invited them (the inviter's email address) until the friend signs in or the invitation expires, and a record of each invitation the inviter sent (the time and the address they typed) for at most 30 days, to limit how many one person can send and to show them their list. This includes addresses that already had an account, so the list cannot reveal who already uses Fitwell; only the inviter and the owner can see it, and the address is cleared when the invitation is cancelled or that person deletes their account. The invitation email shows the inviter's email address.</p>
  <p><strong>Why:</strong> only to store it and show it back to you (tracking, plans, progress); the sign-in records, and the IP address of an invite request, are used only to limit repeated attempts; an invite request is used only to decide on it and to email you the next steps if it is approved; an invitation from a member is used only to email the friend the next steps and to show it to the member who sent it and to the owner. Legal basis: your explicit consent, given at sign-in.</p>
  <p><strong>Where:</strong> Cloudflare (D1 database restricted to the EU). Sign-in and invitation emails are sent through Resend (email delivery), which sees the recipient address and the message; sign-in sessions use Cloudflare's global storage, holding no health data. Food lookups send only search words or barcodes to Open Food Facts.</p>
  <p><strong>How long:</strong> your data is kept until you delete it: one item at a time (delete_item), or everything with your account. Sign-in records are deleted after 30 days. An invite request is deleted when it is approved or declined, and at the latest after 30 days. An invitation from a member that nobody used stops working after 30 days and its address is deleted when the next invitation, sign-in attempt or invite request is handled; the record of invitations sent, with the addresses, is deleted after 30 days. If you delete your account, the invitations you sent that nobody used are deleted too, and friends who joined keep theirs. Signing in to Claude stays valid while you use Fitwell and expires after 60 days without use. A link for importing a backup works for 30 minutes. Recent Open Food Facts results are cached for up to 7 days, without any link to you.</p>
  <p><strong>Not done:</strong> no ads, no analytics, no selling or sharing, no AI training by Fitwell.</p>
  <p><strong>Your rights:</strong> ask Claude to export your data (export_my_data) or delete your account (delete_my_account) at any time; deleting erases everything immediately and signs you out everywhere. You can also withdraw consent or ask questions by email.</p>
  <p><strong>Contact:</strong> ${escape(contact)}</p>
</div>`;
}
