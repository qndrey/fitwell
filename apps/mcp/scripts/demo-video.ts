// Records the demo videos of the About page (apps/landing/site/src/assets/demo-<name>-light.webm and -dark.webm): a person works through a
// workout in the real player, the way Claude embeds it. Same set-up as screenshots.ts: the demo person's data in the local database,
// `npm run dev` (wrangler) and `npm run dev:host` running (HOST_URL if the host is not on :8788).
// Each recording is re-encoded small (about a quarter of what Playwright writes) and its first screen saved as demo-<name>-poster-<theme>.png, with
// the ffmpeg that Playwright installs (FFMPEG=path to use another one).
// Run: npx tsx scripts/demo-video.ts [name ...]     (no names = all demos, each in light and dark; names as listed in DEMOS)
import { chromium, type Frame, type Locator, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = process.env.HOST_URL ?? 'http://127.0.0.1:8788';
const OUT = process.env.VIDEO_OUT ?? '../landing/site/src/assets';
const WIDTH = 398; // CSS px of the view, as in the screenshots
const HEIGHT = 600; // what the player is built to fit in a host
const SCALE = 2; // the video is recorded at CSS pixel size, so the host page is zoomed instead of using a device scale factor
const startedAt = Date.now();
const DB_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const sqlite = (sql: string) => {
  const file = readdirSync(DB_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (!file) throw new Error('no local database');
  execFileSync('sqlite3', [join(DB_DIR, file), sql]);
};
/** The workout's duration is computed on the server from its stored start: make the workout in progress start that many minutes ago. */
const backdate = (minutes: number) => sqlite(`update workouts set started_at = started_at - ${minutes * 60_000} where created_at >= ${startedAt} and finished_at is null;`);
const cleanUp = () => sqlite(`delete from workouts where created_at >= ${startedAt}; delete from food_entries where created_at >= ${startedAt};`);

/** Playwright's own ffmpeg: it is in the browsers folder, whichever version is installed. */
function ffmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  const dir = readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().pop();
  const bin = dir && readdirSync(join(root, dir)).find((f) => f.startsWith('ffmpeg-'));
  if (!dir || !bin) throw new Error(`no ffmpeg in ${root}: run npx playwright install ffmpeg`);
  return join(root, dir, bin);
}

type Theme = 'light' | 'dark';
interface Demo {
  name: string;
  view: string;
  args: Record<string, unknown>;
  /** What happens in the view once it has loaded; `tap` clicks with a visible ripple, `beat` waits like a person looking at the screen. */
  script: (d: Driver) => Promise<void>;
}
interface Driver {
  frame: Frame;
  page: Page;
  card: Locator;
  tap: (target: Locator) => Promise<void>;
  beat: (ms?: number) => Promise<void>;
  /** Taps the first of these buttons that is on the card in view; false when none is. */
  tapAny: (names: (string | RegExp)[]) => Promise<boolean>;
  text: () => Promise<string>;
  /** The recording lasts seconds, the workout it shows 45 minutes: the summary says what it was. */
  backdate: (minutes: number) => void;
}

// A tap ripple drawn on the host page over the iframe: the click itself is a script click inside the view (see screenshots.ts for why),
// which shows nothing, and a video of buttons that press themselves is hard to follow.
const RIPPLE = `
(() => {
  const style = document.createElement('style');
  style.textContent = '@keyframes tap{from{transform:translate(-50%,-50%) scale(.3);opacity:.55}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}'
    + '.tap{position:fixed;width:44px;height:44px;border-radius:50%;background:#d9822b;pointer-events:none;z-index:9;animation:tap .55s ease-out forwards}'
    + 'html{zoom:${SCALE}} body{padding:0!important;margin:0!important;display:block!important} iframe{border:0!important;border-radius:0!important;max-width:none!important;width:${WIDTH}px!important;height:${HEIGHT}px!important;display:block} body>p,ol{display:none!important}';
  document.head.append(style);
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
const FULL = {
  name: 'Full body',
  exercises: [squat(), { id: 'ex:Pullups', sets: 1, reps: 8, rest_sec: 6 }, { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: 1, reps: 8, weight_kg: 60, rest_sec: 6, warmup: false, notes: 'Pause on the chest' }],
};
const BUTTONS = [/^Skip rest$/, /^(Start|Continue):/, /^Log set/, /^Log cardio$/];

export const DEMOS: Demo[] = [
  {
    // From the overview to the summary: start, a set with the rest after it, the next exercises, finish.
    name: 'workout',
    view: 'workout',
    args: FULL,
    script: async (d) => {
      await d.beat(2200); // the overview: today's plan with last time's numbers
      await d.tapAny([/^(Start|Continue):/]);
      await d.beat(2000); // the squat card: the suggested weight and reps
      await d.tapAny([/^Log set/]);
      await d.beat(3200); // the rest running, with what comes next
      await d.tapAny([/^Skip rest$/]);
      await d.beat(1500);
      for (let i = 0; i < 30 && !/Finish and send to Claude/.test(await d.text()); i++) {
        await d.tapAny(BUTTONS);
        await d.beat(1300);
      }
      await d.beat(1800); // the Finish card
      d.backdate(45);
      await d.tapAny([/^Finish and send to Claude$/]);
      await d.beat(3500); // the summary
    },
  },
];

async function record(demo: Demo, theme: Theme, tmp: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: WIDTH * SCALE, height: HEIGHT * SCALE }, colorScheme: theme, recordVideo: { dir: tmp, size: { width: WIDTH * SCALE, height: HEIGHT * SCALE } } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 300)));
  const q = new URLSearchParams({ view: demo.view, theme, args: JSON.stringify(demo.args) });
  await page.goto(`${HOST}/?${q}`);
  await page.addScriptTag({ content: RIPPLE });
  const iframe = page.locator('#view');
  await iframe.waitFor();
  const frame = (await (await iframe.elementHandle())!.contentFrame())!;
  await frame.locator('#app').waitFor();
  await expect(frame.locator('#app')).not.toContainText(/^\s*Loading/, { timeout: 15000 });
  const card = frame.locator('section.pcard:not([inert])');
  const tap = async (target: Locator) => {
    const box = await target.boundingBox();
    if (box) await page.evaluate(([x, y]) => (globalThis as unknown as { __tap(x: number, y: number): void }).__tap(x!, y!), [box.x + box.width / 2, box.y + box.height / 2]);
    await page.waitForTimeout(160); // the ripple is seen before the screen changes
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
    backdate,
  };
  await page.waitForTimeout(1200); // 3D bodies and charts settle
  await demo.script(driver);
  const video = page.video()!;
  await context.close(); // the file is complete once the page has closed
  const file = join(OUT, `demo-${demo.name}-${theme}.webm`);
  const raw = join(tmp, `raw-${demo.name}-${theme}.webm`);
  await video.saveAs(raw);
  execFileSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-an', '-pix_fmt', 'yuv420p', file]);
  // The poster is what shows before the video loads and when it does not play: the screen it starts on.
  execFileSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1.5', '-i', raw, '-frames:v', '1', join(OUT, `demo-${demo.name}-poster-${theme}.png`)]);
  await browser.close();
  console.log('wrote', file);
}

const wanted = process.argv.slice(2);
const stop = (code: number) => () => {
  cleanUp();
  process.exit(code);
};
process.on('SIGINT', stop(130));
process.on('SIGTERM', stop(143));
const tmp = mkdtempSync(join(tmpdir(), 'fitwell-demo-'));
try {
  cleanUp();
  if (!existsSync(OUT)) throw new Error(`${OUT} does not exist`);
  for (const demo of DEMOS.filter((x) => !wanted.length || wanted.includes(x.name))) {
    for (const theme of ['light', 'dark'] as const) {
      await record(demo, theme, tmp);
      cleanUp(); // the next recording must not see this one's workout as history
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
  cleanUp();
}
