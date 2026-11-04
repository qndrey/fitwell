// Records a short video of the milestone page (with its share card) and the crew feed for the Tools page: each under the prompt that opens it, in the real
// built views the way an assistant embeds them, with fixed sample people and numbers. No server or database is needed (the views get fixed data from a
// stand-in host), only `npm run build:ui` first, and Playwright's ffmpeg (`npx playwright install ffmpeg`).
// Writes apps/landing/site/public/demo/fitwell-friends.webm and its poster. Run: npx tsx scripts/demo-friends.ts
import { chromium, type Locator, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Celebration } from '../src/analytics/celebrationTypes';
import type { CrewFeed } from '../src/analytics/crewTypes';
import celebrationHtml from '../src/ui/generated/celebration';
import crewHtml from '../src/ui/generated/crew';

const OUT = process.env.VIDEO_OUT ?? '../landing/site/public/demo';
const WIDTH = 398; // CSS px of the view, as in the screenshots
const HEIGHT = 600;
const BAR = 64; // the prompt above the view
const SCALE = 2;

function ffmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  const dir = readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().pop();
  const bin = dir && readdirSync(join(root, dir)).find((f) => f.startsWith('ffmpeg-'));
  if (!dir || !bin) throw new Error(`no ffmpeg in ${root}: run npx playwright install ffmpeg`);
  return join(root, dir, bin);
}

const milestone: Celebration = {
  kind: 'training_weeks', threshold: 7, achievedAt: '2026-11-02', title: '7 weeks of training', detail: '3 workouts or more each week', atLeast: false, goalKg: null,
  took: [{ label: 'Workouts', value: 23 }, { label: 'Sets', value: 341 }], next: { threshold: 14, remaining: 7, unit: 'week' },
};
const feed: CrewFeed = {
  from: '2026-10-21', to: '2026-11-03',
  friends: [
    { who: { nickname: 'bo.lifts', email: null }, consistency: { trainingWeeks: { current: 7, best: 7, atLeast: false }, loggingDays: { current: 12, best: 20, atLeast: false }, loggingWeeks: { current: 2, best: 3, atLeast: false } } },
    { who: { nickname: 'ana_fit', email: null }, consistency: { trainingWeeks: { current: 3, best: 9, atLeast: false }, loggingDays: { current: 0, best: 4, atLeast: false }, loggingWeeks: { current: 0, best: 1, atLeast: false } } },
    { who: { nickname: 'cy', email: null }, consistency: null },
  ],
  workouts: [
    { id: 'w1', who: { nickname: 'bo.lifts', email: null }, day: '2026-11-02', type: 'strength', title: 'Push day', exercises: ['Barbell Bench Press', 'Overhead Press', 'Dips', 'Triceps Pushdown'], exerciseCount: 6, sets: 18, minutes: 52, kudos: { count: 2, mine: false }, records: [] },
    { id: 'w2', who: { nickname: 'cy', email: null }, day: '2026-11-01', type: 'cardio', title: 'Running', exercises: [], exerciseCount: 0, sets: 0, minutes: 30, kudos: { count: 0, mine: true }, records: [] },
    { id: 'w3', who: { nickname: 'ana_fit', email: null }, day: '2026-10-30', type: 'session', title: 'Pilates', exercises: [], exerciseCount: 0, sets: 0, minutes: 45, kudos: { count: 1, mine: false }, records: [] },
  ],
  yours: [{ id: 'm1', day: '2026-10-30', title: 'Leg day', from: [{ nickname: 'bo.lifts', email: null }, { nickname: 'cy', email: null }] }],
};

// The tap ripple and the prompt bar, as in demo-walkthrough.ts, around one iframe that holds the view.
const HOST = `<!doctype html><html><head><style>
@keyframes tap{from{transform:translate(-50%,-50%) scale(.3);opacity:.55}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}
.tap{position:fixed;width:44px;height:44px;border-radius:50%;background:#d9822b;pointer-events:none;z-index:9;animation:tap .55s ease-out forwards}
html{zoom:${SCALE}} body{padding:${BAR}px 0 0;margin:0;background:#faf8f5}
iframe{border:0;width:${WIDTH}px;height:${HEIGHT}px;display:block}
#prompt{position:fixed;top:0;left:0;right:0;height:${BAR}px;box-sizing:border-box;padding:0 16px;display:flex;align-items:center;background:#f1ede7;border-bottom:1px solid #ddd6cc;font:15px/1.3 system-ui,-apple-system,sans-serif;color:#1f1d1a}
#prompt span{background:#5a5650;color:#faf8f5;border-radius:16px;padding:8px 14px;max-width:100%}
</style></head><body><div id="prompt"><span id="msg"></span></div><iframe id="v" sandbox="allow-scripts"></iframe>
<script>
const f = document.getElementById('v');
window.__send = (m) => f.contentWindow.postMessage(m, '*');
window.addEventListener('message', async (e) => { if (e.source !== f.contentWindow) return; const r = await window.__toHost(e.data); if (r) window.__send(r); });
window.__tap = (x, y) => { const d = document.createElement('div'); d.className = 'tap'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.append(d); setTimeout(() => d.remove(), 700); };
window.__scene = (prompt, html) => { document.getElementById('msg').textContent = prompt; f.srcdoc = html; };
</script></body></html>`;

let current: unknown = null;
async function scene(page: Page, prompt: string, html: string, result: unknown, run: (frame: ReturnType<Page['frameLocator']>) => Promise<void>) {
  current = result;
  await page.evaluate(([p, h]) => (globalThis as unknown as { __scene(p: string, h: string): void }).__scene(p!, h!), [prompt, html]);
  const frame = page.frameLocator('#v');
  await frame.locator('#app').waitFor();
  await page.waitForTimeout(500);
  await run(frame);
}

const tap = async (page: Page, target: Locator) => {
  const box = await target.boundingBox();
  if (box) await page.evaluate(([x, y]) => (globalThis as unknown as { __tap(x: number, y: number): void }).__tap(x!, y!), [box.x + box.width / 2, box.y + box.height / 2]);
  await page.waitForTimeout(160);
  await target.evaluate((el) => (el as unknown as { click(): void }).click());
};
const scrollBy = (page: Page, top: number) => page.frameLocator('#v').locator('html').evaluate((_, y) => (globalThis as unknown as { scrollBy(o: object): void }).scrollBy({ top: y, behavior: 'smooth' }), top);

const tmp = mkdtempSync(join(tmpdir(), 'fitwell-friends-'));
try {
  mkdirSync(OUT, { recursive: true });
  const size = { width: WIDTH * SCALE, height: (HEIGHT + BAR) * SCALE };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, colorScheme: 'light', recordVideo: { dir: tmp, size } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 300)));
  await page.exposeFunction('__toHost', async (msg: { id?: number; method: string; params?: Record<string, unknown> }) => {
    if (msg.method === 'ui/initialize') return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'demo-host', version: '1' }, hostCapabilities: {}, hostContext: { theme: 'light', displayMode: 'inline', platform: 'web' } } };
    if (msg.method === 'ui/notifications/initialized') {
      setTimeout(() => void page.evaluate((r) => (globalThis as unknown as { __send(m: unknown): void }).__send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: r }), current), 0);
      return null;
    }
    if (msg.method === 'tools/call') return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Kudos given.' }], structuredContent: { given: true } } };
    return msg.id !== undefined ? { jsonrpc: '2.0', id: msg.id, result: {} } : null;
  });
  await page.setContent(HOST);
  const result = (data: Record<string, unknown>) => ({ content: [{ type: 'text', text: 'open' }], structuredContent: data });

  console.log('scene: milestone and share card');
  await scene(page, 'Anything to celebrate?', celebrationHtml, result({ celebrations: [milestone] }), async (frame) => {
    await page.waitForTimeout(2800); // the ring draws itself
    await tap(page, frame.getByRole('button', { name: 'Make a card' }));
    await page.waitForTimeout(1200);
    await scrollBy(page, 330);
    await page.waitForTimeout(1500);
    await tap(page, frame.getByRole('button', { name: 'Story 9:16' }));
    await page.waitForTimeout(1300);
    await tap(page, frame.getByRole('button', { name: 'Dark' }));
    await page.waitForTimeout(1500);
    await tap(page, frame.getByRole('checkbox', { name: 'My name' }));
    await page.waitForTimeout(600);
    await frame.getByLabel('Name on the card').fill('ana_fit');
    await page.waitForTimeout(2600);
  });

  console.log('scene: crew feed');
  await scene(page, 'What have my friends been up to?', crewHtml, result({ feed }), async (frame) => {
    await page.waitForTimeout(2800);
    await tap(page, frame.getByRole('button', { name: 'Give kudos to bo.lifts for Push day' }));
    await page.waitForTimeout(1800);
    await scrollBy(page, 330);
    await page.waitForTimeout(2000);
    await scrollBy(page, 330);
    await page.waitForTimeout(2400);
  });

  const video = page.video()!;
  await context.close();
  const raw = join(tmp, 'raw.webm');
  await video.saveAs(raw);
  const file = join(OUT, 'fitwell-friends.webm');
  execFileSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-an', '-pix_fmt', 'yuv420p', file]);
  execFileSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '3.2', '-i', raw, '-frames:v', '1', join(OUT, 'fitwell-friends-poster.png')]);
  await browser.close();
  console.log('wrote', file);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
