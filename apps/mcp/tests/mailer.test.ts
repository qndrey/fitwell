import { describe, expect, it } from 'vitest';
import { approvalMail, mailerFor, resendMailer } from '../src/auth/mailer';

const mail = { to: 'a@example.com', subject: 'Hi', text: 'text', html: '<p>html</p>' };
const env = { MAIL_FROM: 'login@fitwell.fyi', RESEND_API_KEY: 're_key' };

describe('mailers', () => {
  it('posts to Resend with the key, the branded sender and the recipient', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => (calls.push({ url, init }), new Response('{"id":"1"}', { status: 200 }))) as unknown as typeof fetch;
    await resendMailer(env, f).send(mail);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ from: 'Fitwell <login@fitwell.fyi>', to: ['a@example.com'], subject: 'Hi', text: 'text', html: '<p>html</p>' });
  });

  it('throws when Resend refuses, so the caller can log it', async () => {
    const f = (async () => new Response('{"message":"domain not verified"}', { status: 403 })) as unknown as typeof fetch;
    await expect(resendMailer(env, f).send(mail)).rejects.toThrow(/403.*domain not verified/);
  });

  it('uses Cloudflare when there is no Resend key', async () => {
    const sent: unknown[] = [];
    const EMAIL = { send: async (m: unknown) => void sent.push(m) } as unknown as Env['EMAIL'];
    await mailerFor({ EMAIL, MAIL_FROM: 'login@fitwell.fyi' }).send(mail);
    expect(sent).toHaveLength(1);
  });

  it('the approval email tells them what to do, with the connector address', () => {
    const m = approvalMail('new@example.com', { connectorUrl: 'https://mcp.fitwell.test/mcp', privacyUrl: 'https://mcp.fitwell.test/privacy', contact: 'hi@fitwell.test' });
    expect(m.to).toBe('new@example.com');
    for (const part of [m.text, m.html]) {
      expect(part).toContain('https://mcp.fitwell.test/mcp');
      expect(part).toContain('Add custom connector');
      expect(part).toContain('6-digit code');
      expect(part).toContain('Set up my Fitwell profile');
    }
  });
});
