// Regenerates the screenshots of the About page (apps/landing/site/src/assets) from the views, the way Claude embeds them.
// Needs the demo person's data in the local database, `npm run dev` (wrangler, :8787) and `npm run dev:host` (:8788) running.
// Run: npx tsx scripts/screenshots.ts [name ...]     (no names = all shots, each in light and dark; names as listed in SHOTS and PAGES)
import { chromium, type Frame, type Page } from 'playwright';
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
  /** Steps run in the view before the shot. */
  steps?: (f: Frame, page: Page) => Promise<void>;
  /** Calorie goal to have while shooting. */
  kcalGoal?: number;
  /** Also save the image under these names. */
  copyTo?: string[];
}

const click = (f: Frame, name: string | RegExp, exact = true) => f.getByRole('button', { name, exact }).first().click();
const bodyText = (f: Frame) => f.locator('body').innerText();
const PAUSE = 450;
/** The workout's duration is computed on the server from its stored start: make the workout in progress start that many minutes ago. */
const backdate = (minutes: number) => sqlite(`update workouts set started_at = started_at - ${minutes * 60_000} where created_at >= ${startedAt} and finished_at is null;`);
/** Logs sets, skips rests and finishes cardio blocks until `done` matches the page text (at most `max` clicks). */
async function work(f: Frame, page: Page, done: RegExp, max = 40) {
  for (let i = 0; i < max && !done.test(await bodyText(f)); i++) {
    for (const name of ['Skip rest', 'Log set', 'Done']) {
      const b = f.getByRole('button', { name, exact: true }).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click();
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

export const SHOTS: Shot[] = [
  { name: 'dashboard', view: 'dashboard', args: { days: 90 }, kcalGoal: GOAL_2300 },
  { name: 'nutrition', view: 'dashboard', args: { days: 90 }, only: '[aria-label="Nutrition"]', kcalGoal: GOAL_2300 },
  { name: 'sleep', view: 'dashboard', args: { days: 90 }, only: '[aria-label="Sleep, steps and water"]', kcalGoal: GOAL_2300 },
  { name: 'review', view: 'review', args: week, kcalGoal: GOAL_2300 },
  { name: 'energy', view: 'review', args: week, only: '[aria-label="Energy"]', kcalGoal: 1800 },
  { name: 'shopping', view: 'shopping', args: { people: 2 } },
  { name: 'muscles', view: 'muscles', args: { weeks: 4 } },
  { name: 'guide-legpress', view: 'exercise', args: { query: 'leg press' } },
  { name: 'guide-squat', view: 'exercise', args: { query: 'barbell squat' } },
  { name: 'hero-squat', view: 'workout', args: FULL, copyTo: ['player-set'] },
  { name: 'player-rest', view: 'workout', args: FULL, steps: async (f, page) => (await click(f, 'Log set'), page.waitForTimeout(PAUSE), undefined) },
  { name: 'rest-next', view: 'workout', args: { ...FULL, exercises: [squat({ sets: 1 }), ...FULL.exercises.slice(1)] }, steps: async (f, page) => (await click(f, 'Log set'), page.waitForTimeout(PAUSE), undefined) },
  { name: 'player-summary', view: 'workout', args: FULL, steps: async (f, page) => { await work(f, page, /Finish and send to Claude/); await page.clock.fastForward(45 * 60_000); backdate(45); await click(f, 'Finish and send to Claude'); await page.waitForTimeout(1200); } },
  { name: 'warmup', view: 'workout', args: { name: 'Squat', exercises: [squat({ weight_kg: 102.5, warmup: true })] }, steps: async (f, page) => { await click(f, 'Log set'); await page.waitForTimeout(PAUSE); await click(f, 'Skip rest'); await page.waitForTimeout(PAUSE); } },
  { name: 'working', view: 'workout', args: { name: 'Squat', exercises: [squat({ weight_kg: 102.5, warmup: true })] }, steps: async (f, page) => { await work(f, page, /Set 1 of 2/i); } },
  { name: 'superset', view: 'workout', args: A2, steps: async (f, page) => { await work(f, page, /superset/i, 60); } },
  { name: 'timed', view: 'workout', args: { name: 'Core', exercises: [{ id: 'ex:Plank', sets: 1, seconds: 10, rest_sec: 90 }] }, steps: async (f, page) => { await click(f, /Start a \d+ s timer/, false); await page.waitForTimeout(1200); } },
  { name: 'swap', view: 'workout', args: FULL, steps: async (f, page) => { await f.getByText('Swap exercise', { exact: true }).click(); await page.waitForTimeout(1500); } },
  { name: 'note', view: 'workout', args: FULL, steps: async (f, page) => { await click(f, 'Add a note'); await f.locator('textarea').fill('seat 4'); await page.waitForTimeout(300); } },
  { name: 'guide-in-player', view: 'workout', args: FULL, steps: async (f, page) => { await f.getByText('How to do it', { exact: true }).click(); await page.waitForTimeout(3500); } },
  { name: 'cardio', view: 'workout', args: { name: 'Squat and run', exercises: [squat({ sets: 1 })], cardio: [{ activity_id: 'act:run-10', minutes: 10, when: 'after', distance_km: 1.5 }] }, steps: async (f, page) => { await work(f, page, /\bMinutes\b/, 6); } },
  { name: 'summary-cardio', view: 'workout', args: { ...FULL, cardio: [{ activity_id: 'act:row-machine', minutes: 5, when: 'before' }, { activity_id: 'act:run-10', minutes: 10, when: 'after', distance_km: 1.5 }] }, steps: async (f, page) => { await work(f, page, /Finish and send to Claude/, 60); await page.clock.fastForward(52 * 60_000); backdate(52); await click(f, 'Finish and send to Claude'); await page.waitForTimeout(1200); } },
  { name: 'food', view: 'food', args: { day: '2026-10-13', copy_from: { day: '2026-10-12', slot: 'lunch' } }, kcalGoal: GOAL_2300 },
];

async function shoot(page: Page, shot: Shot, theme: Theme) {
  if (shot.kcalGoal) sqlite(`update goals set kcal = ${shot.kcalGoal}, carbs_g = ${Math.round((shot.kcalGoal - 600 - 675) / 4)};`);
  const q = new URLSearchParams({ view: shot.view, theme });
  if (shot.sample) q.set('sample', shot.sample);
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
cleanUp();
const browser = await chromium.launch();
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
await browser.close();
cleanUp();
