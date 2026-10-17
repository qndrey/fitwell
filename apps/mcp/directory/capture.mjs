/* global process, console, document -- a Node script; document is used inside page.waitForFunction (runs in the browser) */
// Captures each Fitwell view from the local dev host as a PNG, cropped to the view itself, at 3x scale.
// Usage (see README.md here): node directory/capture.mjs <folder with playwright-core installed> directory
const [, , pwDir, outDir] = process.argv;
const { chromium } = await import(`${pwDir}/node_modules/playwright-core/index.mjs`);

const VIEWS = [
  { name: '1-workout-player', query: 'view=workout&sample=a2', cutBottom: 46 },
  { name: '2-dashboard', query: 'view=dashboard', maxH: 1022 },
  { name: '3-weekly-review', query: 'view=review', maxH: 966 },
  { name: '4-shopping-list', query: 'view=shopping', maxH: 1088 },
  { name: '5-exercise-guide', query: 'view=exercise&q=leg%20press', maxH: 752, settle: 6000 },
];

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 520, height: 1400 }, deviceScaleFactor: 3, colorScheme: 'light' });
for (const v of VIEWS) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:8788/?theme=light&${v.query}`);
  await page.waitForFunction(() => [...document.querySelectorAll('#log li')].some((l) => l.textContent.includes('initialized')), null, { timeout: 30000 });
  await page.waitForTimeout(v.settle ?? 2500);
  const box = await page.locator('#view').boundingBox();
  const clip = { x: box.x + 1, y: box.y + 1, width: box.width - 2, height: Math.min(box.height - (v.cutBottom ?? 0), v.maxH ?? Infinity) - 2 };
  await page.screenshot({ path: `${outDir}/${v.name}.png`, clip });
  console.log(v.name, Math.round(clip.width * 3), 'x', Math.round(clip.height * 3), errors.length ? `errors: ${errors.join(' | ')}` : '');
  await page.close();
}
await browser.close();
