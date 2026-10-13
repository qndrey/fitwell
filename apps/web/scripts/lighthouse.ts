// Lighthouse (mobile) against the production build. Fails below the thresholds in TECH_SPEC NFR-9.
// Run: npm run build && npm run lighthouse   (uses Playwright's Chromium; set CHROME_PATH to use another Chrome)
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PORT = 4173;
const URL_ = `http://localhost:${PORT}/`;
const MIN = { performance: 90, accessibility: 95, 'best-practices': 90, seo: 90 } as const;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL_)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

await waitForServer();
const chrome = await launch({ chromePath: process.env.CHROME_PATH ?? chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
try {
  const run = await lighthouse(URL_, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: Object.keys(MIN) });
  const cats = run?.lhr.categories ?? {};
  let failed = false;
  for (const [id, min] of Object.entries(MIN)) {
    const score = Math.round((cats[id]?.score ?? 0) * 100);
    const ok = score >= min;
    if (!ok) failed = true;
    console.log(`${ok ? '✓' : '✗'} ${id}: ${score} (min ${min})`);
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await chrome.kill();
  stop();
}
