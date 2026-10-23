// Regenerates the screenshots of the About page (apps/landing/site/src/assets) from the views, the way Claude embeds them.
// Needs the demo person's data in the local database, `npm run dev` (wrangler, :8787) and `npm run dev:host` (:8788) running.
// Run: npx tsx scripts/screenshots.ts [name ...]     (no names = all shots, each in light and dark; names as listed in SHOTS and PAGES)
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { codePage, emailPage, page } from '../src/auth/pages';
import { importPageBody } from '../src/import/routes';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HOST = process.env.HOST_URL ?? 'http://127.0.0.1:8788';
const OUT = process.env.SHOTS_OUT ?? '../landing/site/src/assets';
const WIDTH = 398; // CSS px of the view; images are 2x
const startedAt = Date.now();
const DB_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const sqlite = (sql: string) => {
  const file = readdirSync(DB_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (!file) throw new Error('no local database');
  execFileSync('sqlite3', [join(DB_DIR, file), sql]);
};

type Theme = 'light' | 'dark';
interface Shot {
  name: string;
  /** The dev host view and its query: ?view=...&args=... Every shot is taken in both themes: <name>-light.png and <name>-dark.png. */
  view: string;
  args?: Record<string, unknown>;
  sample?: string;
  /** Screenshot only this element of the view (a CSS selector) instead of the whole view. */
  only?: string;
  /** Cut the whole-view shot after the last top-level block that ends within this many CSS px, so the image ends on a block boundary. */
  fitTo?: number;
  /** Cut the whole-view shot at exactly this many CSS px (for a view that is one tall card). */
  clip?: number;
  /** Cut the whole-view shot where the view's content ends, not where the host frame does (a short view in the 600 px dev frame). */
  trim?: boolean;
  /** Steps run in the view before the shot. */
  steps?: (f: Frame, page: Page) => Promise<void>;
  /** Makes the dev host fail these calls: ?fail=log, send or finish. */
  fail?: string;
  /** Calorie goal to have while shooting. */
  kcalGoal?: number;
  /** Also save the image under these names. */
  copyTo?: string[];
}

/** The card in view: the player draws every card, and the ones off screen are inert, so text checks and clicks look only here. */
const card = (f: Frame) => f.locator('section.pcard:not([inert])');
// A script click instead of a pointer click: Playwright scrolls the card to "centre" a button that sits at its edge (the dock), which no
// finger does, and the shot would show a card scrolled by the tool.
const click = (f: Frame, name: string | RegExp, exact = true) => card(f).getByRole('button', { name, exact }).first().evaluate((el) => (el as unknown as { click(): void }).click());
const bodyText = (f: Frame) => card(f).innerText();
const PAUSE = 750; // longer than the player's tap guard after a state change (600 ms)
/** The workout's duration is computed on the server from its stored start: make the workout in progress start that many minutes ago. */
const backdate = (minutes: number) => sqlite(`update workouts set started_at = started_at - ${minutes * 60_000} where created_at >= ${startedAt} and finished_at is null;`);
/** From the Overview: the Start button opens the first exercise's card. */
const start = async (f: Frame, page: Page) => {
  await click(f, /^(Start|Continue):/, false);
  await page.waitForTimeout(PAUSE);
};
/** Logs sets, skips rests and finishes cardio blocks on the card in view until its text matches `done` (at most `max` clicks). */
async function work(f: Frame, page: Page, done: RegExp, max = 40) {
  for (let i = 0; i < max && !done.test(await bodyText(f)); i++) {
    for (const name of [/^Skip rest$/, /^(Start|Continue):/, /^Log set/, /^Log cardio$/]) {
      const b = card(f).getByRole('button', { name }).first();
      if (await b.isVisible().catch(() => false)) {
        await b.evaluate((el) => (el as unknown as { click(): void }).click());
        break;
      }
    }
    await page.waitForTimeout(PAUSE);
  }
}
const GOAL_2300 = 2300;
const squat = (o: Record<string, unknown> = {}) => ({ id: 'ex:Barbell_Squat', sets: 2, reps: 5, weight_kg: 87.5, rest_sec: 90, warmup: false, ...o });
const FULL = {
  name: 'Full body',
  exercises: [squat(), { id: 'ex:Pullups', sets: 1, reps: 8, rest_sec: 90 }, { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: 1, reps: 8, weight_kg: 60, rest_sec: 90, warmup: false, notes: 'Pause on the chest' }],
};
const A2 = {
  name: 'Player features',
  exercises: [squat({ weight_kg: 102.5, warmup: true }), { id: 'ex:Barbell_Curl', sets: 2, reps: 10, weight_kg: 30, rest_sec: 90, superset: 'A' }, { id: 'ex:Triceps_Pushdown', sets: 2, reps: 12, weight_kg: 25, rest_sec: 90, superset: 'A' }, { id: 'ex:Plank', sets: 1, seconds: 10, rest_sec: 90 }],
};
const week = { week_start: '2026-10-05' };
const planWeek = { week_start: '2026-10-19' }; // the demo person's meal plan: the shopping list defaults to next week, which has none
/** Taps a strip segment of the dashboard or the review by the card's name and waits for the swipe to land. */
const openCard = (name: string) => async (f: Frame, page: Page) => {
  await f.getByRole('button', { name: new RegExp(`^${name}, \\d+ of \\d+$`) }).click();
  await page.waitForTimeout(900);
};
const DASH_CARDS = [['weight', 'Weight'], ['nutrition', 'Nutrition'], ['energy', 'Energy'], ['training', 'Training'], ['volume', 'Volume'], ['strength', 'Strength'], ['habits', 'Sleep, steps, water'], ['measures', 'Measures']] as const;
const REVIEW_CARDS = [['week', 'The week', 'The 4 weeks'], ['training-notes', 'Training notes', 'Training notes'], ['nutrition-notes', 'Nutrition notes', 'Nutrition notes'], ['food', 'Food', 'Food'], ['training', 'Training', 'Training'], ['body', 'Body', 'Body'], ['energy', 'Energy', 'Energy'], ['consider', 'To consider', 'To consider']] as const;
/** Every review card, for the week and for the four weeks (names review-<week|month>-<card>). */
const reviewShots: Shot[] = (['week', 'month'] as const).flatMap((period) =>
  REVIEW_CARDS.map(([key, weekName, monthName]): Shot => ({
    name: `review-${period}-${key}`,
    view: 'review',
    args: { week_start: '2026-10-12', period },
    kcalGoal: GOAL_2300,
    steps: async (f, page) => {
      if (period === 'month') {
        await f.getByRole('button', { name: 'Month', exact: true }).click();
        await page.waitForTimeout(900);
      }
      await openCard(period === 'week' ? weekName : monthName)(f, page);
    },
  })),
);
/** Notes Claude wrote (saved for the week or month they are opened for); the same cards for another week show the automatic summary. */
const NOTES = {
  training_note: 'You trained 3 times, on your goal of 3. Barbell Squat and Barbell Bench Press each set a new estimated best. Rest days fell on Tue, Thu and Sun.',
  training_next: 'Repeat this rhythm; add weight on a lift once every set reaches its reps.',
  nutrition_note: 'Calories averaged about 2,350 a day, close to your goal of 2,300, and protein 146 g, above your 140 g goal (reached on 6 of 7 days). Food was logged every day, so the averages are solid.',
  nutrition_next: 'Repeat this week; the 7-day weight average moved −0.4 kg.',
};
const notesShots: Shot[] = [
  { name: 'notes-claude-training', view: 'review', args: { week_start: '2026-10-12', ...NOTES }, kcalGoal: GOAL_2300, steps: openCard('Training notes') },
  { name: 'notes-claude-nutrition', view: 'review', args: { week_start: '2026-10-12', ...NOTES }, kcalGoal: GOAL_2300, steps: openCard('Nutrition notes') },
  { name: 'notes-auto-training', view: 'review', args: { week_start: '2026-10-05' }, kcalGoal: GOAL_2300, steps: openCard('Training notes') },
  { name: 'notes-auto-nutrition', view: 'review', args: { week_start: '2026-10-05' }, kcalGoal: GOAL_2300, steps: openCard('Nutrition notes') },
  { name: 'notes-month-claude', view: 'review', args: { week_start: '2026-10-12', period: 'month', training_note: 'You averaged 3.0 workouts a week against a goal of 3, and 3 of the 4 weeks reached it (from 2 to 4 a week). Six new estimated bests.', training_next: 'Repeat this rhythm.' }, kcalGoal: GOAL_2300, steps: openCard('Training notes') },
  { name: 'notes-month-auto', view: 'review', args: { week_start: '2026-09-14', period: 'month' }, kcalGoal: GOAL_2300, steps: openCard('Nutrition notes') },
];
/** Every dashboard card at 30, 90 and 365 days (names dash<days>-<card>). */
const dashShots: Shot[] = [30, 90, 365].flatMap((days) => DASH_CARDS.map(([key, name]): Shot => ({ name: `dash${days}-${key}`, view: 'dashboard', args: { days }, kcalGoal: GOAL_2300, steps: openCard(name) })));

export const SHOTS: Shot[] = [
  { name: 'dashboard', view: 'dashboard', args: { days: 90 }, kcalGoal: GOAL_2300 },
  { name: 'nutrition', view: 'dashboard', args: { days: 90 }, kcalGoal: GOAL_2300, steps: openCard('Nutrition') },
  { name: 'sleep', view: 'dashboard', args: { days: 90 }, kcalGoal: GOAL_2300, steps: openCard('Sleep, steps, water') },
  { name: 'review', view: 'review', args: week, kcalGoal: GOAL_2300 },
  { name: 'energy', view: 'review', args: week, kcalGoal: 1800, steps: openCard('Energy') },
  // The list as the demo person has it: three items ticked (ticking is saved, so only what is not ticked yet is tapped).
  { name: 'shopping', fitTo: 780, view: 'shopping', args: { ...planWeek, people: 2 }, steps: async (f, page) => { for (const name of ['Potato, raw', 'Broccoli, raw', 'Chicken, breast, flesh and skin, raw']) { const box = f.getByRole('checkbox', { name: new RegExp(`^${name}`) }).first(); if ((await box.getAttribute('aria-checked')) !== 'true') { await box.click(); await page.waitForTimeout(300); } } } },
  { name: 'muscles', clip: 505, view: 'muscles', args: { weeks: 4 } },
  { name: 'lift', view: 'lift', args: { id: 'ex:Barbell_Bench_Press_-_Medium_Grip' } },
  { name: 'lift-90', view: 'lift', args: { id: 'ex:Barbell_Bench_Press_-_Medium_Grip' }, steps: async (f) => { await f.getByRole('button', { name: '90 days', exact: true }).click(); } },
  { name: 'training-30', view: 'dashboard', args: { days: 30 }, steps: openCard('Volume') },
  { name: 'training-90-volume', view: 'dashboard', args: { days: 90 }, steps: async (f, page) => { await openCard('Volume')(f, page); await f.getByRole('button', { name: 'Volume', exact: true }).click(); } },
  { name: 'training-365', view: 'dashboard', args: { days: 365 }, steps: openCard('Volume') },
  { name: 'training-365-volume', view: 'dashboard', args: { days: 365 }, steps: async (f, page) => { await openCard('Volume')(f, page); await f.getByRole('button', { name: 'Volume', exact: true }).click(); } },
  { name: 'review-month', view: 'review', args: week, kcalGoal: GOAL_2300, steps: async (f, page) => { await f.getByRole('button', { name: 'Month', exact: true }).click(); await page.waitForTimeout(800); } },
  { name: 'muscles-recovery', clip: 700, view: 'muscles', args: { weeks: 4 }, steps: async (f, page) => { await f.getByRole('button', { name: 'Days since trained' }).click(); await page.waitForTimeout(800); } },
  { name: 'shopping-undo', view: 'shopping', args: { ...planWeek, people: 2 }, steps: async (f, page) => { await f.getByRole('checkbox').first().click(); await f.getByRole('checkbox').nth(1).click(); await f.getByRole('button', { name: 'Clear ticks' }).click(); await page.waitForTimeout(500); } },
  { name: 'guide-legpress', view: 'exercise', args: { query: 'leg press' } },
  { name: 'guide-squat', clip: 500, view: 'exercise', args: { query: 'barbell squat' } },
  { name: 'overview', view: 'workout', args: FULL },
  // The squat card with its suggested weight, set 1 of 2: the first thing a visitor sees of the player.
  { name: 'hero-squat', trim: true, view: 'workout', args: { ...FULL, exercises: [squat({ weight_kg: undefined }), ...FULL.exercises.slice(1)] }, steps: async (f, page) => { await start(f, page); await f.evaluate(`document.activeElement.blur()`); } },
  // The exercise card of the squat, rest running after set 1 of 2.
  { name: 'player-rest', view: 'workout', args: FULL, steps: async (f, page) => { await start(f, page); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE); } },
  // There is no rest after an exercise's last set (the pager moves on), so the rest zone with its "Next:" line needs a second set to come.
  { name: 'rest-next', view: 'workout', args: { ...FULL, exercises: [squat({ sets: 3 }), ...FULL.exercises.slice(1)] }, steps: async (f, page) => { await start(f, page); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE); } },
  // The "How hard?" line under the set list after a logged working set, with Hard tapped.
  { name: 'effort', view: 'workout', args: { name: 'Squat', exercises: [squat({ sets: 3 })] }, steps: async (f, page) => { await start(f, page); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE); await click(f, 'Hard'); await page.waitForTimeout(300); } },
  // A set that beats last time's best estimate (12 reps): "New best: ..." under the set list.
  { name: 'record-cue', view: 'workout', args: { name: 'Squat', exercises: [squat({ sets: 3 })] }, steps: async (f, page) => { await start(f, page); for (let k = 0; k < 7; k++) await card(f).getByRole('button', { name: /^Increase reps/i }).first().evaluate((el) => (el as unknown as { click(): void }).click()); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE); } },
  // The 3 s after a rest ran out (a 3 s rest): "Rest over" in the zone, "Start set 2" in the dock.
  { name: 'rest-over', view: 'workout', args: { ...FULL, exercises: [squat({ sets: 3, rest_sec: 3 }), ...FULL.exercises.slice(1)] }, steps: async (f, page) => { await start(f, page); await click(f, /^Log set/, false); await page.waitForTimeout(4200); } },
  // A finished exercise (pullups) with the squat still open behind it: "Back to Barbell Squat · 2 sets left" above "Go to ...".
  { name: 'done-back', view: 'workout', args: FULL, steps: async (f, page) => { await start(f, page); await f.getByRole('button', { name: /^Next card/ }).click(); await page.waitForTimeout(PAUSE); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE * 2); await f.getByRole('button', { name: /^Previous card/ }).click(); await page.waitForTimeout(PAUSE); } },
  // The Finish card with sets left, asking before ending: what is not done by exercise, what will be sent, the confirm pair stacked.
  { name: 'finish-open', view: 'workout', args: FULL, steps: async (f, page) => { await start(f, page); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE); for (let k = 0; k < 3; k++) { await f.getByRole('button', { name: /^Next card/ }).click(); await page.waitForTimeout(PAUSE); } await click(f, 'Finish early'); await page.waitForTimeout(300); } },
  // log_set fails (dev host ?fail=log): "not saved" in the row and "1 set not saved." in the header.
  { name: 'save-failed', view: 'workout', args: FULL, fail: 'log', steps: async (f, page) => { await start(f, page); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE * 2); } },
  { name: 'player-summary', view: 'workout', args: FULL, steps: async (f, page) => { await work(f, page, /Finish and send to Claude/); await page.clock.fastForward(45 * 60_000); backdate(45); await click(f, 'Finish and send to Claude'); await page.waitForTimeout(1200); } },
  // Warm-up 1 logged and its rest skipped: warm-up 2 opens with its own ramp values.
  { name: 'warmup', fitTo: 700, view: 'workout', args: { name: 'Squat', exercises: [squat({ weight_kg: 102.5, warmup: true })] }, steps: async (f, page) => { await start(f, page); await click(f, /^Log set/, false); await page.waitForTimeout(PAUSE); await click(f, 'Skip rest'); await page.waitForTimeout(PAUSE); } },
  // The first working set, after the warm-up ramp.
  { name: 'working', view: 'workout', args: { name: 'Squat', exercises: [squat({ weight_kg: 102.5, warmup: true })] }, steps: async (f, page) => { await work(f, page, /Set 1 of 2 · target/); } },
  // The second exercise of the superset, just after the first one's set: "Straight on, no rest".
  { name: 'superset', view: 'workout', args: A2, steps: async (f, page) => { await work(f, page, /Straight on/, 60); } },
  // The hold running: the time left in the zone, Cancel and "Stop · log" in the dock.
  { name: 'timed', view: 'workout', args: { name: 'Core', exercises: [{ id: 'ex:Plank', sets: 1, seconds: 10, rest_sec: 90 }] }, steps: async (f, page) => { await start(f, page); await click(f, /Start a \d+ s timer/, false); await page.waitForTimeout(PAUSE); await click(f, 'Start now'); await page.waitForTimeout(3200); } },
  { name: 'swap', view: 'workout', args: FULL, steps: async (f, page) => { await start(f, page); await click(f, 'Swap'); await page.waitForTimeout(1500); } },
  { name: 'note', view: 'workout', args: FULL, steps: async (f, page) => { await start(f, page); await click(f, 'Note'); await f.locator('textarea').fill('seat 4'); await click(f, 'Save note'); await page.waitForTimeout(300); } },
  { name: 'guide-in-player', view: 'workout', args: FULL, steps: async (f, page) => { await start(f, page); await click(f, 'How to do it'); await page.waitForTimeout(3500); } },
  // The guide with its animation asked for (the shot above shows the written part first).
  { name: 'guide-animation', view: 'workout', args: FULL, steps: async (f, page) => { await start(f, page); await click(f, 'How to do it'); await page.waitForTimeout(800); await click(f, 'Show the animation'); await page.waitForTimeout(3500); } },
  // All four warm-ups logged: one "Warm-ups ✓✓✓✓ 4 done" row above the first working set.
  { name: 'warmups-folded', view: 'workout', args: { name: 'Squat', exercises: [squat({ weight_kg: 140, warmup: true })] }, steps: async (f, page) => { await work(f, page, /Warm-ups\s*[✓–]+/, 12); await page.waitForTimeout(PAUSE); } },
  // More than 8 cards: the strip is one bar with a block marker (second card of the 'many' sample).
  { name: 'many-cards', view: 'workout', sample: 'many', steps: async (f, page) => { await start(f, page); await page.waitForTimeout(PAUSE); } },
  // The cardio finisher card, after the squat's only set.
  { name: 'cardio', view: 'workout', args: { name: 'Squat and run', exercises: [squat({ sets: 1 })], cardio: [{ activity_id: 'act:run-10', minutes: 10, when: 'after', distance_km: 1.5 }] }, steps: async (f, page) => { await work(f, page, /\bMinutes\b/, 6); } },
  { name: 'summary-cardio', view: 'workout', args: { ...FULL, cardio: [{ activity_id: 'act:row-machine', minutes: 5, when: 'before' }, { activity_id: 'act:run-10', minutes: 10, when: 'after', distance_km: 1.5 }] }, steps: async (f, page) => { await work(f, page, /Finish and send to Claude/, 60); await page.clock.fastForward(52 * 60_000); backdate(52); await click(f, 'Finish and send to Claude'); await page.waitForTimeout(1200); } },
  ...dashShots,
  ...reviewShots,
  ...notesShots,
  { name: 'food', view: 'food', args: { day: '2026-10-13', slot: 'lunch', items: [{ food_id: 'frida:59', grams: 80 }, { food_id: 'frida:413', grams: 120 }] }, kcalGoal: GOAL_2300 },
];

async function shoot(page: Page, shot: Shot, theme: Theme) {
  if (shot.kcalGoal) sqlite(`update goals set kcal = ${shot.kcalGoal}, carbs_g = ${Math.round((shot.kcalGoal - 600 - 675) / 4)};`);
  const q = new URLSearchParams({ view: shot.view, theme });
  q.set('maxh', '0'); // the dev host caps the frame at 600 px like Claude does; a shot shows the whole view
  if (shot.sample) q.set('sample', shot.sample);
  if (shot.fail) q.set('fail', shot.fail);
  if (shot.args) q.set('args', JSON.stringify(shot.args));
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`${HOST}/?${q}`);
  await page.addStyleTag({ content: 'iframe{border:0!important;border-radius:0!important} body>p,ol{display:none!important}' });
  const iframe = page.locator('#view');
  await iframe.waitFor();
  const frame = (await (await iframe.elementHandle())!.contentFrame())!;
  await frame.locator('#app').waitFor();
  await expect(frame.locator('#app')).not.toContainText(/^\s*Loading/, { timeout: 15000 });
  await page.waitForTimeout(1200); // 3D bodies and charts settle
  if (shot.steps) await shot.steps(frame, page);
  await page.waitForTimeout(600);
  if ((shot.fitTo || shot.clip || shot.trim) && !shot.only) {
    const cut = shot.trim ? ((await frame.evaluate(`(() => { const r = document.querySelector('main').getBoundingClientRect(); return r.bottom + window.scrollY; })()`)) as number) : shot.clip ?? (await frame.evaluate(
      `((limit) => { let cut = 0; for (const el of document.querySelectorAll('#app > *')) { const b = el.getBoundingClientRect().bottom + window.scrollY; if (b <= limit && b > cut) cut = b; } return cut; })(${shot.fitTo ?? 0})`,
    )) as number;
    const box = (await iframe.boundingBox())!;
    const height = Math.round(shot.clip || shot.trim ? cut : cut > 0 ? cut + 12 : shot.fitTo!);
    const clipped = join(OUT, `${shot.name}-${theme}.png`);
    await page.screenshot({ path: clipped, clip: { x: box.x, y: box.y, width: box.width, height }, animations: 'disabled' });
    console.log('wrote', clipped, `(cut at ${height} px)`);
    for (const other of shot.copyTo ?? []) copyFileSync(clipped, join(OUT, `${other}-${theme}.png`));
    return;
  }
  const target = shot.only ? frame.locator(shot.only) : iframe;
  if (shot.only) await target.scrollIntoViewIfNeeded();
  const path = join(OUT, `${shot.name}-${theme}.png`);
  await target.screenshot({ path, animations: 'disabled' });
  console.log('wrote', path);
  for (const other of shot.copyTo ?? []) copyFileSync(path, join(OUT, `${other}-${theme}.png`));
}

const cleanUp = () => sqlite(`delete from workouts where created_at >= ${startedAt}; delete from food_entries where created_at >= ${startedAt};`); // the shots start workouts and log food
// The sign-in, code and import pages are rendered from the server's own page functions and shot as they are.
const PAGES: { name: string; html: () => Promise<string>; steps?: (page: Page) => Promise<void> }[] = [
  {
    name: 'signin',
    html: async () => (await page(emailPageTitle, emailPage({ clientName: 'Claude', clientDomain: 'claude.ai', redirectHost: 'claude.ai', redirectIsLoopback: false } as ConsentDescription, 'h', { contact: 'hello@fitwell.fyi' }))).text(),
    steps: async (p) => {
      await p.fill('#email', 'you@example.com');
      await p.check('#consent');
    },
  },
  {
    name: 'code',
    html: async () => {
      const c = codePage('h', 'l', 'you@example.com', undefined, 'hello@fitwell.fyi');
      return (await page('Check your email', c.body)).text();
    },
    steps: async (p) => void (await p.fill('#code', '482913')),
  },
  {
    name: 'import',
    html: async () => (await page('Import a Fitwell backup', importPageBody())).text(),
    steps: async (p) => {
      await p.evaluate(`(() => {
        document.getElementById('found').textContent = 'Fitwell backup from 12 October 2026: 640 food entries, 38 workouts, 96 weigh-ins.';
        document.getElementById('status').textContent = 'Done. You can close this page and tell Claude.';
        for (const line of ['640 food entries added', '38 workouts added', '96 weigh-ins added', '1 goal added']) {
          const li = document.createElement('li');
          li.textContent = line;
          document.getElementById('report').append(li);
        }
      })()`);
    },
  },
];
const emailPageTitle = 'Sign in to Fitwell';

const wanted = process.argv.slice(2);
// Shots start workouts and log food: whatever happens (an error, Ctrl-C, a kill), they must not stay in the demo account.
const stop = (code: number) => () => {
  cleanUp();
  process.exit(code);
};
process.on('SIGINT', stop(130));
process.on('SIGTERM', stop(143));
let browser: Browser | undefined;
try {
  cleanUp();
  browser = await chromium.launch();
  if (!existsSync(OUT)) throw new Error(`${OUT} does not exist`);
  for (const [shot, theme] of SHOTS.filter((s) => !wanted.length || wanted.includes(s.name)).flatMap((s) => (['light', 'dark'] as const).map((t) => [s, t] as const))) {
    // A fresh context per shot: the fake clock of one (a workout fast-forwarded 45 minutes) must not leak into the next.
    const context = await browser.newContext({ viewport: { width: WIDTH + 24, height: 900 }, deviceScaleFactor: 2 });
    await context.clock.install();
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 300)));
    await shoot(page, shot, theme);
    await context.close();
    cleanUp(); // the next shot must not see this one's workout as history
  }
  for (const [p, theme] of PAGES.filter((x) => !wanted.length || wanted.includes(x.name)).flatMap((x) => (['light', 'dark'] as const).map((t) => [x, t] as const))) {
    const context = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
    const tab = await context.newPage();
    await tab.setContent(await p.html());
    await p.steps?.(tab);
    await tab.locator('main').screenshot({ path: join(OUT, `${p.name}-${theme}.png`) });
    console.log('wrote', join(OUT, `${p.name}-${theme}.png`));
    await context.close();
  }
} finally {
  await browser?.close().catch(() => undefined);
  cleanUp();
}
