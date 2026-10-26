// A Playwright page that plays the MCP Apps host for the built workout view (src/ui/generated/workout.ts, made by
// `npm run build:ui`): the view runs in an iframe, the page answers the handshake, serves the plan and records every
// tool call and every message to Claude. Shared by the workout-cards-*.test.ts files that drive the real view.
import { chromium, type Browser, type BrowserContext, type FrameLocator, type Page } from 'playwright';
import type { PlannedCardio, PlannedExercise, PlannedSet, WorkoutPlan } from '../../src/workout/plan';
import viewHtml from '../../src/ui/generated/workout';

// The workspace tsconfig has no DOM lib, so code that runs inside the browser reaches the DOM through this minimal
// local shape: `const d = globalThis as unknown as Dom;` at the top of each page-side callback.
export interface DomNode {
  id: string;
  inert: boolean;
  srcdoc: string;
  textContent: string | null;
  children: ArrayLike<unknown>;
  getBoundingClientRect(): { top: number; left: number; bottom: number; height: number };
  contains(other: DomNode | null): boolean;
  closest(selector: string): DomNode | null;
  getAttribute(name: string): string | null;
  focus(): void;
  append(child: DomNode): void;
  click(): void;
  dispatchEvent(event: unknown): boolean;
}
export interface Dom {
  window: {
    innerWidth: number;
    scrollY: number;
    focus(): void;
    __send(message: unknown): void;
    dispatchEvent(event: unknown): boolean;
  };
  document: {
    hidden: boolean;
    documentElement: { scrollWidth: number };
    body: DomNode & { scrollWidth: number };
    activeElement: DomNode | null;
    getElementById(id: string): DomNode | null;
    querySelector(selector: string): DomNode | null;
    querySelectorAll(selector: string): Iterable<DomNode>;
    createElement(tag: string): DomNode;
    dispatchEvent(event: unknown): boolean;
  };
  Event: new (type: string) => unknown;
  PointerEvent: new (type: string, init: { bubbles: boolean; pointerId: number; pointerType: string }) => unknown;
  getComputedStyle(node: unknown): Record<string, string>;
}
/** What the view did with audio and vibration (the init script below replaces both with recorders). */
export interface Effects {
  oscillators: number;
  vibrations: unknown[];
}

// ---------- fixtures ----------
let uidCounter = 0;
export const set = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => ({ id, targetReps: 5, weightKg: 80, done: false, ...o });
export const closed = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => set(id, { done: true, reps: 5, ...o });
export const skipped = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => set(id, { skipped: true, ...o });
export function ex(name: string, sets: PlannedSet[], o: Partial<PlannedExercise> = {}): PlannedExercise {
  uidCounter += 1;
  return { uid: `u${uidCounter}`, id: `ex:${name}`, name, equipment: 'barbell', restSec: 90, bodyweight: false, sets, ...o };
}
export const cardio = (id: string, when: 'before' | 'after', o: Partial<PlannedCardio> = {}): PlannedCardio => ({ id, name: `Cardio ${id}`, when, plannedMin: 10, done: false, ...o });
export const plan = (exercises: PlannedExercise[], cardioBlocks: PlannedCardio[] = [], o: Partial<WorkoutPlan> = {}): WorkoutPlan => ({
  workoutId: 'w1',
  name: 'Full body A',
  startedAt: Date.now() - 5 * 60_000,
  finished: false,
  exercises,
  cardio: cardioBlocks,
  ...o,
});

// ---------- the host ----------
export interface Opened {
  page: Page;
  context: BrowserContext;
  frame: FrameLocator;
  /** Tool calls the view made, in order. */
  calls: { name: string; args: Record<string, unknown> }[];
  /** Texts the view sent to Claude with `sendMessage`. */
  messages: string[];
  /** Texts the view shared with `updateModelContext`, in order. */
  contexts: string[];
  sendResult(result: Record<string, unknown>): Promise<void>;
  /** Runs code inside the view's frame. */
  inView<T>(fn: () => T): Promise<T>;
}
export interface HostOptions {
  width?: number;
  theme?: 'light' | 'dark';
  reducedMotion?: boolean;
  touch?: boolean;
  finish?: 'error';
  /** Makes `sendMessage` return an error while it returns true (read at call time). */
  messageFails?: () => boolean;
  /** Answers a tool call the view makes (get_substitutes, swap_exercise, get_exercise_guide, ...); undefined falls through to the defaults. Read at call time, so tests can change what it returns. */
  tools?: (name: string, args: Record<string, unknown>) => Record<string, unknown> | undefined;
  /** How long (ms) a tool call waits before the host answers it, by tool name: to see what the view shows meanwhile. */
  delay?: (name: string) => number;
  /** The browser has no WebGL (the figure is left out). */
  noWebGL?: boolean;
  /** The first tool result the host sends the view instead of the plan (a `finish_workout` summary, an unexpected result). */
  initial?: Record<string, unknown>;
  /** Installs Playwright's fake clock (it keeps running in real time until `page.clock.runFor` / `fastForward` jumps it). */
  clock?: boolean;
}

let browser: Browser;
const open: Opened[] = [];

export async function launchBrowser() {
  // Software GL so the guide's WebGL figure can be created in headless Chromium.
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}
export async function closeBrowser() {
  await browser.close();
}
export async function closeOpened() {
  for (const o of open.splice(0)) await o.context.close();
}

export const planResult = (p: WorkoutPlan) => ({ content: [{ type: 'text', text: 'Workout started.' }], structuredContent: { workout: p } });

export async function openView(p: WorkoutPlan | 'error', o: HostOptions = {}): Promise<Opened> {
  const width = o.width ?? 375;
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference',
    hasTouch: !!o.touch,
    isMobile: !!o.touch,
  });
  await context.addInitScript((noWebGL) => {
    const g = globalThis as unknown as {
      __fx: Effects;
      AudioContext: unknown;
      navigator: { vibrate: (pattern: unknown) => boolean };
    };
    g.__fx = { oscillators: 0, vibrations: [] };
    if (noWebGL) {
      const canvas = (globalThis as unknown as { HTMLCanvasElement: { prototype: { getContext: (kind: string, ...rest: unknown[]) => unknown } } }).HTMLCanvasElement.prototype;
      const real = canvas.getContext;
      canvas.getContext = function (this: unknown, kind: string, ...rest: unknown[]) {
        return /webgl/.test(kind) ? null : real.call(this, kind, ...rest);
      };
    }
    const node = { connect: () => node, frequency: { value: 0 }, gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, start: () => (g.__fx.oscillators += 1), stop: () => undefined };
    class FakeAudio {
      state = 'running';
      currentTime = 0;
      destination = node;
      resume = () => Promise.resolve();
      createOscillator = () => node;
      createGain = () => node;
    }
    g.AudioContext = FakeAudio;
    g.navigator.vibrate = (pattern: unknown) => {
      g.__fx.vibrations.push(pattern);
      return true;
    };
  }, !!o.noWebGL);
  if (o.clock) await context.clock.install();
  const page = await context.newPage();
  const calls: Opened['calls'] = [];
  const messages: string[] = [];
  const contexts: string[] = [];
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
        result: { protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1' }, hostCapabilities: {}, hostContext: { theme: o.theme ?? 'light', displayMode: 'inline', platform: 'web' } },
      };
    }
    if (msg.method === 'ui/notifications/initialized') {
      const result = o.initial ?? (p === 'error' ? { content: [{ type: 'text', text: 'No workout.' }], isError: true } : planResult(p));
      setTimeout(() => void page.evaluate((r) => (globalThis as unknown as Dom).window.__send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: r }), result), 0);
      return null;
    }
    if (msg.method === 'tools/call') {
      const name = String(msg.params?.name);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      calls.push({ name, args });
      const wait = o.delay?.(name) ?? 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const custom = o.tools?.(name, args);
      if (custom) return { jsonrpc: '2.0', id: msg.id, result: custom };
      if (name === 'get_workout' && stored) return { jsonrpc: '2.0', id: msg.id, result: planResult(stored) };
      if (name === 'finish_workout') return { jsonrpc: '2.0', id: msg.id, result: o.finish === 'error' || !stored ? { content: [{ type: 'text', text: 'failed' }], isError: true } : summary(stored) };
      return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'ok' }] } };
    }
    if (msg.method === 'ui/message') {
      const content = (msg.params?.content ?? []) as { text?: string }[];
      messages.push(content.map((c) => c.text ?? '').join(''));
      return { jsonrpc: '2.0', id: msg.id, result: o.messageFails?.() ? { isError: true } : {} };
    }
    if (msg.method === 'ui/update-model-context') {
      const content = (msg.params?.content ?? []) as { text?: string }[];
      contexts.push(content.map((c) => c.text ?? '').join(''));
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
    contexts,
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
  if (p !== 'error' && !o.initial) await opened.frame.locator('[aria-roledescription="carousel"]').waitFor();
  return opened;
}

// ---------- locators and helpers ----------
export const trackOf = (v: Opened) => v.frame.locator('[aria-roledescription="carousel"]');
export const cardsOf = (v: Opened) => trackOf(v).locator('[aria-roledescription="card"]');
export const counterOf = (v: Opened) => v.frame.getByText(/^\d+ of \d+$/);
export const counterText = async (v: Opened) => (await counterOf(v).textContent())?.trim();
export const jumpTo = async (v: Opened, position: number) => {
  await v.inView(() => undefined);
  await trackOf(v).evaluate((el, pos) => {
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = pos * el.clientWidth;
  }, position);
};
/** Waits until the scroll has come to rest on a card and that card is the current one (the counter leads the scroll). */
export const settled = async (v: Opened) => {
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
/** Key events must reach the view's document, so the iframe takes focus first. */
export const press = async (v: Opened, key: string) => {
  await v.inView(() => (globalThis as unknown as Dom).window.focus());
  await v.page.keyboard.press(key);
};
export const calledTools = (v: Opened) => v.calls.map((c) => c.name);
export const logCalls = (v: Opened) => v.calls.filter((c) => c.name === 'log_set').map((c) => c.args);
export const effects = (v: Opened) => v.inView(() => (globalThis as unknown as { __fx: Effects }).__fx);
