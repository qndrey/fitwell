import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST } from '../../manifest';

/** Width, height and colour type straight from a PNG's header (type 2 = RGB, 6 = RGBA). */
function png(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(0, 8).toString('hex'), `${path} is a PNG`).toBe('89504e470d0a1a0a');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colour: b[25]! };
}

describe('installed-app icons (Android and iOS)', () => {
  it('every icon in the manifest exists and is the size it says', () => {
    for (const i of MANIFEST.icons) {
      const file = `public/${i.src}`;
      expect(existsSync(file), file).toBe(true);
      const [w, h] = i.sizes.split('x').map(Number);
      expect(png(file), file).toMatchObject({ w, h });
    }
  });

  it('offers what each Android path needs: any and maskable at 192 and 512, plus a monochrome icon', () => {
    const has = (purpose: string, size: string) => MANIFEST.icons.some((i) => i.purpose === purpose && i.sizes === size);
    for (const size of ['192x192', '512x512']) {
      expect(has('any', size), `any ${size}`).toBe(true);
      expect(has('maskable', size), `maskable ${size}`).toBe(true);
    }
    expect(MANIFEST.icons.some((i) => i.purpose === 'monochrome')).toBe(true);
  });

  it('maskable and touch icons are fully opaque (the launcher or iOS supplies the shape)', () => {
    for (const f of ['icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) expect(png(`public/${f}`).colour, f).toBe(2);
  });

  it('the monochrome icon has transparency to tint', () => {
    expect(png('public/icon-monochrome-512.png').colour).toBe(6);
  });

  it('has a stable id inside its scope', () => {
    expect(MANIFEST.id).toBe(MANIFEST.start_url);
    expect(MANIFEST.scope).toBe('./');
  });

  it('the page head lists PNG icons for Android shortcuts (an SVG favicon alone is not used there)', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/rel="icon"[^>]*icon-192\.png[^>]*sizes="192x192"/);
    expect(html).toMatch(/rel="icon"[^>]*icon-512\.png/);
    expect(html).toMatch(/rel="apple-touch-icon"[^>]*apple-touch-icon\.png/);
  });
});
