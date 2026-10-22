import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { h, svg } from '../shared/dom';
import { extrasLine, macroText, NO_LIMITS, subline, type ExtraKey } from './copy';

interface Totals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
interface Entry extends Totals {
  id: string;
  slot: string;
  food: string;
  brand?: string;
  grams: number;
  estimated?: boolean;
}
/** What log_food returns as structured content. */
interface Logged {
  day: string;
  logged: Entry[];
  totals: Totals;
  extras?: Partial<Record<ExtraKey, number>>;
  /** Totals that some logged food has no value for: they are a minimum. */
  extrasIncomplete?: ExtraKey[];
  goals: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG?: number | null; satFatG?: number | null; addedSugarG?: number | null } | null;
  allergyWarnings?: string[];
}

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell food log', version: '0.1.0' }, {}, { autoResize: true });
let state: Logged | null = null;
let error = '';

const num = (n: number, digits = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: digits });
const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const sumOf = (rows: Entry[], k: keyof Totals) => rows.reduce((n, r) => n + r[k], 0);

function ring(pct: number) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const shown = Math.min(pct, 100);
  return svg(
    'svg',
    { viewBox: '0 0 100 100', role: 'img', 'aria-label': `${pct} % of the calorie goal` },
    svg('circle', { class: 'track', cx: 50, cy: 50, r, fill: 'none', 'stroke-width': 9 }),
    svg('circle', { class: 'arc', cx: 50, cy: 50, r, fill: 'none', 'stroke-width': 9, 'stroke-dasharray': `${(c * shown) / 100} ${c}`, transform: 'rotate(-90 50 50)', visibility: shown > 0 ? 'visible' : 'hidden' }),
    Object.assign(svg('text', { x: 50, y: 56, 'text-anchor': 'middle' }), { textContent: `${pct}%` }),
  );
}

function macro(name: string, value: number, goal: number | null, colour: string) {
  const fill = h('span');
  fill.style.width = `${goal ? Math.min(100, (value / goal) * 100) : 0}%`;
  fill.style.background = `var(${colour})`;
  return h(
    'div',
    { className: 'macro' },
    h('div', { className: 'head' }, h('span', { className: 'name' }, name), h('span', { className: 'val' }, macroText(value, goal).value, h('small', {}, macroText(value, goal).unit))),
    h('div', { className: 'bar' }, fill),
  );
}

/** One of the smaller stats: its total, and either a limit, a target or "no goal set". `kind` says whether the goal is a maximum or a minimum. */
function stat(name: string, value: number | undefined, incomplete: boolean, goal: number | null | undefined, kind: 'limit' | 'target', colour: string) {
  const known = value !== undefined;
  const over = known && goal != null && kind === 'limit' && value > goal;
  const note = goal == null ? 'no goal set' : kind === 'limit' ? `limit ${num(goal)} g` : `of ${num(goal)} g`;
  const fill = h('span');
  fill.style.width = `${known && goal ? Math.min(100, (value / goal) * 100) : 0}%`;
  fill.style.background = over ? 'var(--limit)' : `var(${colour})`;
  return h(
    'div',
    { className: 'stat' },
    h('div', { className: 'head' }, h('span', { className: 'name' }, name), h('span', { className: `val${over ? ' over' : ''}` }, known ? `${incomplete ? '≥' : ''}${num(value, 1)}` : '–', known && h('small', {}, ' g'))),
    goal != null && h('div', { className: 'bar' }, fill),
    h('div', { className: 'note' }, known ? note : 'not in the food data'),
  );
}

function draw() {
  if (!state) {
    root.replaceChildren(error ? h('p', { className: 'error center' }, error) : h('p', { className: 'muted center' }, 'Loading…'));
    return;
  }
  const { logged, totals, goals, allergyWarnings } = state;
  const extras = state.extras ?? {};
  const some = (k: ExtraKey) => state!.extrasIncomplete?.includes(k) === true;
  const added = Math.round(sumOf(logged, 'kcal'));
  const slots = [...new Set(logged.map((e) => e.slot))];
  const goal = goals?.kcal ?? null;
  const left = goal !== null ? Math.round(goal - totals.kcal) : null;
  const sub = subline(fmtDay(state.day), slots, logged.length);
  const noExtraGoals = goals?.satFatG == null && goals?.addedSugarG == null && goals?.fiberG == null;

  root.replaceChildren(
    h(
      'section',
      { className: 'card', 'aria-label': 'Meal logged' },
      h('div', { className: 'top' }, h('h1', {}, 'Meal logged'), h('span', { className: 'added' }, `+${num(added)} kcal`)),
      h('p', { className: 'sub' }, sub),
      h(
        'div',
        { className: 'cal' },
        goal ? ring(Math.round((totals.kcal / goal) * 100)) : null,
        h(
          'div',
          {},
          h('div', { className: 'label' }, 'Calories today'),
          h('div', { className: 'big' }, num(totals.kcal), goal !== null && h('small', {}, ` / ${num(goal)}`)),
          left !== null && h('div', { className: 'left' }, left >= 0 ? `${num(left)} kcal left` : `${num(-left)} kcal over`),
        ),
      ),
      h('div', { className: 'macros' }, macro('Protein', totals.protein, goals?.proteinG ?? null, '--protein'), macro('Carbs', totals.carbs, goals?.carbsG ?? null, '--carbs'), macro('Fat', totals.fat, goals?.fatG ?? null, '--fat')),
            noExtraGoals
        ? h('div', { className: 'stats-line', 'aria-label': 'More nutrients' }, h('p', {}, extrasLine(extras, state.extrasIncomplete ?? [])), h('p', { className: 'note' }, NO_LIMITS))
        : h(
          'div',
          { className: 'stats', 'aria-label': 'More nutrients' },
          stat('Sat. fat', extras.satFat, some('satFat'), goals?.satFatG, 'limit', '--fat'),
          stat('Trans fat', extras.transFat, some('transFat'), null, 'limit', '--fat'),
          stat('Sugar', extras.sugar, some('sugar'), null, 'limit', '--carbs'),
          stat('Added sugar', extras.addedSugar, some('addedSugar'), goals?.addedSugarG, 'limit', '--carbs'),
          stat('Fiber', extras.fiber, some('fiber'), goals?.fiberG, 'target', '--accent'),
          stat('Salt', extras.salt, some('salt'), null, 'limit', '--protein'),
        ),
      (state.extrasIncomplete?.length ?? 0) > 0 && h('p', { className: 'min-note' }, '≥ means some logged food has no value for it, so the real total is at least this.'),
      h(
        'ul',
        { className: 'items', 'aria-label': 'Logged foods' },
        ...logged.map((e) => h('li', {}, h('span', { className: 'nm' }, `${e.estimated ? '~' : ''}${e.food} · ${num(e.grams)} g`), h('span', { className: 'kc' }, `${num(e.kcal)} kcal`))),
      ),
      allergyWarnings?.length ? h('div', { className: 'warn', role: 'alert' }, ...allergyWarnings.map((w) => h('span', {}, w))) : null,
    ),
  );
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The food summary could not be drawn.'));
    void app.sendLog({ level: 'error', data: `food draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const data = result.structuredContent as unknown as Logged | undefined;
  if (data?.logged) {
    state = data;
    error = '';
  } else if (result.isError) error = 'Nothing was logged. Claude will explain why.';
  render();
};
app.onhostcontextchanged = (ctx) => {
  applyHost(ctx);
  render();
};

await app.connect();
applyHost(app.getHostContext());
render();
