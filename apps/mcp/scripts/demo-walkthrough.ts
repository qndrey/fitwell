// Records the walkthrough video: the five things OpenAI's reviewers are asked to try (see directory/openai/SUBMISSION.md), one after the other,
// each under the prompt that opens it, in the real views the way an assistant embeds them. Same set-up as demo-video.ts: the demo person's data
// in the local database, `npm run dev` and `npm run dev:host` running (HOST_URL / MCP_UPSTREAM if they are not on the default ports).
// Writes apps/landing/site/public/demo/fitwell-walkthrough.webm (served at https://fitwell.fyi/demo/fitwell-walkthrough.webm) and its poster.
// Run: npx tsx scripts/demo-walkthrough.ts
import { chromium, type Frame, type Locator, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = process.env.HOST_URL ?? 'http://127.0.0.1:8788';
const OUT = process.env.VIDEO_OUT ?? '../landing/site/public/demo';
const WIDTH = 398; // CSS px of the view, as in the screenshots
const HEIGHT = 600;
const BAR = 64; // the prompt above the view
const SCALE = 2;
const startedAt = Date.now();
const DB_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const sqlite = (sql: string) => {
  const file = readdirSync(DB_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (!file) throw new Error('no local database');
  execFileSync('sqlite3', [join(DB_DIR, file), sql]);
};
const backdate = (minutes: number) => sqlite(`update workouts set started_at = started_at - ${minutes * 60_000} where created_at >= ${startedAt} and finished_at is null;`);
const cleanUp = () => sqlite(`delete from workouts where created_at >= ${startedAt}; delete from food_entries where created_at >= ${startedAt};`);

function ffmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  const dir = readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().pop();
  const bin = dir && readdirSync(join(root, dir)).find((f) => f.startsWith('ffmpeg-'));
  if (!dir || !bin) throw new Error(`no ffmpeg in ${root}: run npx playwright install ffmpeg`);
  return join(root, dir, bin);
}

interface Driver {
  frame: Frame;
  page: Page;
  card: Locator;
  tap: (target: Locator) => Promise<void>;
  beat: (ms?: number) => Promise<void>;
  tapAny: (names: (string | RegExp)[]) => Promise<boolean>;
  text: () => Promise<string>;
}
interface Scene {
  prompt: string;
  view: string;
  args: Record<string, unknown>;
  script: (d: Driver) => Promise<void>;
}

// The tap ripple of demo-video.ts, plus the prompt bar: a chat message above the view.
const PAGE_SETUP = (prompt: string) => `
(() => {
  const style = document.createElement('style');
  style.textContent = '@keyframes tap{from{transform:translate(-50%,-50%) scale(.3);opacity:.55}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}'
    + '.tap{position:fixed;width:44px;height:44px;border-radius:50%;background:#d9822b;pointer-events:none;z-index:9;animation:tap .55s ease-out forwards}'
    + 'html{zoom:${SCALE}} body{padding:${BAR}px 0 0!important;margin:0!important;display:block!important;background:#faf8f5!important}'
    + 'iframe{border:0!important;border-radius:0!important;max-width:none!important;width:${WIDTH}px!important;height:${HEIGHT}px!important;display:block} body>p,ol{display:none!important}'
    + '#prompt{position:fixed;top:0;left:0;right:0;height:${BAR}px;box-sizing:border-box;padding:0 16px;display:flex;align-items:center;background:#f1ede7;border-bottom:1px solid #ddd6cc;font:15px/1.3 system-ui,-apple-system,sans-serif;color:#1f1d1a}'
    + '#prompt span{background:#5a5650;color:#faf8f5;border-radius:16px;padding:8px 14px;max-width:100%}';
  document.head.append(style);
  const bar = document.createElement('div');
  bar.id = 'prompt';
  const msg = document.createElement('span');
  msg.textContent = ${JSON.stringify(prompt)};
  bar.append(msg);
  document.body.append(bar);
  window.__tap = (x, y) => {
    const dot = document.createElement('div');
    dot.className = 'tap';
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    document.body.append(dot);
    setTimeout(() => dot.remove(), 700);
  };
})();`;

const squat = (o: Record<string, unknown> = {}) => ({ id: 'ex:Barbell_Squat', sets: 2, reps: 5, weight_kg: 87.5, rest_sec: 6, warmup: false, ...o });
const WORKOUT_A = {
  name: 'Workout A',
  exercises: [squat(), { id: 'ex:Pullups', sets: 1, reps: 8, rest_sec: 6 }, { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: 1, reps: 8, weight_kg: 60, rest_sec: 6, warmup: false }],
};
const BUTTONS = [/^Skip rest$/, /^(Start|Continue):/, /^Log set/, /^Log cardio$/];
const openCard = (name: string) => async (d: Driver) => {
  await d.tap(d.frame.getByRole('button', { name: new RegExp(`^${name}, \\d+ of \\d+$`) }));
  await d.beat(2600);
};

const SCENES: Scene[] = [
  {
    prompt: 'How am I doing?',
    view: 'dashboard',
    args: { days: 90 },
    script: async (d) => {
      await d.beat(2600);
      await openCard('Nutrition')(d);
      await openCard('Training')(d);
      await openCard('Weight')(d);
    },
  },
  {
    prompt: 'Log lunch: 80 g of rolled oats and 120 g of rye bread',
    view: 'food',
    args: { slot: 'lunch', items: [{ food_id: 'frida:59', grams: 80 }, { food_id: 'frida:413', grams: 120 }] },
    script: async (d) => {
      await d.beat(5000);
    },
  },
  {
    prompt: 'Start Workout A',
    view: 'workout',
    args: WORKOUT_A,
    script: async (d) => {
      await d.beat(2200);
      await d.tapAny([/^(Start|Continue):/]);
      await d.beat(1800);
      await d.tapAny([/^Log set/]);
      await d.beat(2600);
      await d.tapAny([/^Skip rest$/]);
      await d.beat(1200);
      for (let i = 0; i < 30 && !/Finish and send to/.test(await d.text()); i++) {
        await d.tapAny(BUTTONS);
        await d.beat(1100);
      }
      await d.beat(1500);
      backdate(45);
      await d.tapAny([/^Finish and send to/]);
      await d.beat(3500);
    },
  },
  {
    prompt: 'Show me the shopping list for next week, for two people',
    view: 'shopping',
    args: { people: 2 },
    script: async (d) => {
      await d.beat(2200);
      const boxes = d.frame.getByRole('checkbox');
      for (let i = 0, ticked = 0; i < 12 && ticked < 3; i++) {
        const box = boxes.nth(i);
        if ((await box.getAttribute('aria-checked')) === 'true') continue;
        await d.tap(box);
        ticked++;
        await d.beat(900);
      }
      await d.beat(2000);
    },
  },
  {
    prompt: 'How do I use the leg press?',
    view: 'exercise',
    args: { query: 'leg press' },
    script: async (d) => {
      await d.beat(2600);
      for (let i = 0; i < 4; i++) {
        await d.frame.evaluate(`window.scrollBy({ top: 260, behavior: 'smooth' })`);
        await d.beat(1700);
      }
    },
  },
];

async function play(scene: Scene, page: Page) {
  const q = new URLSearchParams({ view: scene.view, theme: 'light', args: JSON.stringify(scene.args) });
  await page.goto(`${HOST}/?${q}`);
  await page.addScriptTag({ content: PAGE_SETUP(scene.prompt) });
  const iframe = page.locator('#view');
  await iframe.waitFor();
  const frame = (await (await iframe.elementHandle())!.contentFrame())!;
  await frame.locator('#app').waitFor();
  await expect(frame.locator('#app')).not.toContainText(/^\s*Loading/, { timeout: 15000 });
  const card = frame.locator('section.pcard:not([inert])');
  const tap = async (target: Locator) => {
    const box = await target.boundingBox();
    if (box) await page.evaluate(([x, y]) => (globalThis as unknown as { __tap(x: number, y: number): void }).__tap(x!, y!), [box.x + box.width / 2, box.y + box.height / 2]);
    await page.waitForTimeout(160);
    await target.evaluate((el) => (el as unknown as { click(): void }).click());
  };
  const driver: Driver = {
    frame,
    page,
    card,
    tap,
    beat: (ms = 1000) => page.waitForTimeout(ms),
    tapAny: async (names) => {
      for (const name of names) {
        const b = card.getByRole('button', { name }).first();
        if (await b.isVisible().catch(() => false)) {
          await tap(b);
          return true;
        }
      }
      return false;
    },
    text: () => card.innerText(),
  };
  await page.waitForTimeout(1200); // 3D bodies and charts settle
  await scene.script(driver);
}

const tmp = mkdtempSync(join(tmpdir(), 'fitwell-walkthrough-'));
const process_ = process;
process_.on('SIGINT', () => { cleanUp(); process_.exit(130); });
try {
  cleanUp();
  mkdirSync(OUT, { recursive: true });
  const size = { width: WIDTH * SCALE, height: (HEIGHT + BAR) * SCALE };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, colorScheme: 'light', recordVideo: { dir: tmp, size } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 300)));
  for (const scene of SCENES) {
    console.log('scene:', scene.prompt);
    await play(scene, page);
  }
  const video = page.video()!;
  await context.close();
  const raw = join(tmp, 'raw.webm');
  await video.saveAs(raw);
  const file = join(OUT, 'fitwell-walkthrough.webm');
  execFileSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-an', '-pix_fmt', 'yuv420p', file]);
  execFileSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.5', '-i', raw, '-frames:v', '1', join(OUT, 'fitwell-walkthrough-poster.png')]);
  await browser.close();
  console.log('wrote', file);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  cleanUp();
}
