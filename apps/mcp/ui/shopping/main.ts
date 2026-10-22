import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { ShoppingData } from '../../src/planning/shoppingTypes';

const state = { data: null as ShoppingData | null, hideDone: false, error: '' };

const root = document.getElementById('app')!;
const undoBar = document.getElementById('undo')!;
const notice = document.getElementById('notice')!;
/** How long "Ticks cleared. Undo" stays up. */
const UNDO_MS = 8000;
let undo: { weekStart: string; keys: string[]; timer: ReturnType<typeof setTimeout> } | null = null;
const app = new App({ name: 'Fitwell shopping list', version: '0.1.0' }, {}, { autoResize: true });

// textContent only: item names come from data and are never parsed as HTML
type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k.startsWith('aria-') || k === 'role') el.setAttribute(k, String(v));
    else if (k === 'css' && typeof v === 'object') Object.assign(el.style, v); // CSSOM, not an inline style attribute (host CSP)
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

function counts(d: ShoppingData) {
  const total = d.sections.reduce((n, s) => n + s.items.length, 0);
  const done = d.sections.reduce((n, s) => n + s.items.filter((i) => i.checked).length, 0);
  return { total, done };
}

function itemRow(d: ShoppingData, item: ShoppingData['sections'][number]['items'][number]) {
  return h(
    'button',
    { type: 'button', className: 'item', role: 'checkbox', 'aria-checked': String(item.checked), onclick: () => void toggle(d, item) },
    h('span', { className: 'box', 'aria-hidden': 'true' }, item.checked ? '✓' : ''),
    h('span', { className: 'what' }, item.name, item.cooked && h('span', { className: 'muted small' }, ' (cooked weight)')),
    h('span', { className: 'amount' }, item.buy),
    item.usedIn.length > 0 && h('span', { className: 'where' }, item.usedIn.join(', ')),
  );
}

function draw() {
  const d = state.data;
  if (!d) {
    root.replaceChildren(h('h1', {}, 'Shopping list'), state.error ? h('p', { className: 'error center' }, state.error) : h('p', { className: 'muted center' }, 'Loading your list…'));
    return;
  }
  const { total, done } = counts(d);
  const sections = d.sections.map((s) => ({ ...s, items: state.hideDone ? s.items.filter((i) => !i.checked) : s.items })).filter((s) => s.items.length > 0);
  const parts: Child[] = [
    h('header', {}, h('h1', {}, 'Shopping list'), h('span', { className: 'muted small' }, `Week of ${fmtDay(d.weekStart)}${d.people !== 1 ? ` · for ${d.people}` : ''}`)),
    h('div', { className: 'card' }, h('p', { className: 'headline' }, done === total && total > 0 ? 'All done' : `${total - done} left`, h('small', {}, ` of ${total} items`)), h('div', { className: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done), 'aria-label': 'Items ticked' }, h('span', { css: { width: `${total ? Math.round((done / total) * 100) : 0}%` } })),
      h('div', { className: 'tools' }, h('button', { type: 'button', onclick: () => { state.hideDone = !state.hideDone; draw(); } }, state.hideDone ? 'Show ticked items' : 'Hide ticked items'), done > 0 && h('button', { type: 'button', onclick: () => void clearAll(d) }, 'Clear ticks')),
    ),
    state.error && h('p', { className: 'error small', role: 'alert' }, state.error),
    ...sections.map((s) => h('section', { className: 'card', 'aria-label': s.aisle }, h('h2', {}, s.aisle), h('div', { role: 'group', 'aria-label': s.aisle }, ...s.items.map((i) => itemRow(d, i))))),
    total === 0 && h('p', { className: 'muted center' }, 'Nothing to buy for this plan.'),
    d.leftOut.length > 0 && h('p', { className: 'muted small' }, `Left out, you already have: ${d.leftOut.join(', ')}.`),
    ...d.notes.map((n) => h('p', { className: 'muted small' }, n)),
  ];
  root.replaceChildren(...parts.filter((p): p is Node | string => p !== null && p !== false && p !== undefined && p !== ''));
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The list could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `shopping draw failed: ${message}` }).catch(() => undefined);
  }
}

/** Ticks at once (optimistic) and tells the server; if that fails the tick is undone and the person is told. */
async function toggle(d: ShoppingData, item: { key: string; checked: boolean }) {
  const next = !item.checked;
  item.checked = next;
  state.error = '';
  render();
  try {
    const res = await app.callServerTool({ name: 'set_grocery_checked', arguments: { week_start: d.weekStart, key: item.key, checked: next } });
    if (res.isError) throw new Error('rejected');
  } catch {
    item.checked = !next;
    state.error = 'Could not save that tick. Try again.';
    render();
  }
}

function hideUndo() {
  if (undo) clearTimeout(undo.timer);
  undo = null;
  undoBar.hidden = true;
  undoBar.replaceChildren();
}

/** "Ticks cleared. Undo" for a few seconds; the announcement is made once, by the status region, not by the bar. */
function showUndo(weekStart: string, keys: string[]) {
  hideUndo();
  undo = { weekStart, keys, timer: setTimeout(() => { hideUndo(); notice.textContent = ''; }, UNDO_MS) };
  undoBar.replaceChildren(h('div', {}, h('span', {}, 'Ticks cleared.'), h('button', { type: 'button', onclick: () => void undoClear() }, 'Undo')));
  undoBar.hidden = false;
  notice.textContent = 'Ticks cleared. Undo is available for a few seconds.';
}

/** Puts the ticks back in the view at once and saves them the way a tick is saved; if saving fails the list goes back to cleared. */
async function undoClear() {
  const d = state.data;
  const u = undo;
  if (!d || !u || d.weekStart !== u.weekStart) return;
  hideUndo();
  const items = d.sections.flatMap((s) => s.items).filter((i) => u.keys.includes(i.key) && !i.checked);
  for (const i of items) i.checked = true;
  state.error = '';
  notice.textContent = 'Ticks restored.';
  render();
  try {
    const results = await Promise.all(items.map((i) => app.callServerTool({ name: 'set_grocery_checked', arguments: { week_start: d.weekStart, key: i.key, checked: true } })));
    if (results.some((r) => r.isError)) throw new Error('rejected');
  } catch {
    for (const i of items) i.checked = false;
    state.error = 'Could not restore the ticks. Try again.';
    notice.textContent = '';
    render();
  }
}

async function clearAll(d: ShoppingData) {
  const before = d.sections.map((s) => s.items.map((i) => i.checked));
  const cleared = d.sections.flatMap((s) => s.items).filter((i) => i.checked).map((i) => i.key);
  for (const s of d.sections) for (const i of s.items) i.checked = false;
  state.error = '';
  hideUndo();
  render();
  try {
    const res = await app.callServerTool({ name: 'set_grocery_checked', arguments: { week_start: d.weekStart, clear: true } });
    if (res.isError) throw new Error('rejected');
    showUndo(d.weekStart, cleared);
  } catch {
    d.sections.forEach((s, si) => s.items.forEach((i, ii) => (i.checked = before[si]![ii]!)));
    state.error = 'Could not clear the ticks. Try again.';
    render();
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const data = (result.structuredContent as { shopping?: ShoppingData } | undefined)?.shopping;
  if (data) {
    hideUndo();
    state.data = data;
    render();
  } else if (result.isError) {
    state.error = 'The list could not be opened. Claude will explain why.';
    render();
  }
};
app.onhostcontextchanged = (ctx) => {
  applyHost(ctx);
  render();
};

await app.connect();
applyHost(app.getHostContext());
render();
