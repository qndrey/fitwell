import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { Progress } from '../../src/analytics/types';
import { barChart, fmtDay, lineChart, num, rangeLabel, sparkline, weekBars } from '../shared/chart';
import { h } from '../shared/dom';
import { energyView } from './energy';
import { buildPager, type PagerCard } from '../shared/pager';

const RANGES = [30, 90, 365] as const;
const state = { progress: null as Progress | null, days: 90 as number, loading: false, error: '', card: 0, measure: '', habit: 'sleep' as 'sleep' | 'steps' | 'water' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell dashboard', version: '0.1.0' }, {}, { autoResize: true });


const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n), digits)}`;

// ---------- charts ----------
function weightChart(p: Progress) {
  const w = p.weight;
  if (w.daily.length === 0) return null;
  return lineChart({
    from: p.from,
    to: p.to,
    label: `Weight from ${rangeLabel(p.from, p.to)}: ${w.daily.length} weigh-ins${w.trendChangeKg !== null ? `, 7-day average changed by ${signed(w.trendChangeKg)} kg` : ''}.`,
    columns: ['Date', 'Weigh-in (kg)', '7-day average (kg)'],
    dots: w.daily.map((d) => ({ day: d.day, value: d.kg })),
    line: w.average.map((d) => ({ day: d.day, value: d.kg })),
    goal: w.goalKg ? { value: w.goalKg } : undefined,
    height: 150,
    pad: [0.1, 0.5],
    dotsOnTop: true,
  });
}

function nutritionChart(p: Progress) {
  const n = p.nutrition;
  if (n.daily.length === 0) return null;
  return barChart({
    from: p.from,
    to: p.to,
    days: p.days,
    label: `Calories per logged day, ${n.daysLogged} days${n.averagePerLoggedDay ? `, average ${num(n.averagePerLoggedDay.kcal, 0)} kcal` : ''}.`,
    columns: ['Date', 'Calories (kcal)'],
    points: n.daily.map((d) => ({ day: d.day, value: d.kcal })),
    height: 130,
    headroom: 1.08,
    reference: n.goals.kcal ?? undefined,
  });
}

function trainingChart(p: Progress) {
  const wk = p.training.weeks;
  if (!wk.some((w) => w.strength + w.cardio + w.session > 0)) return null;
  return weekBars({
    weeks: wk.map((w) => ({ week: w.week, a: w.strength, b: w.cardio + w.session })),
    to: p.to,
    label: `Workouts per week over ${wk.length} weeks: ${p.training.sessions.strength} strength and ${p.training.sessions.cardio + p.training.sessions.session} cardio or class sessions in total.`,
    columns: ['Week', 'Strength workouts', 'Cardio and class workouts'],
    goal: p.training.goalWorkoutsPerWeek,
  });
}

// ---------- cards ----------
const empty = (text: string) => h('p', { className: 'muted small' }, text);

function weightCard(p: Progress) {
  const w = p.weight;
  const chart = weightChart(p);
  return h(
    'section',
    { className: 'card', 'aria-label': 'Weight' },
    h('h2', {}, 'Weight'),
    w.latestKg === null
      ? empty('No weigh-ins in this period. Tell Claude your weight to start the chart.')
      : h('p', { className: 'headline' }, `${num(w.latestKg)} kg `, w.trendChangeKg !== null && h('small', {}, `${signed(w.trendChangeKg)} kg over the period (7-day average)`)),
    w.fromGoalKg !== null && w.latestKg !== null && h('p', { className: 'muted small' }, `${num(w.fromGoalKg)} kg from your goal of ${num(w.goalKg!)} kg`),
    chart,
    chart && w.trendChangeKg === null && empty('A trend line needs at least 3 weigh-ins within a week.'),
    chart && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1 faint' }), 'weigh-in'), h('span', {}, h('i', { className: 'sw1' }), '7-day average')),
  );
}

const EXTRA_LABELS = [['fiber', 'fiber'], ['sugar', 'sugar'], ['addedSugar', 'added sugar'], ['satFat', 'sat. fat'], ['transFat', 'trans fat'], ['salt', 'salt']] as const;

function nutritionCard(p: Progress) {
  const n = p.nutrition;
  const chart = nutritionChart(p);
  const a = n.adherence;
  return h(
    'section',
    { className: 'card', 'aria-label': 'Nutrition' },
    h('h2', {}, 'Nutrition'),
    !n.averagePerLoggedDay
      ? empty('No food logged in this period.')
      : h('p', { className: 'headline' }, `${num(n.averagePerLoggedDay.kcal, 0)} kcal `, h('small', {}, `average on ${n.daysLogged} logged ${n.daysLogged === 1 ? 'day' : 'days'}`)),
    n.averagePerLoggedDay && h('p', { className: 'muted small' }, `Protein ${num(n.averagePerLoggedDay.protein, 0)} g · carbs ${num(n.averagePerLoggedDay.carbs, 0)} g · fat ${num(n.averagePerLoggedDay.fat, 0)} g per day`),
    n.averagePerLoggedDay?.extras && h('p', { className: 'muted small' }, EXTRA_LABELS.filter(([k]) => n.averagePerLoggedDay!.extras![k] !== undefined).map(([k, label]) => `${label[0]!.toUpperCase()}${label.slice(1)} ${num(n.averagePerLoggedDay!.extras![k]!, 1)} g`).join(' · '), ' per day'),
    n.averagePerLoggedDay?.extras && (n.goals.fiberG !== null || n.goals.satFatG !== null || n.goals.addedSugarG !== null) && h('p', { className: 'muted small' }, [n.goals.fiberG !== null && `fiber target ${num(n.goals.fiberG, 0)} g`, n.goals.satFatG !== null && `sat. fat limit ${num(n.goals.satFatG, 0)} g`, n.goals.addedSugarG !== null && `added sugar limit ${num(n.goals.addedSugarG, 0)} g`].filter(Boolean).join(' · ')),
    chart,
    chart && n.goals.kcal !== null && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1' }), 'calories per day'), h('span', {}, h('i', { className: 'goalsw' }), `goal ${num(n.goals.kcal, 0)} kcal`)),
    a.kcalWithin10Pct !== null && h('p', { className: 'small' }, `Calories within 10 % of your goal on ${a.kcalWithin10Pct} of ${a.ofDays} logged days.`),
    a.proteinReached !== null && h('p', { className: 'small' }, `Protein goal reached on ${a.proteinReached} of ${a.ofDays}.`),
    n.goals.kcal === null && n.averagePerLoggedDay && empty('Set calorie and macro goals with Claude to see them on the chart.'),
  );
}

function energyCard(p: Progress) {
  const v = energyView(p.energy);
  const top = Math.max(v.burned ?? 0, v.eaten ?? 0, 1);
  const bar = (label: string, kcal: number, cls: string) =>
    h('div', { className: 'row' }, h('span', { className: 'name' }, label), h('span', { className: 'val' }, `~${num(kcal, 0)} kcal`), h('div', { className: `meter ${cls}`, 'aria-hidden': 'true' }, h('span', { css: { width: `${Math.round((kcal / top) * 100)}%` } })));
  return h(
    'section',
    { className: 'card', 'aria-label': 'Energy' },
    h('h2', {}, 'Energy'),
    v.empty ? h('p', { className: 'muted small' }, v.empty) : h('p', { className: 'headline' }, v.headline),
    v.empty && v.reason && h('p', { className: 'muted small' }, v.reason),
    v.burned !== null && h('div', { className: 'rows' }, v.eaten !== null && bar('Eaten (average)', v.eaten, 'eaten'), bar('Burned (estimate)', v.burned, 'burned')),
    v.gap && h('p', { className: 'small' }, v.gap),
    v.trend && h('p', { className: 'small' }, v.trend),
    v.target && h('p', { className: 'small' }, v.target),
    v.goalDate && h('p', { className: 'small' }, v.goalDate),
    v.ask && h('p', { className: 'muted small' }, v.ask),
    v.basis && h('p', { className: 'muted small' }, v.basis),
  );
}

function trainingCard(p: Progress) {
  const t = p.training;
  const chart = trainingChart(p);
  const total = t.sessions.strength + t.sessions.cardio + t.sessions.session;
  const maxSets = Math.max(1, ...t.setsPerWeekByMuscle.map((m) => m.sets));
  return h(
    'section',
    { className: 'card', 'aria-label': 'Training' },
    h('h2', {}, 'Training'),
    total === 0
      ? empty('No workouts in this period.')
      : h('p', { className: 'headline' }, `${num(total / Math.max(1, t.weeks.length))} `, h('small', {}, `workouts a week${t.goalWorkoutsPerWeek ? ` (goal ${t.goalWorkoutsPerWeek})` : ''}${t.averageStrengthMin ? ` · strength sessions about ${t.averageStrengthMin} min` : ''}`)),
    chart,
    chart && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1' }), `strength ${t.sessions.strength}`), h('span', {}, h('i', { className: 'sw2' }), `cardio & classes ${t.sessions.cardio + t.sessions.session}`)),
    t.setsPerWeekByMuscle.length > 0 && h('h2', { className: 'small muted' }, 'Working sets per week, by muscle'),
    t.setsPerWeekByMuscle.length > 0 &&
      h('div', { className: 'rows' }, ...t.setsPerWeekByMuscle.slice(0, 8).map((m) => h('div', { className: 'row' }, h('span', { className: 'name' }, m.muscle), h('span', { className: 'val' }, num(m.sets)), h('div', { className: 'meter', 'aria-hidden': 'true' }, h('span', { css: { width: `${Math.round((m.sets / maxSets) * 100)}%` } }))))),
  );
}

function recordsCard(p: Progress) {
  const r = p.records.exercises;
  return h(
    'section',
    { className: 'card', 'aria-label': 'Strength' },
    h('h2', {}, 'Strength (estimated 1RM)'),
    r.length === 0
      ? empty('Log weighted exercises in the workout player to see estimated one-rep maxes.')
      : h(
          'div',
          { className: 'rows' },
          ...r.map((e) =>
            h(
              'div',
              { className: 'rec' },
              h('div', {}, h('div', { className: 'name' }, e.name), h('div', { className: 'val' }, e.sessions > 1 ? `${num(e.firstE1rmKg)} → ${num(e.latestE1rmKg)} kg · best ${num(e.bestE1rmKg)} kg (${fmtDay(e.bestDay)})` : `${num(e.latestE1rmKg)} kg · one session`)),
              sparkline(e.points.map((q) => ({ day: q.day, value: q.e1rmKg }))),
            ),
          ),
        ),
    r.length > 0 && empty('Epley estimate from working sets of 12 reps or fewer.'),
  );
}

function measurementsCard(p: Progress) {
  const m = p.measurements.types;
  if (m.length === 0) return null;
  const picked = m.find((t) => t.key === state.measure) ?? m[0]!;
  return h(
    'section',
    { className: 'card', 'aria-label': 'Measurements' },
    h('h2', {}, 'Measurements'),
    m.length > 1 && h('div', { className: 'seg wrap', role: 'group', 'aria-label': 'Measurement' }, ...m.map((t) => h('button', { type: 'button', 'aria-pressed': String(t.key === picked.key), onclick: () => { state.measure = t.key; render(); } }, t.label))),
    h('p', { className: 'headline' }, `${num(picked.latest)} ${picked.unit} `, picked.points.length > 1 && h('small', {}, `${signed(picked.change)} ${picked.unit} since ${fmtDay(picked.firstDay)}`)),
    lineChart({ from: p.from, to: p.to, label: `${picked.label} from ${rangeLabel(p.from, p.to)}: ${picked.points.length} measurements, ${num(picked.first)} to ${num(picked.latest)} ${picked.unit}.`, columns: ['Date', `${picked.label} (${picked.unit})`], dots: picked.points, line: picked.points, boldSingle: true, dotRadius: 2.2 }),
    picked.points.length < 2 && empty('A line needs at least two measurements.'),
    m.length > 1 && h('div', { className: 'rows' }, ...m.filter((t) => t.key !== picked.key).map((t) => h('div', { className: 'row' }, h('span', { className: 'name' }, t.label), h('span', { className: 'val' }, t.firstDay === t.latestDay ? `${num(t.latest)} ${t.unit}` : `${num(t.first)} → ${num(t.latest)} ${t.unit} (${signed(t.change)})`)))),
  );
}

const SLEEP_TARGET_H = 8;

function habitsCard(p: Progress) {
  const x = p.metrics;
  if (!x.sleep.daily.length && !x.steps.daily.length && !x.water.daily.length) return null;
  const tabs = ([['sleep', 'Sleep', x.sleep.daily.length], ['steps', 'Steps', x.steps.daily.length], ['water', 'Water', x.water.daily.length]] as const).filter((t) => t[2] > 0);
  const picked = tabs.find((t) => t[0] === state.habit) ?? tabs[0]!;
  const kind = picked[0];
  const series = kind === 'sleep' ? x.sleep.daily.map((d) => ({ day: d.day, value: d.hours })) : kind === 'steps' ? x.steps.daily.map((d) => ({ day: d.day, value: d.steps })) : x.water.daily.map((d) => ({ day: d.day, value: d.ml / 1000 }));
  const unit = kind === 'sleep' ? 'h' : kind === 'steps' ? 'steps' : 'L';
  const avg = kind === 'sleep' ? x.sleep.averageHours : kind === 'steps' ? x.steps.average : x.water.averageMl === null ? null : x.water.averageMl / 1000;
  return h(
    'section',
    { className: 'card', 'aria-label': 'Sleep, steps and water' },
    h('h2', {}, 'Sleep, steps and water'),
    tabs.length > 1 && h('div', { className: 'seg', role: 'group', 'aria-label': 'Habit' }, ...tabs.map((t) => h('button', { type: 'button', 'aria-pressed': String(t[0] === kind), onclick: () => { state.habit = t[0]; render(); } }, t[1]))),
    avg !== null && h('p', { className: 'headline' }, `${num(avg, kind === 'steps' ? 0 : 1)} ${unit} `, h('small', {}, `average on ${series.length} logged ${series.length === 1 ? 'day' : 'days'}`)),
    barChart({ from: p.from, to: p.to, days: p.days, label: `${picked[1]} per logged day, ${series.length} days, average ${avg === null ? 'unknown' : num(avg, kind === 'steps' ? 0 : 1)} ${unit}.`, columns: ['Date', `${picked[1]} (${unit})`], points: series, digits: kind === 'steps' ? 0 : 1, reference: kind === 'sleep' ? SLEEP_TARGET_H : undefined }),
    kind === 'sleep' && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1' }), 'hours slept'), h('span', {}, h('i', { className: 'goalsw' }), `${SLEEP_TARGET_H} h`)),
  );
}

/** A drawing bug must never leave a blank frame: say so, and tell the host's log. */
function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The dashboard could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `dashboard draw failed: ${message}` }).catch(() => undefined);
  }
}

function draw() {
  const p = state.progress;
  const controls = h(
    'header',
    {},
    h('h1', {}, 'Your progress'),
    h('div', { className: 'seg', role: 'group', 'aria-label': 'Period' }, ...RANGES.map((d) => h('button', { type: 'button', 'aria-pressed': String(state.days === d), disabled: state.loading, onclick: () => void load(d) }, d === 365 ? '1 year' : `${d} days`))),
  );
  if (!p) {
    root.replaceChildren(controls, state.error ? h('p', { className: 'error center' }, state.error) : h('p', { className: 'muted center' }, 'Loading your progress…'));
    return;
  }
  const ctx = app.getHostContext();
  const pagerCards: PagerCard[] = [];
  for (const [title, el] of [['Weight', weightCard(p)], ['Nutrition', nutritionCard(p)], ['Energy', energyCard(p)], ['Training', trainingCard(p)], ['Strength', recordsCard(p)], ['Habits', habitsCard(p)], ['Measures', measurementsCard(p)]] as [string, HTMLElement | null][]) if (el) pagerCards.push({ title, el });
  root.replaceChildren(
    controls,
    h('p', { className: 'muted small' }, `${rangeLabel(p.from, p.to)}${state.loading ? ' · updating…' : ''}`),
    state.error && h('p', { className: 'error small' }, state.error),
    ...buildPager(pagerCards, state.card, (i) => (state.card = i)),
    h('footer', {}, `${ctx?.platform ?? 'unknown platform'} · trends use the 7-day average; a single weigh-in swings with water and food.`),
  );
}

async function load(days: number) {
  state.days = days;
  state.loading = true;
  state.error = '';
  render();
  try {
    const res = await app.callServerTool({ name: 'get_dashboard_data', arguments: { days } });
    const progress = (res.structuredContent as { progress?: Progress } | undefined)?.progress;
    if (res.isError || !progress) throw new Error('no data');
    state.progress = progress;
  } catch {
    state.error = 'Could not load that period. Try again.';
  }
  state.loading = false;
  render();
}

// ---------- host wiring (handlers before connect, so one-shot notifications are not missed) ----------
function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const progress = (result.structuredContent as { progress?: Progress } | undefined)?.progress;
  if (progress) {
    state.progress = progress;
    state.days = progress.days <= 45 ? 30 : progress.days <= 180 ? 90 : 365;
    render();
  } else if (result.isError) {
    state.error = 'The dashboard could not be opened. Claude will explain why.';
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
