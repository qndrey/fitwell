import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { MealPlanView, PlanDay, PlanMeal } from '../../src/analytics/mealPlanTypes';
import { fmtDay } from '../shared/chart';
import { h } from '../shared/dom';
import { textButton } from '../shared/icons';

type Open = { kind: 'meal'; index: number } | { kind: 'day'; day: string } | null;
const state = { plan: null as MealPlanView | null, error: '', busy: new Set<string>(), open: null as Open };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell meal plan', version: '0.1.0' }, {}, { autoResize: true });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const n = (x: number) => x.toLocaleString('en-US');
const TEXT = (r: { content?: unknown }) => (r.content as { text?: string }[] | undefined)?.[0]?.text;

/** Calls an app tool with the plan's version; takes the fresh plan from its answer. A refusal is shown, and the plan is read again so a stale view catches up. */
async function act(key: string, name: string, args: Record<string, unknown>) {
  const plan = state.plan;
  if (!plan || state.busy.has(key)) return;
  state.busy.add(key);
  state.error = '';
  render();
  try {
    const res = await app.callServerTool({ name, arguments: { week_start: plan.weekStart, version: plan.version, ...args } });
    const next = (res.structuredContent as { mealPlan?: MealPlanView } | undefined)?.mealPlan;
    if (res.isError || !next) {
      state.error = TEXT(res) ?? 'That did not go through. Try again.';
      const again = await app.callServerTool({ name: 'get_meal_plan_data', arguments: { week_start: plan.weekStart } });
      const current = (again.structuredContent as { mealPlan?: MealPlanView } | undefined)?.mealPlan;
      if (current) state.plan = current;
    } else {
      state.plan = next;
      state.open = null;
    }
  } catch {
    state.error = 'That did not go through. Try again.';
  }
  state.busy.delete(key);
  render();
}

const isOpen = (o: Open) => JSON.stringify(state.open) === JSON.stringify(o);
const toggle = (o: Open) => {
  state.open = isOpen(o) ? null : o;
  render();
};

function mealRow(plan: MealPlanView, d: PlanDay, m: PlanMeal) {
  const open = isOpen({ kind: 'meal', index: m.index });
  const canEat = !m.logged && d.day <= plan.today;
  const others = plan.days.flatMap((x) => x.meals.filter((o) => o.index !== m.index && o.slot === m.slot).map((o) => ({ o, x })));
  const eat = `eat:${m.index}`;
  return [
    h(
      'li',
      { className: 'row' },
      h('div', { className: 'grow' }, h('span', { className: 'who' }, `${cap(m.slot)}: ${m.name}${m.servings !== null && m.servings !== 1 ? ` (${m.servings} servings)` : ''}`), h('span', { className: 'meta' }, `${n(m.kcal)} kcal · ${n(m.protein)} g protein${m.kind === 'estimate' ? ' · estimate' : ''}`)),
      m.logged
        ? h('span', { className: 'done' }, '✓ Eaten')
        : h(
            'div',
            { className: 'acts' },
            canEat ? textButton('check', 'Eaten', () => void act(eat, 'plan_eat_meal', { index: m.index }), { disabled: state.busy.has(eat), label: `Log ${m.name} as eaten` }) : null,
            textButton(null, open ? 'Close' : 'Change', () => toggle({ kind: 'meal', index: m.index }), { pressed: open, label: `Change ${m.name}` }),
          ),
    ),
    open
      ? h(
          'li',
          { className: 'picker' },
          plan.recipes.length > 0
            ? h(
                'div',
                { className: 'opts' },
                h('h3', {}, 'Swap for a saved recipe'),
                ...plan.recipes.map((r) => {
                  const key = `swap:${m.index}:${r.id}`;
                  return textButton(null, `${r.name} · ${n(r.kcalPerServing)} kcal`, () => void act(key, 'plan_swap_recipe', { index: m.index, recipe_id: r.id }), { disabled: state.busy.has(key), label: `Swap ${m.name} for ${r.name}` });
                }),
              )
            : h('p', { className: 'muted small' }, 'No saved recipes yet. Ask Claude to save one and it shows here.'),
          others.length > 0
            ? h(
                'div',
                { className: 'opts' },
                h('h3', {}, `Or copy another ${m.slot} of the week`),
                ...others.slice(0, 24).map(({ o, x }) => {
                  const key = `copy:${m.index}:${o.index}`;
                  return textButton(null, `${x.weekday}: ${o.name}`, () => void act(key, 'plan_copy_meal', { index: m.index, copy_from: o.index }), { disabled: state.busy.has(key), label: `Copy ${x.weekday} ${o.slot} (${o.name}) here` });
                }),
              )
            : null,
        )
      : null,
  ];
}

function dayCard(plan: MealPlanView, d: PlanDay) {
  const open = isOpen({ kind: 'day', day: d.day });
  const t = d.totals;
  const status = d.status.kcal === 'low' ? 'under the calorie goal' : d.status.kcal === 'high' ? 'over the calorie goal' : d.status.kcal === 'ok' ? 'on the calorie goal' : '';
  const protein = d.status.protein === 'short' ? 'protein short' : d.status.protein === 'ok' ? 'protein on goal' : '';
  return h(
    'section',
    { className: 'card', 'aria-label': `${d.weekday} ${fmtDay(d.day, false)}` },
    h(
      'div',
      { className: 'day-head' },
      h('h2', {}, `${d.weekday} ${fmtDay(d.day, false)}`, d.past ? h('span', { className: 'past' }, ' · past') : null),
      t ? h('span', { className: 'muted small' }, `${n(t.kcal)} kcal · ${n(t.protein)} g protein`) : h('span', { className: 'muted small' }, 'Nothing planned'),
    ),
    t && (status || protein) ? h('p', { className: 'muted small' }, [status, protein].filter(Boolean).join(' · ')) : null,
    d.meals.length > 0 ? h('ul', { className: 'rows' }, ...d.meals.flatMap((m) => mealRow(plan, d, m))) : null,
    d.meals.length > 0 ? h('div', {}, textButton(null, open ? 'Close' : 'Repeat this day…', () => toggle({ kind: 'day', day: d.day }), { pressed: open, label: `Repeat ${d.weekday} on another day` })) : null,
    open
      ? h(
          'div',
          { className: 'picker' },
          h('h3', {}, `Make another day the same as ${d.weekday}`),
          h(
            'div',
            { className: 'opts' },
            ...plan.days
              .filter((x) => x.day !== d.day)
              .map((x) => {
                const key = `repeat:${d.day}:${x.day}`;
                return textButton(null, x.weekday, () => void act(key, 'plan_repeat_day', { from_day: d.day, to_day: x.day }), { disabled: state.busy.has(key) || x.meals.some((m) => m.logged), label: `Make ${x.weekday} the same as ${d.weekday}` });
              }),
          ),
          h('p', { className: 'muted small' }, 'This replaces that day’s meals. A day with a meal already eaten is left alone.'),
        )
      : null,
  );
}

function draw() {
  const p = state.plan;
  if (!p) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading the meal plan…'));
    return;
  }
  const goals = [p.goals.kcal !== null ? `${n(p.goals.kcal)} kcal` : null, p.goals.proteinG !== null ? `${n(p.goals.proteinG)} g protein` : null].filter(Boolean).join(' · ');
  const last = p.days[6]!.day;
  const parts: (Node | null)[] = [
    h('header', {}, h('h1', {}, 'Meal plan'), h('span', { className: 'muted small' }, `${fmtDay(p.weekStart, false)} to ${fmtDay(last, false)}${goals ? ` · goal ${goals} a day` : ''}`)),
    state.error ? h('p', { className: 'error', role: 'alert' }, state.error) : null,
    p.warnings.length > 0 ? h('section', { className: 'warn', role: 'alert', 'aria-label': 'Allergies and dislikes' }, ...p.warnings.map((w) => h('span', {}, w))) : null,
    ...p.days.map((d) => dayCard(p, d)),
    p.problems.length > 0 ? h('section', { className: 'card', 'aria-label': 'Notes' }, h('h2', {}, 'Notes'), ...p.problems.map((x) => h('p', { className: 'muted small' }, x))) : null,
    h(
      'p',
      { className: 'muted small' },
      textButton(null, 'Ask Claude for the shopping list', () => void app.sendMessage({ role: 'user', content: [{ type: 'text', text: `Show my shopping list for the meal plan of the week of ${p.weekStart}.` }] }).catch(() => undefined), { label: 'Ask Claude for the shopping list of this week' }),
    ),
  ];
  root.replaceChildren(...parts.filter((x): x is Node => x !== null));
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The meal plan could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `meal plan draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const plan = (result.structuredContent as { mealPlan?: MealPlanView } | undefined)?.mealPlan;
  if (plan) {
    state.plan = plan;
    render();
  } else if (result.isError) {
    state.error = 'The meal plan could not be opened. Claude will explain why.';
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
