// The shared controls of the views (ui/shared/controls.css on tokens.css, ui/shared/icons.ts): every icon is decoration, every button has a name, the three
// controls have the sizes and looks the design language gives them, in light and dark. Bundled with esbuild and run in a real Chromium.
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ICONS } from '../ui/shared/iconShapes';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const js = (await build({ stdin: { contents: "import * as kit from './ui/shared/icons'; (globalThis as any).kit = kit;", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'iife', write: false, target: 'es2022' })).outputFiles[0]!.text;
  const css = (await build({ stdin: { contents: "@import './tokens.css'; @import './controls.css';", resolveDir: 'ui/shared', loader: 'css' }, bundle: true, write: false })).outputFiles[0]!.text;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 398, height: 600 } });
  await page.setContent(`<!doctype html><html lang="en"><head><style>${css}</style></head><body><main id="app"></main></body></html>`);
  await page.addScriptTag({ content: js });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const run = <T>(expression: string) => page.evaluate(expression) as Promise<T>;

describe('icons', () => {
  it('draws every icon as a hidden SVG with shapes in it', async () => {
    const report = await run<{ name: string; hidden: string | null; focusable: string | null; shapes: number; box: string | null }[]>(
      `Object.keys(kit.ICONS).map((name) => { const s = kit.icon(name); return { name, hidden: s.getAttribute('aria-hidden'), focusable: s.getAttribute('focusable'), shapes: s.children.length, box: s.getAttribute('viewBox') }; })`,
    );
    expect(report.map((r) => r.name)).toEqual(Object.keys(ICONS));
    for (const r of report) {
      expect(r.hidden, r.name).toBe('true');
      expect(r.focusable, r.name).toBe('false');
      expect(r.shapes, r.name).toBeGreaterThan(0);
      expect(r.box, r.name).toBe('0 0 24 24');
    }
  });

  it('has the glyphs the views need', () => {
    for (const name of ['chevron-left', 'chevron-right', 'chevron-down', 'x', 'pencil', 'swap', 'book-open', 'skip-forward', 'undo', 'rotate-cw', 'crosshair', 'pause', 'play', 'eye', 'eye-off', 'bars', 'clock', 'external-link', 'message', 'check', 'circle', 'diamond', 'plus', 'minus', 'calendar', 'weight', 'utensils', 'flame', 'dumbbell', 'trending-up', 'list-check', 'ruler', 'thumbs-up', 'heart-pulse', 'clipboard', 'lightbulb']) {
      expect(Object.keys(ICONS), name).toContain(name);
    }
  });

  it('only uses SVG shapes with the attributes they need', () => {
    const needs: Record<string, string[]> = { path: ['d'], polyline: ['points'], line: ['x1', 'y1', 'x2', 'y2'], circle: ['cx', 'cy', 'r'], rect: ['x', 'y', 'width', 'height'] };
    for (const [name, shapes] of Object.entries(ICONS)) {
      for (const [tag, attrs] of shapes) {
        expect(Object.keys(needs), `${name}: ${tag}`).toContain(tag);
        for (const a of needs[tag]!) expect(attrs, `${name}: ${tag} ${a}`).toHaveProperty(a);
      }
    }
  });
});

describe('buttons', () => {
  it('names an icon-only button by its label, as a plain button, with no inline style', async () => {
    const b = await run<{ name: string | null; title: string; type: string; style: string | null; pressed: string | null; cls: string }>(
      `(() => { const b = kit.iconButton('pencil', 'Add a note', () => {}); document.getElementById('app').append(b); return { name: b.getAttribute('aria-label'), title: b.title, type: b.type, style: b.getAttribute('style'), pressed: b.getAttribute('aria-pressed'), cls: b.className }; })()`,
    );
    expect(b).toEqual({ name: 'Add a note', title: 'Add a note', type: 'button', style: null, pressed: null, cls: 'quiet' });
  });

  it('names an icon-and-word button by its word and keeps the icon out of the name', async () => {
    const b = await run<{ name: string | null; text: string; hidden: string | null | undefined }>(
      `(() => { const b = kit.textButton('undo', 'Undo', () => {}); document.getElementById('app').append(b); return { name: b.getAttribute('aria-label'), text: b.textContent, hidden: b.querySelector('svg')?.getAttribute('aria-hidden') }; })()`,
    );
    expect(b).toEqual({ name: null, text: 'Undo', hidden: 'true' });
  });

  it('reports a toggle state and a disabled button', async () => {
    const r = await run<{ on: string | null; off: string | null; disabled: boolean; click: number }>(
      `(() => { let n = 0; const on = kit.iconButton('eye', 'Show colours', () => { n++; }, { pressed: true }); const off = kit.iconButton('eye-off', 'Hide colours', () => {}, { pressed: false }); const d = kit.textButton(null, 'Skip', () => { n += 10; }, { disabled: true }); document.getElementById('app').append(on, off, d); on.click(); d.click(); return { on: on.getAttribute('aria-pressed'), off: off.getAttribute('aria-pressed'), disabled: d.disabled, click: n }; })()`,
    );
    expect(r).toEqual({ on: 'true', off: 'false', disabled: true, click: 1 });
  });
});

describe('base.css', () => {
  const box = (cls: string, extra = '') => `(() => { const b = document.createElement('button'); b.className = '${cls}'; ${extra} b.textContent = 'x'; document.getElementById('app').append(b); const r = b.getBoundingClientRect(), s = getComputedStyle(b); return { w: r.width, h: r.height, bg: s.backgroundColor, color: s.color, border: s.borderTopWidth, weight: s.fontWeight }; })()`;

  it('makes a plain button borderless and a quiet one at least 44 px', async () => {
    const plain = await run<{ border: string; bg: string }>(box(''));
    expect(plain.border).toBe('0px');
    expect(plain.bg).toBe('rgba(0, 0, 0, 0)');
    const quiet = await run<{ w: number; h: number; bg: string }>(box('quiet'));
    expect(quiet.h).toBeGreaterThanOrEqual(44);
    expect(quiet.w).toBeGreaterThanOrEqual(44);
    expect(quiet.bg).toBe('rgba(0, 0, 0, 0)');
  });

  it('fills the primary, and makes Log set 52 px', async () => {
    const primary = await run<{ h: number; bg: string; weight: string }>(box('btn'));
    expect(primary.h).toBeGreaterThanOrEqual(44);
    expect(primary.bg).toBe('rgb(90, 86, 80)');
    expect(primary.weight).toBe('600');
    expect((await run<{ h: number }>(box('btn log'))).h).toBeGreaterThanOrEqual(52);
  });

  it('makes the stepper a flat 44 px tile', async () => {
    const tile = await run<{ w: number; h: number; border: string }>(box('step'));
    expect([tile.w, tile.h, tile.border]).toEqual([44, 44, '0px']);
  });

  it('marks the chosen one of a group with ink, weight 600 and an underline, not colour alone', async () => {
    const r = await run<{ on: { color: string; weight: string; line: string }; off: { color: string; weight: string; line: string } }>(
      `(() => { const g = document.createElement('div'); g.className = 'choices'; const mk = (t, pressed) => { const b = document.createElement('button'); b.className = 'quiet'; b.textContent = t; b.setAttribute('aria-pressed', String(pressed)); g.append(b); return b; }; const on = mk('90d', true), off = mk('1y', false); document.getElementById('app').append(g); const f = (el) => { const s = getComputedStyle(el); return { color: s.color, weight: s.fontWeight, line: s.textDecorationLine }; }; return { on: f(on), off: f(off) }; })()`,
    );
    expect(r.on.weight).toBe('600');
    expect(r.on.line).toBe('underline');
    expect(r.off.weight).toBe('400');
    expect(r.off.line).toBe('none');
    expect(r.on.color).not.toBe(r.off.color);
  });

  it('turns the primary light in dark mode', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const primary = await run<{ bg: string }>(box('btn'));
    await page.emulateMedia({ colorScheme: 'light' });
    expect(primary.bg).toBe('rgb(207, 201, 191)');
  });
});
