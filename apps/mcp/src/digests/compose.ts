// The digest emails (E1): plain facts about the person's own week, in a neutral tone: no praise, no pressure, no shaming of a quiet week.
import type { Mail } from '../auth/mailer';
import type { Progress } from '../analytics/types';
import type { CoachRoster, RosterTrainee } from '../analytics/coachTypes';
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

export interface AssignedInput {
  to: string;
  today: string;
  url: string;
  /** Workouts a coach assigned that are due today or a few days ago and not started. Names and people come from others and are already cleaned. */
  items: { name: string; from: string; dueOn: string }[];
}

/** One morning email when an assigned workout is due: what it is, from whom, and how to start it. No pressure: a workout can be dismissed. */
export function assignedMail(i: AssignedInput): Mail {
  const first = i.items[0]!;
  const lines = [
    i.items.length === 1 ? 'A workout from your coach is waiting.' : `${i.items.length} workouts from your coach are waiting.`,
    '',
    ...i.items.map((a) => `${a.name} (from ${a.from}), ${a.dueOn === i.today ? 'due today' : `due ${weekdayOf(a.dueOn)} ${short(a.dueOn)}`}`),
    '',
    'Ask Claude to start it and it opens in the player. If it does not suit this week, you can ask Claude to dismiss it.',
  ];
  const { text, html } = wrap(lines, ['You get this because you turned on reminders for assigned workouts in Fitwell. To change that, ask Claude, or use the link below.'], i.url);
  return { to: i.to, subject: i.items.length === 1 ? `Fitwell: ${first.name} is ${first.dueOn === i.today ? 'due today' : 'waiting'}` : `Fitwell: ${i.items.length} workouts from your coach`, text, html, headers: headers(i.url) };
}

export interface CoachInput {
  to: string;
  roster: CoachRoster;
  url: string;
}

const traineeName = (t: RosterTrainee) => t.who.nickname ?? t.who.email ?? 'a trainee';

/** One line of facts per trainee, only what the roster already shows the coach (so only what each trainee shares): no praise, no blame. */
function traineeLines(t: RosterTrainee): string[] {
  const w = t.workouts;
  const parts = [w.assigned === 0 ? 'no workout assigned in the last 4 weeks' : `${w.done} of ${w.assigned} assigned workouts done${w.adherencePct === null ? '' : ` (${w.adherencePct} % of what came due)`}`];
  if (w.skipped) parts.push(`${w.skipped} skipped`);
  if (w.overdue) parts.push(`${w.overdue} overdue`);
  const lines = [`${traineeName(t)}: ${parts.join(', ')}.`];
  if (t.lastDone) lines.push(`  Last finished ${short(t.lastDone)}${t.next ? `; next: ${t.next.name}${t.next.dueOn ? `, due ${short(t.next.dueOn)}` : ''}` : ''}.`);
  else if (t.next) lines.push(`  Next: ${t.next.name}${t.next.dueOn ? `, due ${short(t.next.dueOn)}` : ''}.`);
  if (t.program && t.program.sessionsDone !== null && t.program.status === 'running') lines.push(`  Program "${t.program.name}": ${t.program.sessionsDone} of ${t.program.sessionsTotal} sessions done.`);
  if (t.shareFood) lines.push(t.food && t.food.loggedDays > 0 ? `  Food, last 7 days: logged ${t.food.loggedDays}, averaging ${n0(t.food.kcal ?? 0)}${t.food.goalKcal ? ` of ${n0(t.food.goalKcal)}` : ''} kcal and ${n0(t.food.proteinG ?? 0)}${t.food.goalProteinG ? ` of ${n0(t.food.goalProteinG)}` : ''} g protein.` : '  Food, last 7 days: nothing logged.');
  return lines;
}

/** True when there is nothing to tell a coach: nobody has accepted. */
export const noTrainees = (r: CoachRoster): boolean => r.trainees.every((t) => t.status !== 'active');

/** The Monday email to a coach: where each trainee stands. Names come from other people and are only ever shown. */
export function coachMail(i: CoachInput): Mail {
  const active = i.roster.trainees.filter((t) => t.status === 'active');
  const lines = [`Your trainees, as of ${weekdayOf(i.roster.today)} ${short(i.roster.today)}.`, ''];
  for (const t of active) lines.push(...traineeLines(t), '');
  lines.push('For the detail and what to change, ask Claude to show your trainees.');
  const { text, html } = wrap(lines, ['You get this because you turned on the weekly summary of your trainees in Fitwell. Each trainee decides what you see, so a number here is only what they share. To change that, ask Claude, or use the link below.'], i.url);
  return { to: i.to, subject: `Your trainees in Fitwell, ${short(i.roster.today)}`, text, html, headers: headers(i.url) };
}
