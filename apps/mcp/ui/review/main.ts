import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { WeekReview } from '../../src/analytics/reviewTypes';

const state = { review: null as WeekReview | null, loading: false, error: '' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell weekly review', version: '0.1.0' }, {}, { autoResize: true });

// textContent only: nothing from data is ever parsed as HTML
type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k.startsWith('aria-') || k === 'role') el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const num = (n: number, digits = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: digits });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "+120 vs last week", or nothing when there is no earlier number. Neutral: no colour says up is good or bad. */
function delta(cur: number | null, prev: number | null, unit: string, digits = 0) {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return h('span', { className: 'delta' }, d === 0 ? 'same as last week' : `${sign}${num(Math.abs(d), digits)} ${unit} vs last week`.replace(/ +/g, ' '));
}

function tile(label: string, value: string | null, ...extra: Child[]) {
  return h('div', { className: 'tile' }, h('span', { className: 'label' }, label), h('span', { className: 'big' }, value ?? '–'), ...extra);
}

const card = (title: string, ...children: Child[]) => h('section', { className: 'card', 'aria-label': title }, h('h2', {}, title), ...children);

function draw() {
  const r = state.review;
  const header = h(
    'header',
    {},
    h('h1', {}, 'Weekly review'),
    h(
      'div',
      { className: 'nav' },
      h('button', { type: 'button', 'aria-label': 'Previous week', disabled: state.loading || !r, onclick: () => void go(-7) }, '‹'),
      h('button', { type: 'button', 'aria-label': 'Next week', disabled: state.loading || !r || r.inProgress, onclick: () => void go(7) }, '›'),
    ),
  );
  if (!r) {
    root.replaceChildren(header, state.error ? h('p', { className: 'error center' }, state.error) : h('p', { className: 'muted center' }, 'Loading your week…'));
    return;
  }
  const n = r.nutrition;
  const t = r.training;
  const w = r.weight;
  const hb = r.habits;
  const sessions = t.strength + t.cardio;
  const cards: HTMLElement[] = [];

  if (r.highlights.length) cards.push(card('Went well', h('ul', { className: 'notes' }, ...r.highlights.map((x) => h('li', {}, x)))));

  cards.push(
    card(
      'Food',
      h(
        'div',
        { className: 'tiles' },
        tile('Calories a day', n.average ? num(n.average.kcal) : null, n.goals.kcal ? h('span', { className: 'delta' }, `goal ${num(n.goals.kcal)}`) : null, delta(n.average?.kcal ?? null, n.previousAverage?.kcal ?? null, 'kcal')),
        tile('Protein a day', n.average ? `${num(n.average.protein)} g` : null, n.goals.proteinG ? h('span', { className: 'delta' }, `goal ${num(n.goals.proteinG)} g`) : null, delta(n.average?.protein ?? null, n.previousAverage?.protein ?? null, 'g')),
        tile('Days logged', `${n.daysLogged} of ${r.daysCounted}`, n.kcalWithin10Pct !== null ? h('span', { className: 'delta' }, `${n.kcalWithin10Pct} within 10 % of the calorie goal`) : null),
      ),
      !n.average && h('p', { className: 'muted small' }, 'No food logged this week.'),
    ),
  );

  cards.push(
    card(
      'Training',
      h(
        'div',
        { className: 'tiles' },
        tile('Workouts', String(sessions), h('span', { className: 'delta' }, `${t.strength} strength · ${t.cardio} cardio${t.cardioMin ? ` (${t.cardioMin} min)` : ''}`), t.goalPerWeek ? h('span', { className: 'delta' }, `goal ${t.goalPerWeek} a week`) : null, delta(sessions, t.previousSessions, '')),
        tile('New records', String(t.records.length), ...t.records.slice(0, 3).map((x) => h('span', { className: 'delta' }, `${x.name} ${num(x.e1rmKg, 1)} kg`))),
      ),
    ),
  );

  cards.push(
    card(
      'Body',
      h(
        'div',
        { className: 'tiles' },
        tile('7-day average', w.averageKg !== null ? `${num(w.averageKg, 1)} kg` : null, delta(w.averageKg, w.previousAverageKg, 'kg', 1), w.goalKg !== null ? h('span', { className: 'delta' }, `goal ${num(w.goalKg, 1)} kg`) : null),
        tile('Weigh-ins', String(w.weighIns), w.weighIns < 3 ? h('span', { className: 'delta' }, 'average needs 3 or more') : null),
      ),
    ),
  );

  if (hb.sleepHours !== null || hb.steps !== null || hb.waterMl !== null) {
    cards.push(
      card(
        'Sleep, steps, water',
        h(
          'div',
          { className: 'tiles' },
          hb.sleepHours !== null && tile('Sleep a night', `${num(hb.sleepHours, 1)} h`, delta(hb.sleepHours, hb.previousSleepHours, 'h', 1)),
          hb.steps !== null && tile('Steps a day', num(hb.steps), delta(hb.steps, hb.previousSteps, 'steps')),
          hb.waterMl !== null && tile('Water a day', `${num(hb.waterMl / 1000, 1)} L`, delta(hb.waterMl / 1000, hb.previousWaterMl === null ? null : hb.previousWaterMl / 1000, 'L', 1)),
        ),
      ),
    );
  }

  if (r.plan) cards.push(card('Meal plan', h('p', {}, `${r.plan.logged} of ${r.plan.meals} planned meals were logged from the plan.`)));
  if (r.suggestions.length) cards.push(card('To consider', h('ul', { className: 'notes' }, ...r.suggestions.map((x) => h('li', {}, x))), h('p', { className: 'muted small' }, 'Ask Claude about any of these.')));

  root.replaceChildren(
    header,
    h('p', { className: 'muted small' }, `${fmtDay(r.weekStart)} to ${fmtDay(r.weekEnd)}`, r.inProgress && ' ', r.inProgress && h('span', { className: 'pill' }, 'week in progress'), state.loading && ' · updating…'),
    state.error && h('p', { className: 'error small' }, state.error),
    ...cards,
    h('footer', {}, 'Compared with the same days of the week before. Weight uses the 7-day average.'),
  );
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The review could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `review draw failed: ${message}` }).catch(() => undefined);
  }
}

async function go(deltaDays: number) {
  const r = state.review;
  if (!r) return;
  state.loading = true;
  state.error = '';
  render();
  try {
    const res = await app.callServerTool({ name: 'get_review_data', arguments: { week_start: addDays(r.weekStart, deltaDays) } });
    const review = (res.structuredContent as { review?: WeekReview } | undefined)?.review;
    if (res.isError || !review) throw new Error('no data');
    state.review = review;
  } catch {
    state.error = 'Could not load that week. Try again.';
  }
  state.loading = false;
  render();
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const review = (result.structuredContent as { review?: WeekReview } | undefined)?.review;
  if (review) {
    state.review = review;
    render();
  } else if (result.isError) {
    state.error = 'The review could not be opened. Claude will explain why.';
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
