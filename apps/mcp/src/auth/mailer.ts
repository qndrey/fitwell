export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Cloudflare Email Service via the `send_email` binding. On the free plan the recipient must be a verified
 * destination address of the account, so this is only the fallback (local development, or no RESEND_API_KEY);
 * the sender must be on fitwell.fyi.
 */
export function cloudflareMailer(env: Pick<Env, 'EMAIL' | 'MAIL_FROM'>): Mailer {
  return {
    async send(mail) {
      await env.EMAIL.send({ from: { name: 'Fitwell', email: env.MAIL_FROM }, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    },
  };
}

/** Resend (https://resend.com): reaches any address from our own domain; MAIL_FROM must be on a domain verified there. */
export function resendMailer(env: { MAIL_FROM: string; RESEND_API_KEY: string }, doFetch: typeof fetch = fetch): Mailer {
  return {
    async send(mail) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `Fitwell <${env.MAIL_FROM}>`, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}

/** Resend when the optional secret RESEND_API_KEY is set (wrangler secret put RESEND_API_KEY), else Cloudflare's binding. */
export function mailerFor(env: Pick<Env, 'EMAIL' | 'MAIL_FROM'> & { RESEND_API_KEY?: string }): Mailer {
  return env.RESEND_API_KEY ? resendMailer({ MAIL_FROM: env.MAIL_FROM, RESEND_API_KEY: env.RESEND_API_KEY }) : cloudflareMailer(env);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The sign-in email: the code in the body, plus a link for the same device. */
export function signInMail(to: string, code: string, link: string, clientName: string): Mail {
  const text = [
    `Your Fitwell sign-in code is ${code}`,
    '',
    `Type it in the sign-in window that ${clientName} opened, or open this link in that same browser:`,
    link,
    '',
    'The code and link work once and expire in 10 minutes.',
    "Never give this code to anyone. If you didn't try to sign in, ignore this email; nothing happens without the code.",
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f1d1a;line-height:1.5;max-width:480px;margin:0 auto;padding:24px">
<p>Your Fitwell sign-in code:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${escape(code)}</p>
<p>Type it in the sign-in window that ${escape(clientName)} opened, or open the link in that same browser:</p>
<p><a href="${escape(link)}" style="display:inline-block;background:#5a5650;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none">Sign in to Fitwell</a></p>
<p style="color:#6b655d;font-size:14px">The code and link work once and expire in 10 minutes. <strong>Never give this code to anyone.</strong> If you didn't try to sign in, ignore this email; nothing happens without the code.</p>
</body></html>`;
  return { to, subject: "Your Fitwell sign-in code", text, html };
}

const stepsText = (to: string, connectorUrl: string) => [
  '1. Add the connector in Claude',
  '   On claude.ai or the Claude desktop app: Settings, then Connectors, then Add custom connector.',
  '   Paste this address and save:',
  `   ${connectorUrl}`,
  '   It then shows up in the Claude app on your phone too.',
  '',
  '2. Sign in',
  '   Claude opens a Fitwell sign-in window. Enter this email address (' + to + '), tick the consent box and press the button.',
  '   We email you a 6-digit code (check spam if it is slow). Type it into the window, or open the link in the email in the same browser.',
  '',
  '3. Say hello',
  '   Start a chat with the Fitwell connector turned on and write: "Set up my Fitwell profile".',
];

const stepsHtml = (to: string, connectorUrl: string) => {
  const step = (n: number, title: string, body: string) => `<tr><td style="vertical-align:top;padding:0 12px 16px 0;font-weight:700;color:#5a5650">${n}</td><td style="padding-bottom:16px"><strong>${title}</strong><br>${body}</td></tr>`;
  return `<table role="presentation" style="border-collapse:collapse;margin-top:16px">
${step(1, 'Add the connector in Claude', `On claude.ai or the Claude desktop app: <strong>Settings</strong>, then <strong>Connectors</strong>, then <strong>Add custom connector</strong>. Paste this address and save:<br><code style="display:inline-block;margin-top:6px;padding:6px 10px;background:#f1ede7;border-radius:8px;word-break:break-all">${escape(connectorUrl)}</code><br><span style="color:#6b655d;font-size:14px">It then shows up in the Claude app on your phone too.</span>`)}
${step(2, 'Sign in', `Claude opens a Fitwell sign-in window. Enter <strong>${escape(to)}</strong>, tick the consent box and press the button. We email you a 6-digit code (check spam if it is slow). Type it into the window, or open the link in the email in the same browser.`)}
${step(3, 'Say hello', 'Start a chat with the Fitwell connector turned on and write: <em>Set up my Fitwell profile</em>.')}
</table>`;
};

/** Sent when the owner approves a request: how to add the connector in Claude and sign in. */
export function approvalMail(to: string, d: { connectorUrl: string; privacyUrl: string; contact?: string }): Mail {
  const text = [
    "Your Fitwell invitation is approved. Here is how to start (about three minutes).",
    '',
    ...stepsText(to, d.connectorUrl),
    '',
    `Privacy notice: ${d.privacyUrl}`,
    d.contact ? `Questions: ${d.contact}` : '',
    '',
    "If you didn't ask for an invitation, ignore this email; nothing happens unless you add the connector and sign in.",
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f1d1a;line-height:1.5;max-width:480px;margin:0 auto;padding:24px">
<h1 style="font-size:22px;margin:0 0 8px">You're in</h1>
<p>Your Fitwell invitation is approved. Here is how to start (about three minutes).</p>
${stepsHtml(to, d.connectorUrl)}
<p style="color:#6b655d;font-size:14px"><a href="${escape(d.privacyUrl)}">Privacy notice</a>${d.contact ? ` · Questions: ${escape(d.contact)}` : ''}<br>If you didn't ask for an invitation, ignore this email; nothing happens unless you add the connector and sign in.</p>
</body></html>`;
  return { to, subject: "You're invited to Fitwell: add it to Claude", text, html };
}

/** Sent to the owner when someone asks for an invite. The address was checked against a strict shape before it got here. */
export function inviteRequestMail(to: string, d: { email: string; platform: string | null }): Mail {
  const uses = d.platform ? `Uses: ${d.platform}` : 'Device: not given';
  const how = 'To answer it, ask Claude (with the Fitwell connector) to list the invite requests, then approve or decline.';
  const text = [`${d.email} asked for a Fitwell invite.`, uses, '', how, 'Nothing was sent to them; they get an email only if you approve.'].join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f1d1a;line-height:1.5;max-width:480px;margin:0 auto;padding:24px">
<p><strong>${escape(d.email)}</strong> asked for a Fitwell invite.</p>
<p>${escape(uses)}</p>
<p style="color:#6b655d;font-size:14px">${escape(how)} Nothing was sent to them; they get an email only if you approve.</p>
</body></html>`;
  return { to, subject: 'New Fitwell invite request', text, html };
}

/** Sent when a member invites a friend. The only words from the member are their own address; there is no free text. */
export function invitationMail(to: string, d: { inviter: string; connectorUrl: string; privacyUrl: string; contact?: string; expiresOn: string }): Mail {
  const intro = `${d.inviter} invited you to try Fitwell, a fitness and nutrition coach that works inside your AI assistant: you log food, plan meals and run workouts by chatting. Fitwell is invite-only. Here is how to start (about three minutes).`;
  const closing = `This is a one-off email: we send no reminders. Nothing happens unless you add the connector and sign in, and the invitation expires on ${d.expiresOn}. If you don't know ${d.inviter} or don't want this, ignore it.`;
  const text = [intro, '', ...stepsText(to, d.connectorUrl), '', `Privacy notice: ${d.privacyUrl}`, d.contact ? `Questions: ${d.contact}` : '', '', closing]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f1d1a;line-height:1.5;max-width:480px;margin:0 auto;padding:24px">
<h1 style="font-size:22px;margin:0 0 8px">${escape(d.inviter)} invited you to Fitwell</h1>
<p>${escape(intro)}</p>
${stepsHtml(to, d.connectorUrl)}
<p style="color:#6b655d;font-size:14px"><a href="${escape(d.privacyUrl)}">Privacy notice</a>${d.contact ? ` · Questions: ${escape(d.contact)}` : ''}<br>${escape(closing)}</p>
</body></html>`;
  return { to, subject: `${d.inviter} invited you to Fitwell`, text, html };
}
