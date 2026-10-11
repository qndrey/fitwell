// Generates the app icons from one SVG mark: a leaf (food) whose vein is a rising pulse line (training).
// Run: npx tsx scripts/make-icons.ts   (renders the PNGs with Playwright's Chromium)
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SAGE = '#3d6b5c';
const CREAM = '#faf8f5';

/** The leaf and pulse in a 64×64 box, scaled about the centre (smaller for maskable icons, which get cropped to a circle). */
function mark(scale = 1): string {
  return `<g transform="translate(32 32) scale(${scale}) translate(-32.5 -31.5)">
  <path d="M15 49 C 14 30, 27 16, 50 14 C 50 36, 37 49, 15 49 Z" fill="${CREAM}"/>
  <path d="M17 47 L 26 38 L 29 42 L 34 31 L 37 35 L 44 21" fill="none" stroke="${SAGE}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;
}

/** Rounded tile for the favicon and "any" icons; full-bleed square where the platform applies its own mask. */
const svg = (opts: { rounded: boolean; scale?: number }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"${opts.rounded ? ' rx="14"' : ''} fill="${SAGE}"/>${mark(opts.scale)}</svg>\n`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
async function png(file: string, size: number, source: string) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const rounded = svg({ rounded: true });
writeFileSync('public/favicon.svg', rounded);
await png('public/icon-192.png', 192, rounded);
await png('public/icon-512.png', 512, rounded);
await png('public/icon-maskable-512.png', 512, svg({ rounded: false, scale: 0.8 }));
await png('public/apple-touch-icon.png', 180, svg({ rounded: false, scale: 0.9 }));
await browser.close();
