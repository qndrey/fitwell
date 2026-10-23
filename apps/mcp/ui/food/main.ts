import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { h } from '../shared/dom';
import { icon } from '../shared/icons';
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

/** The filled part of a thin meter (CSSOM, not an inline style attribute: host CSP). */
function bar(pct: number, colour: string) {
  const fill = h('span');
  fill.style.width = `${Math.min(100, pct)}%`;
  fill.style.background = colour;
  return fill;
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

/** One of the smaller stats: its total, a meter and the limit or target when there is a goal. A stat without a goal is just name and total (draw says so once, for all of them). */
function stat(name: string, value: number | undefined, incomplete: boolean, goal: number | null | undefined, kind: 'limit' | 'target', colour: string) {
  const known = value !== undefined;
  const over = known && goal != null && kind === 'limit' && value > goal;
  const note = !known ? 'not in the food data' : goal == null ? '' : kind === 'limit' ? `limit ${num(goal)} g` : `of ${num(goal)} g`;
  const fill = h('span');
  fill.style.width = `${known && goal ? Math.min(100, (value / goal) * 100) : 0}%`;
  fill.style.background = over ? 'var(--limit)' : `var(${colour})`;
  return h(
    'div',
    { className: 'stat' },
    h('div', { className: 'head' }, h('span', { className: 'name' }, name), h('span', { className: `val${over ? ' over' : ''}` }, known ? `${incomplete ? '≥' : ''}${num(value, 1)}` : '–', known && h('small', {}, ' g'))),
    goal != null && h('div', { className: 'bar' }, fill),
    note && h('div', { className: 'note' }, note),
  );
}

/** The six smaller stats, then one line for the known ones that have no goal (instead of "no goal set" six times). */
function moreStats(extras: Partial<Record<ExtraKey, number>>, goals: Logged['goals'], some: (k: ExtraKey) => boolean) {
  const rows: [string, ExtraKey, number | null | undefined, 'limit' | 'target', string][] = [
    ['Sat. fat', 'satFat', goals?.satFatG, 'limit', '--fat'],
    ['Trans fat', 'transFat', null, 'limit', '--fat'],
    ['Sugar', 'sugar', null, 'limit', '--carbs'],
    ['Added sugar', 'addedSugar', goals?.addedSugarG, 'limit', '--carbs'],
    ['Fiber', 'fiber', goals?.fiberG, 'target', '--accent'],
    ['Salt', 'salt', null, 'limit', '--protein'],
  ];
  const noGoal = rows.filter(([, k, goal]) => extras[k] !== undefined && goal == null).map(([name]) => name.toLowerCase());
  return [
    ...rows.map(([name, k, goal, kind, colour]) => stat(name, extras[k], some(k), goal, kind, colour)),
    noGoal.length > 0 && h('p', { className: 'stats-note' }, `No goal set for ${noGoal.length === 1 ? noGoal[0] : `${noGoal.slice(0, -1).join(', ')} and ${noGoal.at(-1)}`}.`),
  ];
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
      h('div', { className: 'top' }, h('h1', {}, icon('check-circle'), 'Meal logged'), h('span', { className: 'added' }, `+${num(added)} kcal`)),
      h('p', { className: 'sub' }, sub),
      h(
        'div',
        { className: 'cal' },
        h('div', { className: 'label' }, 'Calories today'),
        h('div', { className: 'line' }, h('div', { className: 'big' }, num(totals.kcal), goal !== null && h('small', {}, ` / ${num(goal)}`)), left !== null && h('div', { className: 'left' }, left >= 0 ? `${num(left)} kcal left` : `${num(-left)} kcal over`)),
        goal ? h('div', { className: 'bar', role: 'img', 'aria-label': `${Math.round((totals.kcal / goal) * 100)} % of the calorie goal` }, bar(Math.round((totals.kcal / goal) * 100), 'var(--accent)')) : null,
      ),
      h('div', { className: 'macros' }, macro('Protein', totals.protein, goals?.proteinG ?? null, '--protein'), macro('Carbs', totals.carbs, goals?.carbsG ?? null, '--carbs'), macro('Fat', totals.fat, goals?.fatG ?? null, '--fat')),
            noExtraGoals
        ? h('div', { className: 'stats-line', 'aria-label': 'More nutrients' }, h('p', {}, extrasLine(extras, state.extrasIncomplete ?? [])), h('p', { className: 'note' }, NO_LIMITS))
        : h('div', { className: 'stats', 'aria-label': 'More nutrients' }, ...moreStats(extras, goals, some)),
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
