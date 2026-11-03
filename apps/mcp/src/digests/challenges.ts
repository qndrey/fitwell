// The cron job that closes challenges (B4): the hourly run closes every challenge whose last day is over everywhere and emails each person who joined their result, once.
// The email says why it was sent and carries only what the challenge shows its members: a name or nickname and a count of days for each.
import type { Mail, Mailer } from '../auth/mailer';
import { ChallengeData, closeDue, type ChallengeView } from '../data/challenges';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface ChallengeRunDeps {
  db: D1Database;
  mailer: Mailer;
  publicUrl: string;
  now?: () => number;
  skip?: (email: string) => boolean;
}

export function resultsMail(to: string, c: ChallengeView): Mail {
  const me = c.standings.find((s) => s.you);
  const lines = [
    `The challenge "${c.name}" is over.`,
    me ? `You counted ${plural(me.score, 'day')} of a possible ${c.maxScore}, place ${me.rank} of ${c.standings.length}.` : '',
    '',
    c.rule,
    '',
    ...c.standings.map((s) => `${s.rank}. ${s.who}: ${plural(s.score, 'day')}`),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  const footer = ['You got this once because you joined the challenge. It shows each person only as a name or nickname and a number of days; nothing else about anyone is shared.'];
  const text = [...lines, '', '--', ...footer].join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f1d1a;line-height:1.5;max-width:520px;margin:0 auto;padding:24px">
${lines.map((l) => (l === '' ? '' : `<p style="margin:8px 0">${escape(l)}</p>`)).join('\n')}
<hr style="border:none;border-top:1px solid #ddd6cc;margin:24px 0 12px">
${footer.map((l) => `<p style="margin:4px 0;font-size:13px;color:#6b655d">${escape(l)}</p>`).join('\n')}
</body></html>`;
  return { to, subject: `Challenge results: ${c.name}`, text, html };
}

export async function runChallenges(deps: ChallengeRunDeps): Promise<{ closed: number; emailed: number; failed: number }> {
  const now = deps.now?.() ?? Date.now();
  const out = { closed: 0, emailed: 0, failed: 0 };
  let closed: Awaited<ReturnType<typeof closeDue>>;
  try {
    closed = await closeDue(deps.db, new Date(now).toISOString().slice(0, 10), now);
  } catch (e) {
    console.error('challenges close', e instanceof Error ? e.message : String(e)); // for instance the migration is not applied yet
    return { ...out, failed: 1 };
  }
  out.closed = closed.length;
  // Closed earlier but not yet emailed (a failed send is retried by the next run).
  const { results: waiting } = await deps.db.prepare("SELECT m.challenge_id, m.user_id, u.email FROM challenge_members m JOIN challenges c ON c.id = m.challenge_id JOIN users u ON u.id = m.user_id WHERE c.status = 'closed' AND m.status = 'joined' AND m.emailed_at IS NULL").all<Record<string, unknown>>();
  for (const w of waiting) {
    const email = w.email as string;
    if (deps.skip?.(email)) continue;
    const claimed = await deps.db.prepare('UPDATE challenge_members SET emailed_at = ? WHERE challenge_id = ? AND user_id = ? AND emailed_at IS NULL').bind(now, w.challenge_id as string, w.user_id as string).run();
    if (claimed.meta.changes === 0) continue;
    try {
      const view = (await new ChallengeData(deps.db, w.user_id as string, () => now).list()).find((c) => c.id === w.challenge_id);
      if (!view) continue;
      await deps.mailer.send(resultsMail(email, view));
      out.emailed++;
    } catch (e) {
      await deps.db.prepare('UPDATE challenge_members SET emailed_at = NULL WHERE challenge_id = ? AND user_id = ?').bind(w.challenge_id as string, w.user_id as string).run();
      out.failed++;
      console.error('challenge email', e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
