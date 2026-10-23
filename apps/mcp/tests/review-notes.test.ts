// Training notes and Nutrition notes of the review (contracts/review-notes): the arguments and their sanitiser, saving per period,
// the automatic fallback, export and delete.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTO_MAX, autoNotes, NEXT_MAX } from '../src/analytics/reviewNotes';
import type { ReviewNote, WeekReview } from '../src/analytics/reviewTypes';
import { sanitiseNote } from '../src/tools/review';
import { addDays, mondayOf } from '../ui/review/copy';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { fixture } from './support/reviewFixture';

let env: Env;
let client: Client;
let userId: string;
beforeEach(async () => {
  env = createTestEnv().env;
  const ana = await signedInUser(env, 'ana@example.com');
  userId = ana.id;
  client = await connectAs(env, ana);
});

const today = new Date().toISOString().slice(0, 10);
const WEEK = addDays(mondayOf(today), -14); // a week that is over
const OTHER_WEEK = addDays(WEEK, -7);
const show = async (args: Record<string, unknown>) => call(client, 'show_weekly_review', args);
const notesOf = (r: Awaited<ReturnType<typeof show>>) => (r.data as unknown as { review: WeekReview }).review.notes;
const SAVED_ROWS = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM review_notes WHERE user_id = ?').bind(userId).first<{ n: number }>())!.n;

describe('sanitiseNote (AC1)', () => {
  it('omits undefined and empty text, collapses whitespace and newlines, removes control characters', () => {
    expect(sanitiseNote('training_note', undefined, 480)).toEqual({ ok: true, value: null });
    expect(sanitiseNote('training_note', '', 480)).toEqual({ ok: true, value: null });
    expect(sanitiseNote('training_note', ' \n\t ', 480)).toEqual({ ok: true, value: null });
    expect(sanitiseNote('training_note', '\u0007\u0000', 480)).toEqual({ ok: true, value: null });
    expect(sanitiseNote('training_note', '  You trained  3 times.\n\nRest\tdays\u0007 fell on Tue.  ', 480)).toEqual({ ok: true, value: 'You trained 3 times. Rest days fell on Tue.' });
  });

  it('rejects, and names the argument for, text over the limit, markup, links and markdown emphasis', () => {
    expect(sanitiseNote('training_note', 'x'.repeat(612), 480)).toEqual({ ok: false, error: 'training_note is 612 characters; the limit is 480. Shorten it and call again.' });
    expect(sanitiseNote('nutrition_next', 'x'.repeat(141), 140)).toEqual({ ok: false, error: 'nutrition_next is 141 characters; the limit is 140. Shorten it and call again.' });
    expect(sanitiseNote('training_note', 'x'.repeat(480), 480).ok).toBe(true);
    for (const bad of ['a <b>bold</b> claim', 'x > y']) expect(sanitiseNote('training_note', bad, 480)).toEqual({ ok: false, error: 'training_note may not contain < or >.' });
    for (const bad of ['see https://example.com', 'http://x.y', 'at www.example.com', 'HTTPS://X.Y']) expect(sanitiseNote('nutrition_note', bad, 480)).toEqual({ ok: false, error: 'nutrition_note may not contain links.' });
    for (const bad of ['a **bold** word', 'use `code`']) expect(sanitiseNote('nutrition_note', bad, 480)).toEqual({ ok: false, error: 'nutrition_note may not use markdown (** or backticks).' });
  });

  it('counts the length after cleaning, so extra whitespace does not push a note over', () => {
    expect(sanitiseNote('training_note', `${'a '.repeat(240)}\n\n\n   `, 480).ok).toBe(true);
  });
});

describe('the tool arguments (AC1)', () => {
  it('returns an error that names the argument and saves nothing', async () => {
    const over = await show({ week_start: WEEK, training_note: 'x'.repeat(612) });
    expect(over.isError).toBe(true);
    expect(over.text).toBe('training_note is 612 characters; the limit is 480. Shorten it and call again.');
    for (const args of [{ training_note: 'a < b' }, { nutrition_note: 'see https://x.y' }, { nutrition_note: '**x**' }, { training_next: 'Repeat.' }, { nutrition_note: 'Fine.', nutrition_next: 'y'.repeat(141) }]) {
      const res = await show({ week_start: WEEK, ...args });
      expect(res.isError).toBe(true);
    }
    expect((await show({ week_start: WEEK, training_next: 'Repeat.' })).text).toBe('training_note is needed with training_next.');
    expect(await SAVED_ROWS()).toBe(0);
    expect(notesOf(await show({ week_start: WEEK })).training.source).toBe('auto');
  });

  it('treats an empty string as omitted and cleans whitespace before saving', async () => {
    const res = await show({ week_start: WEEK, training_note: '  You trained\n\n3 times.  ', training_next: '', nutrition_note: '' });
    expect(res.isError).toBeFalsy();
    const n = notesOf(res);
    expect(n.training).toMatchObject({ text: 'You trained 3 times.', next: null, source: 'claude' });
    expect(n.nutrition.source).toBe('auto');
  });

  it('puts the notes request in the tool description, word for word, and says so in the server instructions', async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'show_weekly_review')!;
    expect(tool.description).toContain('After you know the numbers, add a short written review for the card: training_note (consistency, progress, recovery, what stands out) with training_next (one option for the coming week)');
    expect(tool.description).toContain('Each note is 2 to 4 sentences and at most 480 characters; each next line is at most 140 characters.');
    expect(tool.description).toContain('Treat weight neutrally: a lower or higher number is neither good nor bad. Never shame, and never call food good or bad.');
    expect(tool.description).toContain('the person can page to other periods and will see saved notes there, or an automatic summary.');
    expect(Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)).toEqual(expect.arrayContaining(['training_note', 'training_next', 'nutrition_note', 'nutrition_next']));
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('training_note');
    expect(instructions).toContain('Training notes and Nutrition notes');
  });
});

describe('saving and reading (AC2)', () => {
  it('is auto without arguments and claude only for text that arrived as arguments', async () => {
    const auto = notesOf(await show({ week_start: WEEK }));
    expect(auto.training.source).toBe('auto');
    expect(auto.nutrition.source).toBe('auto');
    const written = notesOf(await show({ week_start: WEEK, training_note: 'You trained 3 times, on your goal of 3.', training_next: 'Repeat this rhythm.' }));
    expect(written.training).toMatchObject({ text: 'You trained 3 times, on your goal of 3.', next: 'Repeat this rhythm.', source: 'claude' });
    expect(written.nutrition.source).toBe('auto'); // only the training pair was given
  });

  it('returns the saved text for the same period later, and the automatic text for another week or the other period', async () => {
    await show({ week_start: WEEK, training_note: 'Saved for this week.', nutrition_note: 'Nutrition for this week.', nutrition_next: 'One option is a walk after lunch.' });
    const again = (await call(client, 'get_review_data', { week_start: WEEK, period: 'week' })).data as unknown as { review: WeekReview };
    expect(again.review.notes.training).toMatchObject({ text: 'Saved for this week.', source: 'claude' });
    expect(again.review.notes.nutrition).toMatchObject({ text: 'Nutrition for this week.', next: 'One option is a walk after lunch.', source: 'claude' });
    expect(notesOf(await show({ week_start: OTHER_WEEK })).training.source).toBe('auto');
    const month = (await call(client, 'get_review_data', { week_start: WEEK, period: 'month' })).data as unknown as { review: WeekReview };
    expect(month.review.notes.training.source).toBe('auto');
  });

  it('keeps a month apart from a week, keyed by its first Monday', async () => {
    await show({ week_start: WEEK, period: 'month', training_note: 'A month note.' });
    const month = (await call(client, 'get_review_data', { week_start: WEEK, period: 'month' })).data as unknown as { review: WeekReview };
    expect(month.review.notes.training).toMatchObject({ text: 'A month note.', source: 'claude' });
    expect(notesOf(await show({ week_start: WEEK })).training.source).toBe('auto');
    const row = await env.DB.prepare('SELECT period, start_day FROM review_notes WHERE user_id = ?').bind(userId).first<{ period: string; start_day: string }>();
    expect(row).toEqual({ period: 'month', start_day: addDays(WEEK, -21) });
  });

  it('replaces the pair on a new write and keeps the other pair', async () => {
    await show({ week_start: WEEK, training_note: 'First.', training_next: 'Next one.', nutrition_note: 'Food first.' });
    await show({ week_start: WEEK, training_note: 'Second.' });
    const n = notesOf(await show({ week_start: WEEK }));
    expect(n.training).toMatchObject({ text: 'Second.', next: null });
    expect(n.nutrition).toMatchObject({ text: 'Food first.', source: 'claude' });
    expect(await SAVED_ROWS()).toBe(1);
  });

  it("never shows one person's notes to another", async () => {
    await show({ week_start: WEEK, training_note: 'Ana only.' });
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    const theirs = (await call(bo, 'show_weekly_review', { week_start: WEEK })).data as unknown as { review: WeekReview };
    expect(theirs.review.notes.training.source).toBe('auto');
  });
});

describe('export and delete (AC5)', () => {
  it('lists the saved notes in the export and leaves no row after the account is deleted', async () => {
    await show({ week_start: WEEK, training_note: 'Exported.', training_next: 'Then this.', nutrition_note: 'Food too.' });
    const exported = (await call(client, 'export_my_data', {})).data as { reviewNotes: { period: string; startDay: string; training: { note: string; next: string | null } | null; nutrition: { note: string } | null }[] };
    expect(exported.reviewNotes).toHaveLength(1);
    expect(exported.reviewNotes[0]).toMatchObject({ period: 'week', startDay: WEEK, training: { note: 'Exported.', next: 'Then this.' }, nutrition: { note: 'Food too.' } });
    await call(client, 'delete_my_account', { confirm: 'delete my account' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM review_notes').first<{ n: number }>())!.n).toBe(0);
  });
});

// ---------- the automatic notes (AC3) ----------
const BANNED = /\b(cheat\w*|guilty|bad|lazy|behind|off track|missed|failed|healthy|unhealthy|great|only|stalled|should|must|need to)\b|!|\bI\b|\p{Extended_Pictographic}/iu;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
function within(note: ReviewNote) {
  expect(sentences(note.text)).toBeLessThanOrEqual(3);
  expect(note.text.length).toBeLessThanOrEqual(AUTO_MAX);
  expect((note.next ?? '').length).toBeLessThanOrEqual(NEXT_MAX);
  expect(note.text).not.toMatch(BANNED);
  expect(note.next ?? '').not.toMatch(BANNED);
  expect(note.source).toBe('auto');
}
const rec = (name: string, now = 105, before = 100) => ({ name, e1rmKg: now, previousKg: before });
const monthDays = Array.from({ length: 28 }, (_, i) => ({ day: addDays('2026-09-21', i), kcal: 2300, proteinG: 140, workout: [0, 2, 4].includes(i % 7) || (i >= 21 && i % 7 === 5) ? ('strength' as const) : null, weighIn: null }));

describe('automatic notes', () => {
  it('a good week: goal met, two new bests, solid logging', () => {
    const n = autoNotes(fixture({ training: { strength: 2, cardio: 1, previousSessions: 3, records: [rec('Barbell Squat'), rec('Barbell Bench Press - Medium Grip')] } }));
    expect(n.training.text).toBe('You trained 3 times, on your goal of 3. Barbell Squat and Barbell Bench Press each set a new estimated best. Rest days fell on Tue, Thu, Sat and Sun.');
    expect(n.training.next).toBe('Repeat this rhythm; add weight on a lift once every set reaches its reps.');
    expect(n.nutrition.text).toBe('Calories averaged about 2,350 a day, close to your goal of 2,300. Protein averaged 146 g, at or above your 140 g goal (reached on 6 of 7 logged days). Food was logged every day, so the averages are solid.');
    expect(n.nutrition.next).toBe('Repeat this week; the 7-day weight average moved −0.4 kg.');
    expect([n.training.lowData, n.nutrition.lowData]).toEqual([false, false]);
    within(n.training);
    within(n.nutrition);
  });

  it('an average week: one workout short, calories over, protein under', () => {
    const n = autoNotes(fixture({ workouts: { 0: 'strength', 3: 'cardio' }, training: { strength: 1, cardio: 1, previousSessions: 3 }, nutrition: { average: { kcal: 2762, protein: 118, carbs: 300, fat: 90 }, daysLogged: 6, proteinReached: 2 } }));
    expect(n.training.text).toBe('You trained 2 of your 3 planned workouts, one fewer than last week. No lift set a new estimated best this week.');
    expect(n.training.next).toBe('A session on Tue or Wed would reach your goal of 3.');
    expect(n.nutrition.text).toBe('Calories averaged about 2,760 a day, about 460 above your goal of 2,300. Protein averaged 118 g, under your 140 g goal (reached on 2 of 6 logged days). Food was logged on 6 of 7 days.');
    expect(n.nutrition.next).toBe('One option is adding a protein-rich item at breakfast.');
    within(n.training);
    within(n.nutrition);
  });

  it('a poor week and thin data say so plainly and infer nothing', () => {
    const n = autoNotes(fixture({ workouts: {}, training: { strength: 0, cardio: 0, previousSessions: 3 }, nutrition: { daysLogged: 2 } }));
    expect(n.training.text).toBe('No workouts logged this week, against your goal of 3.');
    expect(n.training.next).toBe('One short session counts; ask Claude for a 20-minute plan.');
    expect(n.nutrition.text).toBe('Food was logged on 2 of 7 days, so averages would be rough; this week is not summarised.');
    expect(n.nutrition.next).toBe('One option is logging one meal a day for a few days; that keeps the trend readable.');
    expect([n.training.lowData, n.nutrition.lowData]).toEqual([true, true]);
    within(n.training);
    within(n.nutrition);
    expect(autoNotes(fixture({ workouts: {}, training: { strength: 0, cardio: 0, previousSessions: 0, goalPerWeek: null } })).training.text).toBe('No workouts logged this week.');
    expect(autoNotes(fixture({ training: { previousSessions: 0 } })).training).toMatchObject({ text: 'You trained 3 times this week; none were logged the week before, so there is nothing to compare.', lowData: true });
  });

  it('a week in progress speaks of the days so far', () => {
    const base = fixture();
    const n = autoNotes(fixture({ over: { inProgress: true, daysCounted: 4, weekEnd: '2026-10-15', days: base.days.slice(0, 4) }, workouts: { 0: 'strength', 2: 'cardio' }, training: { strength: 1, cardio: 1, previousSessions: 3 }, nutrition: { daysLogged: 4, proteinReached: 3 } }));
    expect(n.training.text).toBe('So far this week (4 days): 2 workouts, goal 3.');
    expect(n.training.next).toBe('Three days are left; a session on Fri or Sat would reach your goal.');
    expect(n.nutrition.text).toBe('So far this week (4 days), calories averaged about 2,350 a day, close to your goal of 2,300. Protein averaged 146 g, at or above your 140 g goal (reached on 3 of 4 logged days). Food was logged every day, so the averages are solid.');
    within(n.training);
    within(n.nutrition);
  });

  it('a month speaks in weeks and compares with the 4 weeks before', () => {
    const n = autoNotes(fixture({ over: { period: 'month', weekStart: '2026-09-21', weekEnd: '2026-10-18', daysCounted: 28, days: monthDays }, nutrition: { daysLogged: 24, previousAverage: { kcal: 2100, protein: 120 }, proteinReached: 20 }, training: { strength: 13, cardio: 0, previousSessions: 10, records: [1, 2, 3, 4, 5, 6].map((i) => rec(`Lift ${i}`)) } }));
    expect(n.training.text).toBe('You averaged 3.3 workouts a week against a goal of 3, and 4 of the 4 weeks reached it (from 3 to 4 a week). Six new estimated bests.');
    expect(n.nutrition.text).toBe('Calories averaged about 2,350 a day, close to your goal of 2,300 (the 4 weeks before: about 2,100). Protein averaged 146 g, at or above your 140 g goal (reached on 20 of 24 logged days). Food was logged on 24 of 28 days.');
    expect(n.nutrition.next).toBe('Repeat this month; the 7-day weight average moved −0.4 kg.');
    within(n.training);
    within(n.nutrition);
  });

  it('mentions four or more training days in a row as a fact, one record with its gain, and fiber only when it is low', () => {
    const n = autoNotes(fixture({ workouts: { 0: 'strength', 1: 'strength', 2: 'strength', 3: 'cardio', 5: 'strength' }, training: { strength: 4, cardio: 1, previousSessions: 4, records: [rec('Plank (static hold)', 107.5, 101.6)] }, nutrition: { goals: { kcal: 2300, proteinG: 140, fiberG: 30, satFatG: null, addedSugarG: null }, average: { kcal: 2354, protein: 146, carbs: 260, fat: 70, extras: { fiber: 20 } } } }));
    expect(n.training.text).toBe('You trained 5 times, above your goal of 3. Plank set a new estimated best (+5.9 kg). You trained on 4 days in a row (Mon to Thu).');
    expect(n.nutrition.text).toContain('; fiber averaged 20 g, under your 30 g target');
    within(n.training);
    within(n.nutrition);
    expect(autoNotes(fixture({ nutrition: { goals: { kcal: 2300, proteinG: 140, fiberG: 30, satFatG: null, addedSugarG: null }, average: { kcal: 2354, protein: 146, carbs: 260, fat: 70, extras: { fiber: 28 } } } })).nutrition.text).not.toContain('fiber');
  });

  it('adds the energy balance only when the burn is known, marks a rough estimate, and drops it before going over 320 characters', () => {
    const en = { expenditureKcal: 2640, confidence: 'low' as const };
    const rough = autoNotes(fixture({ energy: en })).nutrition.text;
    expect(rough).toContain('intake was about 290 kcal under the estimated burn (a rough estimate)');
    expect(autoNotes(fixture({ energy: { expenditureKcal: 2640, confidence: 'high' } })).nutrition.text).toContain('under the estimated burn.');
    expect(autoNotes(fixture()).nutrition.text).not.toContain('burn');
    const long = autoNotes(fixture({ energy: en, nutrition: { goals: { kcal: 2300, proteinG: 140, fiberG: 30, satFatG: null, addedSugarG: 25 }, average: { kcal: 2354, protein: 146, carbs: 260, fat: 70, extras: { fiber: 10, addedSugar: 60 } } } }));
    expect(long.nutrition.text.length).toBeLessThanOrEqual(AUTO_MAX);
  });

  it('chooses the one next line by the biggest gap, in order', () => {
    const energy = { expenditureKcal: 2640, confidence: 'high' as const, suggestedKcal: 2450, direction: 'lose' as const };
    expect(autoNotes(fixture({ nutrition: { daysLogged: 4 } })).nutrition.next).toBe('One option is logging one meal a day for a few days; that keeps the trend readable.');
    expect(autoNotes(fixture({ nutrition: { average: { kcal: 2800, protein: 100, carbs: 1, fat: 1 } } })).nutrition.next).toBe('One option is adding a protein-rich item at breakfast.');
    expect(autoNotes(fixture({ nutrition: { average: { kcal: 2800, protein: 146, carbs: 1, fat: 1 } } })).nutrition.next).toBe('One option is asking Claude whether the goal or the eating pattern fits better.');
    expect(autoNotes(fixture({ energy })).nutrition.next).toBe('One option is a calorie goal of about 2,450; ask Claude to update it.');
    expect(autoNotes(fixture({ weight: { changeKg: null } })).nutrition.next).toBe('Repeat this week.');
  });
});
