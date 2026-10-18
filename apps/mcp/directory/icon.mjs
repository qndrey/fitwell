/* global process, console, document, Buffer -- a Node script; document is used inside the page (page.evaluate) */
// Renders the Fitwell icon: a white bold "F" in Figtree on forest green. Writes PNGs at several sizes and a favicon.ico.
// Usage (from apps/mcp): node directory/icon.mjs <folder with playwright-core and @fontsource-variable/figtree installed> <out dir>
// Then copy favicon.ico, icon-512.png, apple-touch-icon.png and icon.svg to apps/landing/site/public, and regenerate src/icons.ts.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , depsDir, outDir] = process.argv;
const { chromium } = await import(`${depsDir}/node_modules/playwright-core/index.mjs`);
const font = readFileSync(`${depsDir}/node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2`).toString('base64');

// rounded: the favicon (browser tabs show it as is); square: the directory and app icons (platforms round it themselves).
const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="#2f5d50"/>
  <text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Figtree" font-weight="800" font-size="340" fill="#ffffff">F</text>
</svg>`;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
async function render(rounded, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Figtree; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 300 900; }
    html, body { margin: 0; background: transparent; }
    svg { display: block; width: ${size}px; height: ${size}px; }
  </style></head><body>${svg(rounded)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return png;
}

const square512 = await render(false, 512);
writeFileSync(`${outDir}/icon-512.png`, square512);
writeFileSync(`${outDir}/apple-touch-icon.png`, await render(false, 180));
writeFileSync(`${outDir}/icon.svg`, svg(true));

// favicon.ico with PNG entries (supported by every current browser): 16, 32 and 48 px, rounded.
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await render(true, s));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4); // planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync(`${outDir}/favicon.ico`, Buffer.concat([header, ...pngs]));
writeFileSync(`${outDir}/favicon-48.png`, pngs[2]);
await browser.close();
console.log('written', ['icon-512.png', 'apple-touch-icon.png', 'icon.svg', 'favicon.ico'].join(', '));
