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
 * destination address of the account (that is how people are invited); the sender must be on fitwell.fyi.
 */
export function cloudflareMailer(env: Pick<Env, 'EMAIL' | 'MAIL_FROM'>): Mailer {
  return {
    async send(mail) {
      await env.EMAIL.send({ from: { name: 'Fitwell', email: env.MAIL_FROM }, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    },
  };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The sign-in email: the code in the subject (handy on phones) and the body, plus a link for the same device. */
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
<p><a href="${escape(link)}" style="display:inline-block;background:#2f5d50;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none">Sign in to Fitwell</a></p>
<p style="color:#6b655d;font-size:14px">The code and link work once and expire in 10 minutes. <strong>Never give this code to anyone.</strong> If you didn't try to sign in, ignore this email; nothing happens without the code.</p>
</body></html>`;
  return { to, subject: `Fitwell sign-in code: ${code}`, text, html };
}
