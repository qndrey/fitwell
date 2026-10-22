// P4: the card pager, its header and the Overview (Specs: Pager and header, Opening and resume, Overview, Error handling).
// The built view (src/ui/generated/workout.ts, made by `npm run build:ui` before the tests) runs in a real Chromium
// inside an iframe, as Claude embeds it. The test page plays the host: it answers the MCP Apps handshake, serves
// the plan, records every tool call and every message to Claude. Nothing of the view is mocked.
import { chromium, type Browser, type BrowserContext, type FrameLocator, type Page } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PlannedCardio, PlannedExercise, PlannedSet, WorkoutPlan } from '../src/workout/plan';
import viewHtml from '../src/ui/generated/workout';

// ---------- page-side typing ----------
// The workspace tsconfig has no DOM lib, so code that runs inside the browser reaches the DOM through this minimal
// local shape: `const d = globalThis as unknown as Dom;` at the top of each page-side callback.
interface DomNode {
  id: string;
  inert: boolean;
  srcdoc: string;
  textContent: string | null;
  children: ArrayLike<unknown>;
  getBoundingClientRect(): { top: number; left: number; bottom: number };
  contains(other: DomNode | null): boolean;
  closest(selector: string): DomNode | null;
  getAttribute(name: string): string | null;
  focus(): void;
  append(child: DomNode): void;
}
interface Dom {
  window: { innerWidth: number; scrollY: number; focus(): void; __send(message: unknown): void };
  document: {
    documentElement: { scrollWidth: number };
    body: DomNode & { scrollWidth: number };
    activeElement: DomNode | null;
    getElementById(id: string): DomNode | null;
    querySelector(selector: string): DomNode | null;
    querySelectorAll(selector: string): Iterable<DomNode>;
    createElement(tag: string): DomNode;
  };
  getComputedStyle(node: unknown): Record<string, string>;
}

// ---------- fixtures ----------
let uidCounter = 0;
const set = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => ({ id, targetReps: 5, weightKg: 80, done: false, ...o });
const closed = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => set(id, { done: true, reps: 5, ...o });
const skipped = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => set(id, { skipped: true, ...o });

function ex(name: string, sets: PlannedSet[], o: Partial<PlannedExercise> = {}): PlannedExercise {
  uidCounter += 1;
  return { uid: `u${uidCounter}`, id: `ex:${name}`, name, equipment: 'barbell', restSec: 90, bodyweight: false, sets, ...o };
}
const cardio = (id: string, when: 'before' | 'after', o: Partial<PlannedCardio> = {}): PlannedCardio => ({ id, name: `Cardio ${id}`, when, plannedMin: 10, done: false, ...o });
const plan = (exercises: PlannedExercise[], cardioBlocks: PlannedCardio[] = [], o: Partial<WorkoutPlan> = {}): WorkoutPlan => ({
  workoutId: 'w1',
  name: 'Full body A',
  startedAt: Date.now() - 5 * 60_000,
  finished: false,
  exercises,
  cardio: cardioBlocks,
  ...o,
});
const fresh3 = () =>
  plan([
    ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })], { lastTime: '5 @ 80, 5 @ 80 (2026-10-09)' }),
    ex('Bench Press', [set('1', { weightKg: 60 }), set('2', { weightKg: 60 })], { lastTime: '3×5 @ 60 kg' }),
    ex('Push-up', [set('1', { weightKg: undefined, targetReps: 12 }), set('2', { weightKg: undefined, targetReps: 12 })], { bodyweight: true, equipment: 'bodyweight' }),
  ]);

// ---------- the host ----------
interface Opened {
  page: Page;
  context: BrowserContext;
  frame: FrameLocator;
  /** Tool calls the view made, in order. */
  calls: { name: string; args: Record<string, unknown> }[];
  /** Texts the view sent to Claude with `sendMessage`. */
  messages: string[];
  /** Hands the view another tool result (the host resending). */
  sendResult(result: Record<string, unknown>): Promise<void>;
  /** Runs code inside the view's frame. */
  inView<T>(fn: () => T): Promise<T>;
}
interface HostOptions {
  width?: number;
  theme?: 'light' | 'dark';
  reducedMotion?: boolean;
  touch?: boolean;
  /** Result of finish_workout: undefined = a summary, 'error' = isError. */
  finish?: 'error';
}

let browser: Browser;
const open: Opened[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});
afterEach(async () => {
  for (const o of open.splice(0)) await o.context.close();
});

const planResult = (p: WorkoutPlan) => ({ content: [{ type: 'text', text: 'Workout started.' }], structuredContent: { workout: p } });

async function openView(p: WorkoutPlan | 'error', o: HostOptions = {}): Promise<Opened> {
  const width = o.width ?? 375;
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference',
    hasTouch: !!o.touch,
    isMobile: !!o.touch,
  });
  const page = await context.newPage();
  const calls: Opened['calls'] = [];
  const messages: string[] = [];
  const stored = p === 'error' ? undefined : p;
  const summary = (w: WorkoutPlan) => ({
    content: [{ type: 'text', text: 'Finished.' }],
    structuredContent: { name: w.name, minutes: 5, workingSets: 0, volumeKg: 0, exercises: [], records: [] },
  });

  await page.exposeFunction('__toHost', async (msg: { id?: number; method: string; params?: Record<string, unknown> }) => {
    if (msg.method === 'ui/initialize') {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'test-host', version: '1' },
          hostCapabilities: {},
          hostContext: { theme: o.theme ?? 'light', displayMode: 'inline', platform: 'web' },
        },
      };
    }
    if (msg.method === 'ui/notifications/initialized') {
      const result = p === 'error' ? { content: [{ type: 'text', text: 'No workout.' }], isError: true } : planResult(p);
      setTimeout(() => void page.evaluate((r) => (globalThis as unknown as Dom).window.__send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: r }), result), 0);
      return null;
    }
    if (msg.method === 'tools/call') {
      const name = String(msg.params?.name);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      calls.push({ name, args });
      if (name === 'get_workout' && stored) return { jsonrpc: '2.0', id: msg.id, result: planResult(stored) };
      if (name === 'finish_workout') {
        return { jsonrpc: '2.0', id: msg.id, result: o.finish === 'error' || !stored ? { content: [{ type: 'text', text: 'failed' }], isError: true } : summary(stored) };
      }
      return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'ok' }] } };
    }
    if (msg.method === 'ui/message') {
      const content = (msg.params?.content ?? []) as { text?: string }[];
      messages.push(content.map((c) => c.text ?? '').join(''));
      return { jsonrpc: '2.0', id: msg.id, result: {} };
    }
    if (msg.id !== undefined) return { jsonrpc: '2.0', id: msg.id, result: {} };
    return null;
  });

  await page.setContent(
    `<!doctype html><html><body style="margin:0"><iframe id="v" sandbox="allow-scripts" style="width:100%;height:1300px;border:0"></iframe>
    <script>
      const f = document.getElementById('v');
      window.__send = (m) => f.contentWindow.postMessage(m, '*');
      window.addEventListener('message', async (e) => {
        if (e.source !== f.contentWindow) return;
        const reply = await window.__toHost(e.data);
        if (reply) window.__send(reply);
      });
    </script></body></html>`,
  );
  await page.evaluate((html) => {
    const frameEl = (globalThis as unknown as Dom).document.getElementById('v');
    if (frameEl) frameEl.srcdoc = html;
  }, viewHtml);

  const opened: Opened = {
    page,
    context,
    frame: page.frameLocator('#v'),
    calls,
    messages,
    sendResult: async (result) => {
      await page.evaluate((r) => (globalThis as unknown as Dom).window.__send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: r }), result);
    },
    inView: async (fn) => {
      const f = page.frames().find((x) => x !== page.mainFrame());
      if (!f) throw new Error('view frame missing');
      return f.evaluate(fn);
    },
  };
  open.push(opened);
  if (p !== 'error') await opened.frame.locator('[aria-roledescription="carousel"]').waitFor();
  return opened;
}

// ---------- locators and helpers (the interface assumptions are listed in the reply) ----------
const trackOf = (v: Opened) => v.frame.locator('[aria-roledescription="carousel"]');
const cardsOf = (v: Opened) => trackOf(v).locator('[aria-roledescription="card"]');
const counterOf = (v: Opened) => v.frame.getByText(/^\d+ of \d+$/);
const stripOf = (v: Opened) => v.frame.locator('[data-strip]');
const counterText = async (v: Opened) => (await counterOf(v).textContent())?.trim();
/** Waits until the scroll has come to rest on a card and that card is the current one (the counter leads the scroll). */
const settled = async (v: Opened) => {
  const deadline = Date.now() + 8000;
  for (;;) {
    const ok = await trackOf(v).evaluate((el) => {
      const t = el as unknown as { scrollLeft: number; clientWidth: number; querySelectorAll(s: string): ArrayLike<{ inert: boolean }>; ownerDocument: { querySelector(s: string): { textContent: string | null } | null } };
      const i = Math.round(t.scrollLeft / t.clientWidth);
      const cards = t.querySelectorAll('[aria-roledescription="card"]');
      const counter = t.ownerDocument.querySelector('.counter')?.textContent?.trim() ?? '';
      // At rest on card i, that card is the current one, and the counter says so (it leads the scroll, so it must agree).
      return Math.abs(t.scrollLeft - i * t.clientWidth) < 2 && !!cards[i] && !cards[i]!.inert && counter.startsWith(`${i + 1} of`);
    });
    if (ok || Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};
const expectCounter = async (v: Opened, text: string) => {
  await expect.poll(() => counterText(v), { timeout: 5000 }).toBe(text);
  await settled(v);
};
const jumpTo = async (v: Opened, position: number) => {
  await v.inView(() => undefined);
  await trackOf(v).evaluate((el, pos) => {
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = pos * el.clientWidth;
  }, position);
};
/** Key events must reach the view's document, so the iframe takes focus first (as when the person has tapped into it). */
const press = async (v: Opened, key: string) => {
  await v.inView(() => (globalThis as unknown as Dom).window.focus());
  await v.page.keyboard.press(key);
};
const calledTools = (v: Opened) => v.calls.map((c) => c.name);

// ---------- Pager and header ----------
describe('Specs: Pager and header rule 1 (track, snap, fixed height) and rule 5 (roles, inert)', () => {
  it('one card per step plus Overview and Finish, in plan order, with the carousel and card roles and labels', async () => {
    const v = await openView(fresh3());
    await pwExpect(cardsOf(v)).toHaveCount(5);
    await pwExpect(trackOf(v)).toHaveAttribute('aria-label', 'Workout cards');
    const cards = cardsOf(v);
    const labels = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels[0]).toMatch(/^1 of 5: /);
    expect(labels.slice(1, 4)).toEqual(['2 of 5: Squat', '3 of 5: Bench Press', '4 of 5: Push-up']);
    expect(labels[4]).toMatch(/^5 of 5: /);
    expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('role')))).toEqual(Array(5).fill('group'));
  });

  it('the track snaps on x, contains horizontal overscroll and is as tall as the card in view', async () => {
    const narrow = await openView(fresh3(), { width: 375 });
    const css = await trackOf(narrow).evaluate((el) => {
      const gcs = (globalThis as unknown as Dom).getComputedStyle;
      const s = gcs(el);
      const c = gcs(el.querySelector('.slide')!); // the slide snaps and sizes; the card inside it scrolls
      const card = gcs(el.querySelector('[aria-roledescription="card"]')!);
      return { snap: s.scrollSnapType, ox: s.overflowX, over: s.overscrollBehaviorX, height: s.height, cardSnap: c.scrollSnapAlign, stop: c.scrollSnapStop, oy: card.overflowY, minW: c.minWidth, basis: c.flexBasis, grow: c.flexGrow, shrink: c.flexShrink };
    });
    expect(css.snap).toContain('x mandatory');
    expect(css.ox).toBe('auto');
    expect(css.over).toBe('contain');
    expect(Number.parseFloat(css.height ?? '0')).toBeGreaterThan(0);
    expect(css.cardSnap).toBe('center');
    expect(css.stop).toBe('always');
    expect(css.oy).toBe('visible');
    expect(css.minW).toBe('0px');
    expect(css.grow).toBe('0');
    expect(css.shrink).toBe('0');
    expect(css.basis).toMatch(/^(100%|\d+(\.\d+)?px)$/);
    const wide = await openView(fresh3(), { width: 800 });
    expect(await trackOf(wide).evaluate((el) => el.clientHeight)).toBeGreaterThan(0);
  });

  it('every card except the current one is inert, and the inert card moves with the pager', async () => {
    const v = await openView(fresh3());
    const inert = () => cardsOf(v).evaluateAll((els) => els.map((e) => (e as unknown as DomNode).inert));
    expect(await inert()).toEqual([false, true, true, true, true]);
    await press(v, 'ArrowRight');
    await expectCounter(v, '2 of 5');
    await expect.poll(inert).toEqual([true, false, true, true, true]);
  });
});

describe('Specs: Pager and header rule 2 (no horizontal page overflow from 320 px)', () => {
  it.each([
    [320, 'light'],
    [320, 'dark'],
    [375, 'light'],
    [375, 'dark'],
  ] as const)('at %i px in the %s theme the page does not scroll sideways, on the Overview and on a card', async (width, theme) => {
    const longName = 'Single-Arm Dumbbell Romanian Deadlift With A Very Long Descriptive Name';
    const v = await openView(plan([ex(longName, [set('1'), set('2')], { lastTime: '5 @ 80, 5 @ 80 (2026-10-09)' }), ex('Squat', [set('1')])]), { width, theme });
    const overflow = () => v.inView(() => {
        const d = globalThis as unknown as Dom;
        return { doc: d.document.documentElement.scrollWidth - d.window.innerWidth, body: d.document.body.scrollWidth - d.window.innerWidth };
      });
    expect((await overflow()).doc).toBeLessThanOrEqual(0);
    expect((await overflow()).body).toBeLessThanOrEqual(0);
    await jumpTo(v, 1);
    await expectCounter(v, '2 of 4');
    expect((await overflow()).doc).toBeLessThanOrEqual(0);
    expect((await overflow()).body).toBeLessThanOrEqual(0);
  });

  it('a card with more content than the minimum grows and the track follows, with no scroll inside the card', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ex(`Exercise ${i + 1}`, [set('1')]));
    const v = await openView(plan(many));
    const card = cardsOf(v).first();
    const m = await card.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sh).toBe(m.ch);
    expect(m.ch).toBeGreaterThan(496);
    expect(Math.abs((await trackOf(v).evaluate((el) => el.clientHeight)) - m.ch)).toBeLessThanOrEqual(1);
  });
});

describe('Specs: Pager and header rule 3 (the header is built once, outside the track)', () => {
  it('name, clock, counter and strip are not inside the track and sit above it', async () => {
    const v = await openView(fresh3());
    const info = await v.inView(() => {
      const d = globalThis as unknown as Dom;
      const track = d.document.querySelector('[aria-roledescription="carousel"]')!;
      const find = (re: RegExp) => [...d.document.querySelectorAll('body *')].find((e) => e.children.length === 0 && re.test(e.textContent ?? ''));
      const counter = find(/^\d+ of \d+$/)!;
      const strip = d.document.querySelector('[data-strip]')!;
      const name = [...d.document.querySelectorAll('body *')].find((e) => e.children.length === 0 && e.textContent === 'Full body A' && !track.contains(e));
      return {
        counterIn: track.contains(counter),
        stripIn: track.contains(strip),
        nameOutside: !!name,
        counterAbove: counter.getBoundingClientRect().bottom <= track.getBoundingClientRect().top + 1,
        stripAbove: strip.getBoundingClientRect().bottom <= track.getBoundingClientRect().top + 1,
      };
    });
    expect(info).toEqual({ counterIn: false, stripIn: false, nameOutside: true, counterAbove: true, stripAbove: true });
  });

  it('swiping and scrolling inside a card leave the header where it was (AC19)', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ex(`Exercise ${i + 1}`, [set('1')]));
    const v = await openView(plan(many));
    const pos = () =>
      v.inView(() => {
        const d = globalThis as unknown as Dom;
        const c = [...d.document.querySelectorAll('body *')].find((e) => e.children.length === 0 && /^\d+ of \d+$/.test(e.textContent ?? ''))!;
        const r = c.getBoundingClientRect();
        const s = d.document.querySelector('[data-strip]')!.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), stripTop: Math.round(s.top), pageY: d.window.scrollY };
      });
    const before = await pos();
    await cardsOf(v).first().evaluate((el) => (el.scrollTop = 400));
    expect(await pos()).toEqual(before);
    await press(v, 'ArrowRight');
    await expectCounter(v, '2 of 16');
    expect(await pos()).toEqual(before);
  });

  it('the header and the track exist once: the pager is not replaced when the view re-renders on a new host context', async () => {
    const v = await openView(fresh3());
    await trackOf(v).evaluate((el) => el.setAttribute('data-probe', '1'));
    await v.page.evaluate(() => (globalThis as unknown as Dom).window.__send({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }));
    await v.page.waitForTimeout(200);
    await pwExpect(trackOf(v)).toHaveAttribute('data-probe', '1');
    await pwExpect(trackOf(v)).toHaveCount(1);
  });
});

describe('Specs: Pager and header rule 4 (current card from the scroll position) and rule 9', () => {
  it('four swipes left reach Finish in plan order and four swipes right come back in reverse order', async () => {
    const v = await openView(fresh3());
    await expectCounter(v, '1 of 5');
    for (let pos = 1; pos <= 4; pos += 1) {
      await jumpTo(v, pos);
      await expectCounter(v, `${pos + 1} of 5`);
    }
    for (let pos = 3; pos >= 0; pos -= 1) {
      await jumpTo(v, pos);
      await expectCounter(v, `${pos + 1} of 5`);
    }
  });

  it('the current card follows a scroll that ends between cards: the nearest card wins', async () => {
    const v = await openView(fresh3());
    await trackOf(v).evaluate((el) => {
      el.style.scrollSnapType = 'none';
      el.scrollLeft = el.clientWidth * 2.3;
    });
    await expectCounter(v, '3 of 5');
  });

  it('no programmatic scroll fires while a pointer is down on the track', async () => {
    const v = await openView(fresh3());
    const box = await trackOf(v).boundingBox();
    if (!box) throw new Error('track not visible');
        await v.page.mouse.move(box.x + box.width / 2, box.y + 40);
    await v.page.mouse.down();
    await press(v, 'ArrowRight');
    await v.page.waitForTimeout(400);
    expect(await trackOf(v).evaluate((el) => el.scrollLeft)).toBe(0);
    await v.page.mouse.up();
  });
});

describe('Specs: Pager and header rules 6 and 7 (strip, prev/next, keys)', () => {
  it('the strip has one segment per card with the counter "k of n"', async () => {
    const v = await openView(fresh3());
    expect(await stripOf(v).locator('[data-seg]').count()).toBe(5);
    await pwExpect(counterOf(v)).toHaveText('1 of 5');
  });

  it('above 8 cards the strip is one continuous bar with a marker instead of segments', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ex(`Exercise ${i + 1}`, [set('1')]));
    const v = await openView(plan(many));
    await expectCounter(v, '1 of 9');
    expect(await stripOf(v).locator('[data-seg]').count()).toBe(0);
    await pwExpect(stripOf(v)).toBeVisible();
  });

  it('exactly 8 cards still show segments', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ex(`Exercise ${i + 1}`, [set('1')]));
    const v = await openView(plan(six));
    await expectCounter(v, '1 of 8');
    expect(await stripOf(v).locator('[data-seg]').count()).toBe(8);
  });

  it('with 15 cards the marker is an 8 px block, inside the bar at the first and the last card and moving with the counter', async () => {
    const many = Array.from({ length: 13 }, (_, i) => ex(`Exercise ${i + 1}`, [set('1')]));
    const v = await openView(plan(many));
    const bar = stripOf(v).locator('.cbar');
    const mark = stripOf(v).locator('[data-marker]');
    const inside = async () => {
      const [b, m] = [(await bar.boundingBox())!, (await mark.boundingBox())!];
      expect(m.width).toBeGreaterThanOrEqual(8);
      expect(m.x).toBeGreaterThanOrEqual(b.x - 0.5);
      expect(m.x + m.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
      return m.x;
    };
    await expectCounter(v, '1 of 15');
    const first = await inside();
    await jumpTo(v, 1);
    await expectCounter(v, '2 of 15');
    const second = await inside();
    expect(second).toBeGreaterThan(first);
    await jumpTo(v, 14);
    await expectCounter(v, '15 of 15');
    const last = await inside();
    expect(last).toBeGreaterThan(second);
    const b = (await bar.boundingBox())!;
    expect(last + 8).toBeCloseTo(b.x + b.width, 0);
  });

  it('tapping the strip scrolls to the Overview', async () => {
    const v = await openView(fresh3());
    await jumpTo(v, 3);
    await expectCounter(v, '4 of 5');
    await stripOf(v).click();
    await expectCounter(v, '1 of 5');
  });

  it('‹ and › are 44 px buttons on both sides of the title, and they name the card they go to', async () => {
    const v = await openView(fresh3());
    const prev = v.frame.getByRole('button', { name: /^Previous card/ });
    const next = v.frame.getByRole('button', { name: /^Next card/ });
    const title = v.frame.locator('.titlebar strong');
    const [pb, nb, tb] = [(await prev.boundingBox())!, (await next.boundingBox())!, (await title.boundingBox())!];
    expect(pb.width).toBeGreaterThanOrEqual(44);
    expect(pb.height).toBeGreaterThanOrEqual(44);
    expect(nb.width).toBeGreaterThanOrEqual(44);
    expect(nb.height).toBeGreaterThanOrEqual(44);
    expect(pb.x + pb.width).toBeLessThanOrEqual(tb.x + 1);
    expect(nb.x).toBeGreaterThanOrEqual(tb.x + tb.width - 1);
    await pwExpect(prev).toHaveAttribute('aria-label', 'Previous card');
    await pwExpect(next).toHaveAttribute('aria-label', 'Next card: Squat');
    await next.click();
    await expectCounter(v, '2 of 5');
    await pwExpect(v.frame.getByRole('button', { name: 'Previous card: Overview' })).toHaveAttribute('aria-disabled', 'false');
    await pwExpect(v.frame.getByRole('button', { name: 'Next card: Bench Press' })).toBeVisible();
  });

  it('at either end the button stays, is aria-disabled and does nothing', async () => {
    const v = await openView(fresh3());
    const prev = v.frame.locator('[data-key="prev"]');
    const next = v.frame.locator('[data-key="next"]');
    await pwExpect(prev).toHaveAttribute('aria-disabled', 'true');
    await prev.click({ force: true }); // Playwright waits for an enabled button: aria-disabled counts as disabled
    await v.page.waitForTimeout(500);
    await expectCounter(v, '1 of 5');
    await jumpTo(v, 4);
    await expectCounter(v, '5 of 5');
    await pwExpect(next).toHaveAttribute('aria-disabled', 'true');
    await pwExpect(next).toHaveAttribute('aria-label', 'Next card');
    await pwExpect(prev).toHaveAttribute('aria-label', 'Previous card: Push-up');
    await next.click({ force: true });
    await v.page.waitForTimeout(500);
    await expectCounter(v, '5 of 5');
  });

  it('moving with a button puts the focus on the new card\'s heading, and two quick taps go two cards', async () => {
    const v = await openView(fresh3());
    const next = v.frame.locator('[data-key="next"]');
    await next.click();
    await expectCounter(v, '2 of 5');
    await expect.poll(() => v.inView(() => (globalThis as unknown as Dom).document.activeElement?.textContent ?? '')).toContain('Squat');
    await next.click();
    await next.click();
    await expectCounter(v, '4 of 5');
  });

  it('the counter is one "k of n" text, the strip is labelled "Card k of n. Show the overview.", and an exercise card has no counter of its own', async () => {
    const v = await openView(fresh3());
    await v.frame.locator('[data-key="next"]').click();
    await expectCounter(v, '2 of 5');
    await pwExpect(counterOf(v)).toHaveText('2 of 5');
    await pwExpect(stripOf(v)).toHaveAttribute('aria-label', 'Card 2 of 5. Show the overview.');
    const card = cardsOf(v).nth(1);
    await pwExpect(card.getByText(/^\d+ of \d+$/)).toHaveCount(0);
  });

  it('two quick presses of an arrow key go two cards, because the second starts from the card being scrolled to', async () => {
    const v = await openView(fresh3());
    await press(v, 'ArrowRight');
    await press(v, 'ArrowRight');
    await expectCounter(v, '3 of 5');
  });

  it('arrow keys move one card, Home and End go to the ends', async () => {
    const v = await openView(fresh3());
    await press(v, 'ArrowRight');
    await expectCounter(v, '2 of 5');
    await press(v, 'ArrowRight');
    await expectCounter(v, '3 of 5');
    await press(v, 'ArrowLeft');
    await expectCounter(v, '2 of 5');
    await press(v, 'End');
    await expectCounter(v, '5 of 5');
    await press(v, 'Home');
    await expectCounter(v, '1 of 5');
  });

  it('arrow, Home and End keys do nothing while an input, textarea or select has focus', async () => {
    const v = await openView(fresh3());
    await v.inView(() => {
      const d = globalThis as unknown as Dom;
      const input = d.document.createElement('input');
      input.id = 'probe-input';
      d.document.body.append(input);
      input.focus();
    });
    await press(v, 'ArrowRight');
    await press(v, 'End');
    await v.page.waitForTimeout(500);
    expect(await counterText(v)).toBe('1 of 5');
  });

  it('with reduced motion the arrow key scrolls with behavior auto: the card changes at once', async () => {
    const v = await openView(fresh3(), { reducedMotion: true });
    await press(v, 'ArrowRight');
    // An instant scroll lands on the card within a frame or two; a smooth one would still be moving.
    await v.page.waitForTimeout(100);
    const left = await trackOf(v).evaluate((el) => el.scrollLeft / el.clientWidth);
    expect(left).toBeCloseTo(1, 1);
  });
});

// ---------- Opening and resume ----------
describe('Specs: Opening and resume', () => {
  it('rule 1: a fresh workout opens on the Overview', async () => {
    const v = await openView(fresh3());
    await expectCounter(v, '1 of 5');
    expect(await cardsOf(v).first().evaluate((el) => (el as unknown as DomNode).inert)).toBe(false);
  });

  it('rule 2: a resumed workout opens on the first step with an open set', async () => {
    const p = plan([ex('Squat', [closed('1'), closed('2')]), ex('Bench Press', [closed('1'), set('2')]), ex('Row', [set('1')])]);
    const v = await openView(p);
    await expectCounter(v, '3 of 5');
  });

  it('rule 2: a step with only open warm-ups counts as open', async () => {
    const p = plan([ex('Squat', [closed('1'), closed('2')]), ex('Bench Press', [set('w1', { warmup: true }), closed('1')])]);
    const v = await openView(p);
    await expectCounter(v, '3 of 4');
  });

  it('rule 2: skipped sets are closed, so a resumed workout skips past a step with all sets skipped', async () => {
    const p = plan([ex('Squat', [closed('1'), skipped('2')]), ex('Bench Press', [set('1')])]);
    const v = await openView(p);
    await expectCounter(v, '3 of 4');
  });

  it('rule 2: cardio before the lifting that is done leaves the first open exercise as the opening card', async () => {
    const p = plan([ex('Squat', [set('1')])], [cardio('c1', 'before', { done: true, minutes: 10 })]);
    const v = await openView(p);
    await expectCounter(v, '3 of 4');
  });

  it('rule 3: all steps closed and not finished opens on Finish and calls neither finish_workout nor sendMessage', async () => {
    const p = plan([ex('Squat', [closed('1'), closed('2')]), ex('Bench Press', [closed('1'), skipped('2')])]);
    const v = await openView(p);
    await expectCounter(v, '4 of 4');
    await v.page.waitForTimeout(600);
    expect(calledTools(v)).not.toContain('finish_workout');
    expect(v.messages).toEqual([]);
  });

  it('rule 4: a finished workout opens on Finish, calls finish_workout once and sends nothing to Claude', async () => {
    const p = plan([ex('Squat', [closed('1')])], [], { finished: true });
    const v = await openView(p);
    await expectCounter(v, '3 of 3');
    await expect.poll(() => calledTools(v).filter((n) => n === 'finish_workout').length).toBe(1);
    await v.page.waitForTimeout(500);
    expect(calledTools(v).filter((n) => n === 'finish_workout').length).toBe(1);
    expect(v.messages).toEqual([]);
  });

  it('rule 5: the host resending the same workout keeps the person where they are', async () => {
    const p = fresh3();
    const v = await openView(p);
    await jumpTo(v, 2);
    await expectCounter(v, '3 of 5');
    await v.sendResult(planResult(p));
    await v.page.waitForTimeout(500);
    await expectCounter(v, '3 of 5');
    await pwExpect(cardsOf(v)).toHaveCount(5);
  });

  it('the same exercise twice in a plan (distinct uid) has two cards', async () => {
    const v = await openView(plan([ex('Squat', [set('1')]), ex('Squat', [set('1')])]));
    await expectCounter(v, '1 of 4');
    const labels = await cardsOf(v).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels.slice(1, 3)).toEqual(['2 of 4: Squat', '3 of 4: Squat']);
  });

  it('cardio before and after sit at the plan positions around the exercises', async () => {
    const p = plan([ex('Squat', [set('1')]), ex('Bench Press', [set('1')])], [cardio('post', 'after', { name: 'Finisher' }), cardio('pre', 'before', { name: 'Warm-up row' })]);
    const v = await openView(p);
    const labels = await cardsOf(v).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels.slice(1, 5)).toEqual(['2 of 6: Warm-up row', '3 of 6: Squat', '4 of 6: Bench Press', '5 of 6: Finisher']);
  });

  it('a plan with only cardio and a plan with one exercise render and page', async () => {
    const only = await openView(plan([ex('Squat', [set('1')])]));
    await expectCounter(only, '1 of 3');
    await press(only, 'End');
    await expectCounter(only, '3 of 3');
    const cardioOnly = await openView(plan([], [cardio('c1', 'before')]));
    await expectCounter(cardioOnly, '1 of 3');
    await press(cardioOnly, 'ArrowRight');
    await expectCounter(cardioOnly, '2 of 3');
  });
});

// ---------- Overview ----------
describe('Specs: Overview', () => {
  const overview = (v: Opened) => cardsOf(v).first();

  it('shows the name, "Today", the working-sets progress line and the ask-Claude line', async () => {
    const v = await openView(fresh3());
    const card = overview(v);
    await pwExpect(card).toContainText('Full body A');
    await pwExpect(card).toContainText('Today');
    await pwExpect(card).toContainText('0 of 7 sets · 3 exercises');
    await pwExpect(card).toContainText('Ask Claude to change the plan.');
  });

  it('counts working sets only: warm-ups are not counted and skipped working sets are closed but not done', async () => {
    const p = plan([ex('Squat', [closed('w1', { warmup: true }), closed('1'), skipped('2'), set('3')]), ex('Row', [set('1'), set('2')])]);
    const v = await openView(p);
    await expectCounter(v, '2 of 4');
    await jumpTo(v, 0);
    await expectCounter(v, '1 of 4');
    await pwExpect(overview(v)).toContainText('1 of 5 sets · 2 exercises');
  });

  it('one row per step, each a button at least 40 px high with the label "<name>, <closed> of <total> sets done"', async () => {
    const p = plan([ex('Squat', [closed('1'), set('2'), set('3')]), ex('Bench Press', [set('1'), set('2')])]);
    const v = await openView(p);
    await jumpTo(v, 0);
    for (const label of ['Squat, 1 of 3 sets done', 'Bench Press, 0 of 2 sets done']) {
      const row = overview(v).getByRole('button', { name: label });
      await pwExpect(row).toHaveCount(1);
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    }
  });

  it('tapping a row moves the pager to that card and focus to its heading', async () => {
    const v = await openView(fresh3());
    await overview(v).getByRole('button', { name: 'Bench Press, 0 of 2 sets done' }).click();
    await expectCounter(v, '3 of 5');
    await expect.poll(() => v.inView(() => (globalThis as unknown as Dom).document.activeElement?.textContent ?? '')).toContain('Bench Press');
    expect(await v.inView(() => (globalThis as unknown as Dom).document.activeElement?.closest('[aria-roledescription="card"]')?.getAttribute('aria-label'))).toBe('3 of 5: Bench Press');
  });

  it('exercise rows show today\'s first working-set target and the parsed last time', async () => {
    const v = await openView(fresh3());
    const squat = overview(v).getByRole('button', { name: /^Squat,/ });
    await pwExpect(squat).toContainText('5 × 82.5 kg');
    await pwExpect(squat).toContainText('Last time (9 Oct): 5, 5 × 80 kg');
  });

  it('"beat last" shows as a plain difference when both numbers parse and is omitted when last time does not parse', async () => {
    const v = await openView(fresh3());
    await pwExpect(overview(v).getByRole('button', { name: /^Squat,/ })).toContainText('beat last: +2.5 kg');
    const bench = overview(v).getByRole('button', { name: /^Bench Press,/ });
    await pwExpect(bench).not.toContainText('beat last');
    await pwExpect(bench).not.toContainText('Last time');
    await pwExpect(bench).toContainText('5 × 60 kg');
  });

  it('"beat last" for reps uses "+1 rep" in the singular', async () => {
    const p = plan([ex('Push-up', [set('1', { weightKg: undefined, targetReps: 13 })], { bodyweight: true, lastTime: '12 @ BW (2026-10-09)' })]);
    const v = await openView(p);
    await pwExpect(overview(v).getByRole('button', { name: /^Push-up,/ })).toContainText('beat last: +1 rep');
  });

  it('supersets are marked by a bar and the word "Superset" for assistive technology', async () => {
    const p = plan([ex('Curl', [set('1')], { supersetId: 's1' }), ex('Pushdown', [set('1')], { supersetId: 's1' }), ex('Squat', [set('1')])]);
    const v = await openView(p);
    const curl = overview(v).getByRole('button', { name: /^Curl,/ });
    expect(await curl.evaluate((el) => el.textContent ?? '')).toMatch(/Superset/);
    const squat = overview(v).getByRole('button', { name: /^Squat,/ });
    expect(await squat.evaluate((el) => el.textContent ?? '')).not.toMatch(/Superset/);
  });

  it('supersets also show the word "Superset" as a visible sub-label on the member rows only', async () => {
    const p = plan([ex('Curl', [set('1')], { supersetId: 's1' }), ex('Pushdown', [set('1')], { supersetId: 's1' }), ex('Squat', [set('1')])]);
    const v = await openView(p);
    await pwExpect(overview(v).getByText('Superset', { exact: true })).toHaveCount(2);
    await pwExpect(overview(v).getByRole('button', { name: /^Curl,/ }).getByText('Superset', { exact: true })).toBeVisible();
    await pwExpect(overview(v).getByRole('button', { name: /^Squat,/ }).getByText('Superset', { exact: true })).toHaveCount(0);
  });

  it('the primary button reads "Start: <name>" when fresh and moves to that card', async () => {
    const v = await openView(fresh3());
    const primary = overview(v).getByRole('button', { name: 'Start: Squat' });
    await pwExpect(primary).toBeVisible();
    await primary.click();
    await expectCounter(v, '2 of 5');
  });

  it('the primary button reads "Continue: <name>" when resumed, pointing at the first open step', async () => {
    const p = plan([ex('Squat', [closed('1')]), ex('Bench Press', [set('1')])]);
    const v = await openView(p);
    await jumpTo(v, 0);
    await expectCounter(v, '1 of 4');
    await pwExpect(overview(v).getByRole('button', { name: 'Continue: Bench Press' })).toBeVisible();
  });

  it('there is no primary button when no step is open', async () => {
    const p = plan([ex('Squat', [closed('1')])]);
    const v = await openView(p);
    await jumpTo(v, 0);
    await pwExpect(overview(v).getByRole('button', { name: /^(Start|Continue):/ })).toHaveCount(0);
  });

  it('a cardio row shows its state in the progress', async () => {
    const p = plan([ex('Squat', [set('1')])], [cardio('c1', 'after', { name: 'Finisher', done: true, minutes: 10 })]);
    const v = await openView(p);
    await pwExpect(overview(v).getByRole('button', { name: /^Finisher,/ })).toHaveCount(1);
  });

  it('there is no rest row on the Overview when no rest runs', async () => {
    const v = await openView(fresh3());
    await pwExpect(overview(v)).not.toContainText(/Resting \d/);
  });
});

// ---------- Fatal state ----------
describe('Specs: Error/edge-case handling, Fatal', () => {
  it('an error tool result with no plan shows "The workout could not be started. Claude will explain why." in place of the track', async () => {
    const v = await openView('error');
    await pwExpect(v.frame.getByText('The workout could not be started. Claude will explain why.')).toBeVisible();
    await pwExpect(trackOf(v)).toHaveCount(0);
  });
});
