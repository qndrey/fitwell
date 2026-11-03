import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { TodayMeal, TodayQuickAdd, TodayView } from '../../src/analytics/todayTypes';
import { fmtDay } from '../shared/chart';
import { h } from '../shared/dom';
import { textButton } from '../shared/icons';

const state = { today: null as TodayView | null, error: '', busy: new Set<string>() };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell today', version: '0.1.0' }, {}, { autoResize: true });

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Calls an app tool, takes the fresh day from its answer and redraws; a refusal is shown, not hidden. */
async function act(key: string, name: string, args: Record<string, unknown>) {
  if (state.busy.has(key)) return;
  state.busy.add(key);
  state.error = '';
  render();
  try {
    const res = await app.callServerTool({ name, arguments: args });
    const today = (res.structuredContent as { today?: TodayView } | undefined)?.today;
    if (res.isError || !today) throw new Error((res.content as { text?: string }[] | undefined)?.[0]?.text ?? 'refused');
    state.today = today;
  } catch (e) {
    state.error = e instanceof Error && e.message !== 'refused' ? e.message : 'That did not go through. Try again.';
  }
  state.busy.delete(key);
  render();
}

function left(t: TodayView) {
  const { kcal } = t.remaining;
  const goal = t.goals.kcal;
  const pct = goal ? Math.min(100, Math.round((t.eaten.kcal / goal) * 100)) : 0;
  return h(
    'section',
    { className: 'card', 'aria-label': 'Left today' },
    h('h2', {}, 'Left today'),
    kcal === null
      ? h('p', { className: 'muted' }, `${plural(t.eaten.kcal, 'kcal')} eaten so far. Ask Claude to set calorie goals and the rest shows here.`)
      : h('p', { className: 'headline' }, kcal >= 0 ? `${kcal.toLocaleString('en-US')} kcal ` : `${(-kcal).toLocaleString('en-US')} kcal over `, h('small', {}, kcal >= 0 ? `left of ${goal!.toLocaleString('en-US')}` : `of ${goal!.toLocaleString('en-US')}`)),
    goal ? h('div', { className: 'bar', role: 'img', 'aria-label': `${pct} % of the calorie goal eaten` }, h('i', { className: kcal! < 0 ? 'over' : '', css: { width: `${pct}%` } })) : null,
    h(
      'p',
      { className: 'muted small' },
      t.remaining.protein === null ? `${t.eaten.protein} g protein` : t.remaining.protein >= 0 ? `${t.remaining.protein} g protein to go` : `${-t.remaining.protein} g protein over the goal`,
      ` · ${t.eaten.carbs} g carbs · ${t.eaten.fat} g fat eaten`,
    ),
  );
}

function meal(m: TodayMeal) {
  const key = `plan:${m.slot}`;
  return h(
    'li',
    { className: 'row' },
    h('div', { className: 'grow' }, h('span', { className: 'who' }, cap(m.slot)), h('span', { className: 'meta' }, `${m.items.map((i) => i.name).join(', ')} · ${m.kcal} kcal`)),
    m.allLogged
      ? h('span', { className: 'done' }, '✓ Logged')
      : textButton('check', 'Eaten', () => void act(key, 'today_eat_planned', { slot: m.slot }), { disabled: state.busy.has(key), label: `Log ${m.slot} as eaten` }),
  );
}

function again(q: TodayQuickAdd) {
  const key = `qa:${q.entryId}`;
  return h(
    'li',
    { className: 'row' },
    h('div', { className: 'grow' }, h('span', { className: 'who' }, q.name), h('span', { className: 'meta' }, `${q.estimated ? '~' : ''}${q.grams} g · ${q.kcalRange ? `${q.kcal} kcal (${q.kcalRange.low} to ${q.kcalRange.high})` : `${q.kcal} kcal`} · ${q.protein} g protein`)),
    textButton(null, 'Add', () => void act(key, 'today_quick_add', { entry_id: q.entryId }), { disabled: state.busy.has(key), label: `Log ${q.name} again` }),
  );
}

function draw() {
  const t = state.today;
  if (!t) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading today…'));
    return;
  }
  const done = t.training.doneToday;
  const parts: (Node | null)[] = [
    h('header', {}, h('h1', {}, 'Today'), h('span', { className: 'muted small' }, `${fmtDay(t.day, false)} · adds go to ${t.slot}`)),
    state.error ? h('p', { className: 'error', role: 'alert' }, state.error) : null,
    left(t),
    t.planned.length > 0 ? h('section', { className: 'card', 'aria-label': 'Planned meals' }, h('h2', {}, 'Planned'), h('ul', { className: 'rows' }, ...t.planned.map(meal))) : null,
    t.quickAdd.length > 0
      ? h('section', { className: 'card', 'aria-label': 'Log again' }, h('h2', {}, 'Log again'), h('p', { className: 'muted small' }, 'Foods you eat often, with the amount you had last time.'), h('ul', { className: 'rows' }, ...t.quickAdd.map(again)))
      : null,
    h(
      'section',
      { className: 'card', 'aria-label': 'Water and steps' },
      h('h2', {}, 'Water and steps'),
      h('p', { className: 'headline' }, `${t.waterMl.toLocaleString('en-US')} ml `, h('small', {}, 'water'), t.steps !== null ? h('span', {}, `  ${t.steps.toLocaleString('en-US')} `) : null, t.steps !== null ? h('small', {}, 'steps') : null),
      h('div', { className: 'choices' }, ...[250, 500].map((ml) => textButton(null, `+${ml} ml`, () => void act(`water:${ml}`, 'today_add_water', { ml }), { disabled: state.busy.has(`water:${ml}`), label: `Add ${ml} millilitres of water` }))),
    ),
    h(
      'section',
      { className: 'card', 'aria-label': 'Training' },
      h('h2', {}, 'Training'),
      done.length > 0 ? h('ul', { className: 'rows' }, ...done.map((w) => h('li', { className: 'row' }, h('div', { className: 'grow' }, h('span', { className: 'who' }, w.name), h('span', { className: 'meta' }, `${cap(w.type)}${w.minutes ? ` · ${w.minutes} min` : ''}`))))) : h('p', { className: 'muted' }, 'Nothing logged today yet.'),
      t.training.suggested
        ? h(
            'p',
            { className: 'muted small' },
            `Suggested: ${t.training.suggested.name}, `,
            t.training.suggested.daysSince === null ? 'not done yet' : `${plural(t.training.suggested.daysSince, 'day')} since you did it`,
            '. ',
            textButton(null, 'Ask Claude to start it', () => void app.sendMessage({ role: 'user', content: [{ type: 'text', text: `Start my ${t.training.suggested!.name} workout.` }] }).catch(() => undefined), { label: `Ask Claude to start ${t.training.suggested.name}` }),
          )
        : null,
    ),
  ];
  root.replaceChildren(...parts.filter((x): x is Node => x !== null));
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'Today could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `today draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const today = (result.structuredContent as { today?: TodayView } | undefined)?.today;
  if (today) {
    state.today = today;
    render();
  } else if (result.isError) {
    state.error = 'Today could not be opened. Claude will explain why.';
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
