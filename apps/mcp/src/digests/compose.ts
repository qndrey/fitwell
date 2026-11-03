// The digest emails (E1): plain facts about the person's own week, in a neutral tone: no praise, no pressure, no shaming of a quiet week.
import type { Mail } from '../auth/mailer';
import type { Progress } from '../analytics/types';
import type { DigestKind } from '../data/digests';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const weekdayOf = (d: string) => WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : '±'}${Math.abs(n).toFixed(1)}`;

export interface Links {
  /** Opens a page that switches this kind off (and a one-click POST target for the List-Unsubscribe header). */
  unsubscribe: string;
  settings: string;
}

/** The unsubscribe link of an email: the secret is the person's alone. */
export const unsubscribeUrl = (publicUrl: string, userId: string, token: string, kind: DigestKind) => `${publicUrl}/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}&k=${kind}`;

const headers = (url: string): Record<string, string> => ({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

function wrap(lines: string[], footer: string[], url: string): { text: string; html: string } {
  const text = [...lines, '', '--', ...footer, `Unsubscribe: ${url}`].join('\n');
  const body = lines.map((l) => (l === '' ? '' : `<p style="margin:8px 0">${escape(l)}</p>`)).join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f1d1a;line-height:1.5;max-width:520px;margin:0 auto;padding:24px">
${body}
<hr style="border:none;border-top:1px solid #ddd6cc;margin:24px 0 12px">
${footer.map((l) => `<p style="margin:4px 0;font-size:13px;color:#6b655d">${escape(l)}</p>`).join('\n')}
<p style="margin:4px 0;font-size:13px"><a href="${escape(url)}" style="color:#6b655d">Unsubscribe</a></p>
</body></html>`;
  return { text, html };
}

export interface WeeklyInput {
  to: string;
  progress: Progress;
  /** Streaks worth a line: runs in progress. */
  streaks: { trainingWeeks: number; loggingDays: number };
  url: string;
}

/** True when there is nothing of this week to tell. */
export const quietWeek = (p: Progress): boolean => p.training.sessions.strength + p.training.sessions.cardio + p.training.sessions.session === 0 && p.nutrition.daysLogged === 0 && p.weight.daily.length === 0;

export function weeklyMail(i: WeeklyInput): Mail {
  const p = i.progress;
  const t = p.training.sessions;
  const total = t.strength + t.cardio + t.session;
  const parts = [t.strength ? `${t.strength} strength` : '', t.cardio ? `${t.cardio} cardio` : '', t.session ? plural(t.session, 'session') : ''].filter(Boolean);
  const lines = [`Your week, ${short(p.from)} to ${short(p.to)}.`, ''];
  lines.push(total > 0 ? `Training: ${plural(total, 'workout')} (${parts.join(', ')})${p.training.goalWorkoutsPerWeek ? `, against your goal of ${p.training.goalWorkoutsPerWeek} a week` : ''}.` : 'Training: no workouts logged this week.');
  const n = p.nutrition;
  if (n.daysLogged > 0 && n.averagePerLoggedDay) {
    const goal = [n.goals.kcal ? `${n0(n.goals.kcal)} kcal` : '', n.goals.proteinG ? `${n0(n.goals.proteinG)} g protein` : ''].filter(Boolean).join(' and ');
    lines.push(`Food: logged on ${n.daysLogged} of 7 days, averaging ${n0(n.averagePerLoggedDay.kcal)} kcal and ${n0(n.averagePerLoggedDay.protein)} g protein on those days${goal ? ` (your goals: ${goal})` : ''}.`);
  } else lines.push('Food: nothing logged this week.');
  if (p.weight.trendKg !== null) lines.push(`Weight: the 7-day average is ${p.weight.trendKg.toFixed(1)} kg${p.weight.trendChangeKg !== null ? ` (${signed(p.weight.trendChangeKg)} kg over the period)` : ''}. One weigh-in is noise; the average is what counts.`);
  const runs = [i.streaks.trainingWeeks > 0 ? `${plural(i.streaks.trainingWeeks, 'week')} of training` : '', i.streaks.loggingDays > 0 ? `${plural(i.streaks.loggingDays, 'day')} of logging` : ''].filter(Boolean);
  if (runs.length) lines.push(`Running now: ${runs.join(', ')}.`);
  lines.push('', 'For the full picture with charts, ask Claude to show your weekly review.');
  const { text, html } = wrap(lines, ['You get this because you turned on the weekly summary in Fitwell. To change that, ask Claude, or use the link below.'], i.url);
  return { to: i.to, subject: `Your week in Fitwell, ${short(p.from)} to ${short(p.to)}`, text, html, headers: headers(i.url) };
}

export interface NudgeInput {
  to: string;
  /** The last day anything was logged, and today (the person's own days). */
  lastDay: string;
  today: string;
  daysAgo: number;
  url: string;
}

export function nudgeMail(i: NudgeInput): Mail {
  const lines = [
    `Nothing logged since ${weekdayOf(i.lastDay)} ${short(i.lastDay)}, ${plural(i.daysAgo, 'day')} ago.`,
    '',
    'Whenever it suits you, tell Claude what you ate or how you trained and it will log it with you. Yesterday counts too. If this is a break you meant to take, that is fine.',
  ];
  const { text, html } = wrap(lines, ['You get this because you turned on a reminder after a few quiet days in Fitwell. To change that, ask Claude, or use the link below.'], i.url);
  return { to: i.to, subject: `Fitwell: nothing logged since ${weekdayOf(i.lastDay)}`, text, html, headers: headers(i.url) };
}
