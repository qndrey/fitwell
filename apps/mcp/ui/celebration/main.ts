import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { Celebration, CelebrationResult } from '../../src/analytics/celebrationTypes';
import { fmtDay } from '../shared/chart';
import { h, svg } from '../shared/dom';
import { icon, textButton } from '../shared/icons';
import { sharePanel } from './share';

const state = { celebrations: null as Celebration[] | null, error: '' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell milestone', version: '0.1.0' }, {}, { autoResize: true });

const RADIUS = 62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The number inside a ring that draws itself once (CSS; still when the person prefers reduced motion). */
function badge(c: Celebration) {
  const reached = c.kind === 'goal_weight';
  return h(
    'div',
    { className: 'badge', 'aria-hidden': 'true' },
    svg(
      'svg',
      { viewBox: '0 0 140 140', width: 140, height: 140 },
      svg('circle', { cx: 70, cy: 70, r: RADIUS, class: 'ring-track' }),
      svg('circle', { cx: 70, cy: 70, r: RADIUS, class: 'ring', 'stroke-dasharray': CIRCUMFERENCE, 'stroke-dashoffset': 0, transform: 'rotate(-90 70 70)' }),
    ),
    h('div', { className: 'badge-number' }, reached ? icon('check') : h('span', {}, `${c.atLeast ? '≥' : ''}${c.threshold}`)),
  );
}

/** The card panels people opened, kept across redraws (a theme change redraws the page) so their choices are not lost. */
const panels = new Map<string, HTMLElement>();
const opened = new Set<string>();

function card(c: Celebration) {
  const unit = c.next?.unit;
  const key = `${c.kind}:${c.threshold}`;
  const toggle = textButton(null, 'Make a card', () => {
    if (opened.has(key)) opened.delete(key);
    else opened.add(key);
    render();
  }, { pressed: opened.has(key) });
  if (opened.has(key) && !panels.has(key)) panels.set(key, sharePanel(c, app));
  return h(
    'section',
    { className: 'card celebrate', 'aria-label': c.title },
    badge(c),
    h('h1', {}, c.atLeast ? `At least ${c.title}` : c.title),
    c.detail && h('p', { className: 'muted center-text' }, c.detail),
    c.took.length > 0 &&
      h(
        'dl',
        { className: 'took' },
        ...c.took.flatMap((t) => [h('dt', {}, t.label), h('dd', {}, String(t.value))]),
      ),
    c.next && unit && h('p', { className: 'next' }, `Next: ${plural(c.next.threshold, unit)}, ${c.next.remaining === 1 ? `one ${unit} to go` : `${c.next.remaining} ${unit}s to go`}.`),
    h('p', { className: 'muted small center-text' }, c.atLeast ? `Reached ${fmtDay(c.achievedAt, false)}. Fitwell has your logs from before this, so the real number may be higher.` : `Reached ${fmtDay(c.achievedAt, false)}.`),
    toggle,
    opened.has(key) && panels.get(key),
  );
}

function draw() {
  const list = state.celebrations;
  if (!list) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading your milestone…'));
    return;
  }
  if (list.length === 0) {
    root.replaceChildren(h('p', { className: 'muted center' }, 'No new milestone right now.'));
    return;
  }
  root.replaceChildren(...list.map(card));
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The milestone could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `celebration draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const data = result.structuredContent as Partial<CelebrationResult> | undefined;
  if (data?.celebrations) {
    state.celebrations = data.celebrations;
    render();
  } else if (result.isError) {
    state.error = 'The milestone could not be opened. Claude will explain why.';
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
