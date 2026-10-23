// The automatic Training notes and Nutrition notes of a review: a short, descriptive summary built from the review's own numbers by fixed rules
// (no model). Used where Claude saved no note, so a card is never empty. Pure: no I/O. Contract: contracts/review-notes.
import { addDays, type Day } from '@fitwell/core/domain/dates';
import type { ReviewNote, SavedNotes, WeekReview } from './reviewTypes';

type Core = Omit<WeekReview, 'notes'>;

/** An automatic note is at most 3 sentences and this many characters; the next line is at most NEXT_MAX. */
export const AUTO_MAX = 320;
export const NEXT_MAX = 140;

const num = (n: number, digits = 0) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: digits })}`;
const r10 = (n: number) => Math.round(n / 10) * 10;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
const weekday = (d: Day) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const shortName = (name: string) => name.replace(/\s*[-–(].*$/, '').trim();
const list = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
/** "one fewer than last week", "the same as last week", "two more than last week". */
const against = (diff: number, before: string) => (diff === 0 ? `the same as ${before}` : `${word(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} than ${before}`);
const times = (n: number) => (n === 1 ? 'once' : `${n} times`);

const THIN_NUTRITION_NEXT = 'One option is logging one meal a day for a few days; that keeps the trend readable.';
const REPEAT_TRAINING = 'Repeat this rhythm; add weight on a lift once every set reaches its reps.';

interface Sentence {
  /** The sentence without its full stop. */
  core: string;
  /** Clauses that may go if the text is too long; the last of the last sentence goes first. */
  extras?: string[];
}

/** Joins sentences into a note of at most AUTO_MAX characters, dropping optional clauses, last first, until it fits. */
function fit(sentences: Sentence[]): string {
  const extras = sentences.flatMap((s, si) => (s.extras ?? []).map((_, ei) => `${si}:${ei}`));
  for (let dropped = 0; dropped <= extras.length; dropped += 1) {
    const gone = new Set(extras.slice(extras.length - dropped));
    const text = sentences.map((s, si) => `${s.core}${(s.extras ?? []).filter((_, ei) => !gone.has(`${si}:${ei}`)).join('')}.`).join(' ');
    if (text.length <= AUTO_MAX) return text;
  }
  return sentences.map((s) => `${s.core}.`).join(' ');
}

/** Days with a workout per week, for a month (a day with two workouts counts once). */
function weeklyDays(r: Core): number[] {
  const counts: number[] = [];
  for (let i = 0; i < r.days.length; i += 7) counts.push(r.days.slice(i, i + 7).filter((d) => d.workout).length);
  return counts;
}

function trainingNote(r: Core): ReviewNote {
  const t = r.training;
  const month = r.period === 'month';
  const w = month ? 4 : 1;
  const noun = month ? 'month' : 'week';
  const before = month ? 'the 4 weeks before' : 'last week';
  const sessions = t.strength + t.cardio + t.session;
  const goal = t.goalPerWeek ? t.goalPerWeek * w : null;
  const made = (text: string, next: string, lowData = false): ReviewNote => ({ text, next: next.slice(0, NEXT_MAX), source: 'auto', lowData });
  const rest = r.days.filter((d) => !d.workout).map((d) => d.day);
  const daysLeft = 7 * w - r.daysCounted;
  const needed = goal === null ? 0 : Math.max(0, goal - sessions);

  if (r.inProgress) {
    const text = `So far this ${noun} (${r.daysCounted} days): ${sessions === 0 ? 'no workouts logged' : `${sessions} ${sessions === 1 ? 'workout' : 'workouts'}`}${goal ? `, goal ${goal}` : ''}.`;
    const ahead = [addDays(r.weekEnd, 1), addDays(r.weekEnd, 2)].filter((d) => d <= addDays(r.weekStart, 7 * w - 1));
    let next = 'Repeat this rhythm.';
    if (goal && needed > 0 && daysLeft > 0) {
      const left = `${cap(word(daysLeft))} ${daysLeft === 1 ? 'day is' : 'days are'} left`;
      next = needed === 1 && !month ? `${left}; a session on ${list(ahead.map(weekday)).replace(' and ', ' or ')} would reach your goal.` : `${left}; ${word(needed)} more ${needed === 1 ? 'session' : 'sessions'} would reach your goal.`;
    }
    return made(text, next, sessions === 0);
  }

  if (sessions === 0) return made(`No workouts logged this ${noun}${goal ? `, against your goal of ${goal}` : ''}.`, 'One short session counts; ask Claude for a 20-minute plan.', true);

  const nextFor = (): string => {
    if (goal !== null && sessions < goal) {
      if (month) return `A session or two more a week would reach your goal of ${t.goalPerWeek}.`;
      if (needed === 1 && rest.length > 0) return `A session on ${list(rest.slice(0, 2).map(weekday)).replace(' and ', ' or ')} would reach your goal of ${goal}.`;
      return `${cap(word(needed))} more sessions would reach your goal of ${goal}.`;
    }
    return REPEAT_TRAINING;
  };

  if (t.previousSessions === 0) return made(`You trained ${times(sessions)} this ${noun}; none were logged ${month ? 'in the 4 weeks before' : 'the week before'}, so there is nothing to compare.`, nextFor(), true);

  // sentence 1: how many workouts
  const diff = sessions - t.previousSessions;
  let first: string;
  if (month) {
    const perWeek = weeklyDays(r);
    const avg = Math.round((sessions / 4) * 10) / 10;
    first = t.goalPerWeek ? `You averaged ${num(avg, 1)} workouts a week against a goal of ${t.goalPerWeek}, and ${perWeek.filter((n) => n >= t.goalPerWeek!).length} of the 4 weeks reached it (from ${Math.min(...perWeek)} to ${Math.max(...perWeek)} a week).` : `You averaged ${num(avg, 1)} workouts a week, ${against(Math.round(diff / 4), before)}.`;
  } else if (goal !== null) {
    first = sessions >= goal ? `You trained ${times(sessions)}, ${sessions === goal ? 'on' : 'above'} your goal of ${goal}.` : `You trained ${sessions} of your ${goal} planned workouts, ${against(diff, before)}.`;
  } else first = `You trained ${times(sessions)}, ${against(diff, before)}.`;

  // sentence 2: new estimated bests
  const names = t.records.map((x) => shortName(x.name));
  let second: string;
  if (t.records.length === 0) second = `No lift set a new estimated best this ${noun}.`;
  else if (month) second = `${cap(word(t.records.length))} new estimated ${t.records.length === 1 ? 'best' : 'bests'}.`;
  else if (t.records.length === 1) second = `${names[0]} set a new estimated best (+${num(Math.round((t.records[0]!.e1rmKg - (t.records[0]!.previousKg ?? 0)) * 10) / 10, 1)} kg).`;
  else if (t.records.length === 2) second = `${names[0]} and ${names[1]} each set a new estimated best.`;
  else second = `${t.records.length} lifts set new estimated bests.`;

  // sentence 3: a run of training days, else the rest days (a week that is over)
  let third = '';
  if (!month) {
    let run = 0;
    let best = { len: 0, from: '' as Day, to: '' as Day };
    for (const d of r.days) {
      run = d.workout ? run + 1 : 0;
      if (run > best.len) best = { len: run, from: addDays(d.day, -(run - 1)), to: d.day };
    }
    if (best.len >= 4) third = ` You trained on ${best.len} days in a row (${weekday(best.from)} to ${weekday(best.to)}).`;
    else if (rest.length > 0 && rest.length <= 4) third = ` Rest days fell on ${list(rest.map(weekday))}.`;
  }
  const all = [first, second, third.trim()].filter(Boolean).join(' ');
  return made(all.length <= AUTO_MAX ? all : `${first} ${second}`, nextFor());
}

function nutritionNote(r: Core): ReviewNote {
  const n = r.nutrition;
  const month = r.period === 'month';
  const noun = month ? 'month' : 'week';
  const made = (text: string, next: string, lowData = false): ReviewNote => ({ text, next: next.slice(0, NEXT_MAX), source: 'auto', lowData });
  const a = n.average;
  if (!a || n.daysLogged < (month ? 10 : 3)) return made(`Food was logged on ${n.daysLogged} of ${r.daysCounted} days, so averages would be rough; this ${noun} is not summarised.`, THIN_NUTRITION_NEXT, true);

  const g = n.goals;
  const lead = r.inProgress ? `So far this ${noun} (${r.daysCounted} days), calories averaged` : 'Calories averaged';
  let cal = `${lead} about ${num(r10(a.kcal))} a day`;
  const offBand = g.kcal !== null && Math.abs(a.kcal - g.kcal) > g.kcal * 0.1;
  if (g.kcal !== null) cal += offBand ? `, about ${num(r10(Math.abs(a.kcal - g.kcal)))} ${a.kcal > g.kcal ? 'above' : 'below'} your goal of ${num(g.kcal)}` : `, close to your goal of ${num(g.kcal)}`;
  const monthClause = month && n.previousAverage ? ` (the 4 weeks before: about ${num(r10(n.previousAverage.kcal))})` : '';

  let protein = `Protein averaged ${num(Math.round(a.protein))} g`;
  const share = g.proteinG ? a.protein / g.proteinG : null;
  if (g.proteinG && share !== null) protein += `, ${share >= 1 ? 'at or above' : share >= 0.9 ? 'close to' : 'under'} your ${num(g.proteinG)} g goal`;
  if (n.proteinReached !== null && g.proteinG) protein += ` (reached on ${n.proteinReached} of ${n.daysLogged} logged days)`;
  const fiberClause = g.fiberG && a.extras?.fiber !== undefined && a.extras.fiber < g.fiberG * 0.8 ? `; fiber averaged ${num(Math.round(a.extras.fiber))} g, under your ${num(g.fiberG)} g target` : '';
  const sugarClause = g.addedSugarG && a.extras?.addedSugar !== undefined && a.extras.addedSugar > g.addedSugarG ? `; added sugar averaged ${num(Math.round(a.extras.addedSugar))} g, above your ${num(g.addedSugarG)} g limit` : '';

  const logging = n.daysLogged === r.daysCounted ? 'Food was logged every day, so the averages are solid' : `Food was logged on ${n.daysLogged} of ${r.daysCounted} days`;
  const en = r.energy;
  const balance = en.expenditureKcal !== null ? `; intake was about ${num(r10(Math.abs(a.kcal - en.expenditureKcal)))} kcal ${a.kcal < en.expenditureKcal ? 'under' : 'over'} the estimated burn${en.confidence === 'low' ? ' (a rough estimate)' : ''}` : '';

  // optional clauses, the last dropped first when the text is too long
  const text = fit([{ core: cal, extras: [monthClause] }, { core: protein, extras: [fiberClause, sugarClause] }, { core: logging, extras: [balance] }]);

  // the one next line: the biggest gap
  let next: string;
  const loggingLow = n.daysLogged < (month ? 15 : Math.min(5, r.daysCounted));
  if (loggingLow) next = THIN_NUTRITION_NEXT;
  else if (share !== null && share < 0.9) next = 'One option is adding a protein-rich item at breakfast.';
  else if (offBand) next = 'One option is asking Claude whether the goal or the eating pattern fits better.';
  else if (en.expenditureKcal !== null && en.confidence !== 'low' && en.suggestedKcal !== null && g.kcal !== null && Math.abs(en.suggestedKcal - g.kcal) >= 100) next = `One option is a calorie goal of about ${num(r10(en.suggestedKcal))}; ask Claude to update it.`;
  else {
    const change = r.weight.changeKg;
    next = `Repeat this ${noun}${change === null ? '' : change === 0 ? '; the 7-day weight average stayed level' : `; the 7-day weight average moved ${change > 0 ? '+' : '−'}${num(Math.abs(change), 1)} kg`}.`;
  }
  return made(text, next);
}

/** The automatic notes of a review. */
export function autoNotes(r: Core): WeekReview['notes'] {
  return { training: trainingNote(r), nutrition: nutritionNote(r) };
}

/** Claude's saved text where there is some, else the automatic note; `lowData` is always a fact of the numbers. */
export function mergeNotes(auto: WeekReview['notes'], saved: SavedNotes | null): WeekReview['notes'] {
  const one = (a: ReviewNote, s: { note: string; next: string | null } | null | undefined): ReviewNote => (s ? { text: s.note, next: s.next, source: 'claude', lowData: a.lowData } : a);
  return { training: one(auto.training, saved?.training), nutrition: one(auto.nutrition, saved?.nutrition) };
}
