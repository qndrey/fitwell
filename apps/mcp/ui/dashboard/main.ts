import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { Progress } from '../../src/analytics/types';

const RANGES = [30, 90, 365] as const;
const state = { progress: null as Progress | null, days: 90 as number, loading: false, error: '', measure: '', habit: 'sleep' as 'sleep' | 'steps' | 'water' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell dashboard', version: '0.1.0' }, {}, { autoResize: true });

// ---------- tiny DOM and SVG helpers (textContent only: names come from data, never parsed as HTML) ----------
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
const NS = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const num = (n: number, digits = 1) => n.toLocaleString('en-GB', { maximumFractionDigits: digits });
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n), digits)}`;

// ---------- charts ----------
const W = 340;
const M = { l: 36, r: 8, t: 8, b: 20 };

function scale(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function axisLabels(svg: SVGElement, from: string, to: string, h: number) {
  svg.append(s('text', { x: M.l, y: h - 5 }, fmtDay(from)), s('text', { x: W - M.r, y: h - 5, 'text-anchor': 'end' }, fmtDay(to)));
}

function weightChart(p: Progress): SVGElement | null {
  const w = p.weight;
  if (w.daily.length === 0) return null;
  const H = 150;
  const values = [...w.daily.map((d) => d.kg), ...w.average.map((d) => d.kg), ...(w.goalKg ? [w.goalKg] : [])];
  const pad = Math.max(0.5, (Math.max(...values) - Math.min(...values)) * 0.1);
  const y = scale(Math.min(...values) - pad, Math.max(...values) + pad, H - M.b, M.t);
  const x = scale(dayNum(p.from), dayNum(p.to), M.l, W - M.r);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Weight from ${fmtDay(p.from)} to ${fmtDay(p.to)}: ${w.daily.length} weigh-ins${w.trendChangeKg !== null ? `, 7-day average changed by ${signed(w.trendChangeKg)} kg` : ''}.` });
  const lo = Math.min(...values) - pad;
  const hi = Math.max(...values) + pad;
  for (const v of [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15]) svg.append(s('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }), s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, num(v)));
  if (w.goalKg) svg.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(w.goalKg), y2: y(w.goalKg) }), s('text', { x: W - M.r, y: y(w.goalKg) - 4, 'text-anchor': 'end' }, `goal ${num(w.goalKg)}`));
  for (const d of w.daily) svg.append(s('circle', { class: 'dot', cx: x(dayNum(d.day)), cy: y(d.kg), r: 2.5 }));
  if (w.average.length > 1) svg.append(s('polyline', { class: 'line', points: w.average.map((d) => `${x(dayNum(d.day))},${y(d.kg)}`).join(' ') }));
  axisLabels(svg, p.from, p.to, H);
  return svg;
}

function nutritionChart(p: Progress): SVGElement | null {
  const n = p.nutrition;
  if (n.daily.length === 0) return null;
  const H = 130;
  const top = Math.max(...n.daily.map((d) => d.kcal), n.goals.kcal ?? 0) * 1.08;
  const y = scale(0, top, H - M.b, M.t);
  const x = scale(dayNum(p.from), dayNum(p.to), M.l, W - M.r);
  const bw = Math.max(1.5, Math.min(14, ((W - M.l - M.r) / p.days) * 0.75));
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Calories per logged day, ${n.daysLogged} days${n.averagePerLoggedDay ? `, average ${num(n.averagePerLoggedDay.kcal, 0)} kcal` : ''}.` });
  svg.append(s('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
  for (const v of [top / 2, top * 0.92]) svg.append(s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, num(v, 0)));
  for (const d of n.daily) svg.append(s('rect', { class: 'bar', x: x(dayNum(d.day)) - bw / 2, y: y(d.kcal), width: bw, height: Math.max(0, H - M.b - y(d.kcal)), rx: 1.5 }));
  if (n.goals.kcal) svg.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(n.goals.kcal), y2: y(n.goals.kcal) }));
  axisLabels(svg, p.from, p.to, H);
  return svg;
}

function trainingChart(p: Progress): SVGElement | null {
  const wk = p.training.weeks;
  if (!wk.some((w) => w.strength + w.cardio > 0)) return null;
  const H = 110;
  const top = Math.max(2, ...wk.map((w) => w.strength + w.cardio));
  const y = scale(0, top, H - M.b, M.t);
  const slot = (W - M.l - M.r) / wk.length;
  const bw = Math.max(2, Math.min(24, slot * 0.7));
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Workouts per week over ${wk.length} weeks: ${p.training.sessions.strength} strength and ${p.training.sessions.cardio} cardio sessions in total.` });
  svg.append(s('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
  for (const v of [Math.ceil(top)]) svg.append(s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, String(v)));
  wk.forEach((w, i) => {
    const cx = M.l + slot * (i + 0.5);
    svg.append(s('rect', { class: 'bar', x: cx - bw / 2, y: y(w.strength), width: bw, height: Math.max(0, H - M.b - y(w.strength)), rx: 1.5 }));
    svg.append(s('rect', { class: 'bar2', x: cx - bw / 2, y: y(w.strength + w.cardio), width: bw, height: Math.max(0, y(w.strength) - y(w.strength + w.cardio)), rx: 1.5 }));
  });
  if (p.training.goalWorkoutsPerWeek) svg.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(p.training.goalWorkoutsPerWeek), y2: y(p.training.goalWorkoutsPerWeek) }));
  axisLabels(svg, wk[0]!.week, p.to, H);
  return svg;
}

/** A line through (day, value) points with a few grid labels; one point is drawn as a dot. */
function lineChart(points: { day: string; value: number }[], from: string, to: string, label: string, digits = 1): SVGElement {
  const H = 120;
  const vals = points.map((q) => q.value);
  const pad = Math.max(digits === 0 ? 1 : 0.2, (Math.max(...vals) - Math.min(...vals)) * 0.15);
  const lo = Math.min(...vals) - pad;
  const hi = Math.max(...vals) + pad;
  const y = scale(lo, hi, H - M.b, M.t);
  const x = scale(dayNum(from), dayNum(to), M.l, W - M.r);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  for (const v of [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15]) svg.append(s('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }), s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, num(v, digits)));
  if (points.length > 1) svg.append(s('polyline', { class: 'line', points: points.map((q) => `${x(dayNum(q.day))},${y(q.value)}`).join(' ') }));
  for (const q of points) svg.append(s('circle', { class: points.length > 1 ? 'dot' : 'dotfull', cx: x(dayNum(q.day)), cy: y(q.value), r: points.length > 1 ? 2.2 : 3.5 }));
  axisLabels(svg, from, to, H);
  return svg;
}

/** One bar per logged day, from zero; an optional dashed reference line (a target). */
function barChart(points: { day: string; value: number }[], from: string, to: string, days: number, label: string, digits = 0, reference?: number): SVGElement {
  const H = 110;
  const top = Math.max(...points.map((q) => q.value), reference ?? 0, 1) * 1.1;
  const y = scale(0, top, H - M.b, M.t);
  const x = scale(dayNum(from), dayNum(to), M.l, W - M.r);
  const bw = Math.max(1.5, Math.min(14, ((W - M.l - M.r) / days) * 0.75));
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  svg.append(s('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
  for (const v of [top / 2, top * 0.92]) svg.append(s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, num(v, digits)));
  for (const q of points) svg.append(s('rect', { class: 'bar', x: x(dayNum(q.day)) - bw / 2, y: y(q.value), width: bw, height: Math.max(0, H - M.b - y(q.value)), rx: 1.5 }));
  if (reference) svg.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(reference), y2: y(reference) }));
  axisLabels(svg, from, to, H);
  return svg;
}

function sparkline(points: { day: string; e1rmKg: number }[]): SVGElement {
  const svg = s('svg', { viewBox: '0 0 90 28', width: 90, height: 28, 'aria-hidden': 'true' });
  if (points.length < 2) return svg;
  const x = scale(dayNum(points[0]!.day), dayNum(points[points.length - 1]!.day), 2, 88);
  const vals = points.map((q) => q.e1rmKg);
  const y = scale(Math.min(...vals), Math.max(...vals), 25, 3);
  svg.append(s('polyline', { class: 'spark', points: points.map((q) => `${x(dayNum(q.day))},${y(q.e1rmKg)}`).join(' ') }));
  return svg;
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

function trainingCard(p: Progress) {
  const t = p.training;
  const chart = trainingChart(p);
  const total = t.sessions.strength + t.sessions.cardio;
  const maxSets = Math.max(1, ...t.setsPerWeekByMuscle.map((m) => m.sets));
  return h(
    'section',
    { className: 'card', 'aria-label': 'Training' },
    h('h2', {}, 'Training'),
    total === 0
      ? empty('No workouts in this period.')
      : h('p', { className: 'headline' }, `${num(total / Math.max(1, t.weeks.length))} `, h('small', {}, `workouts a week${t.goalWorkoutsPerWeek ? ` (goal ${t.goalWorkoutsPerWeek})` : ''}${t.averageStrengthMin ? ` · strength sessions about ${t.averageStrengthMin} min` : ''}`)),
    chart,
    chart && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1' }), `strength ${t.sessions.strength}`), h('span', {}, h('i', { className: 'sw2' }), `cardio ${t.sessions.cardio}`)),
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
              sparkline(e.points),
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
    lineChart(picked.points, p.from, p.to, `${picked.label} from ${fmtDay(p.from)} to ${fmtDay(p.to)}: ${picked.points.length} measurements, ${num(picked.first)} to ${num(picked.latest)} ${picked.unit}.`),
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
    barChart(series, p.from, p.to, p.days, `${picked[1]} per logged day, ${series.length} days, average ${avg === null ? 'unknown' : num(avg, kind === 'steps' ? 0 : 1)} ${unit}.`, kind === 'steps' ? 0 : 1, kind === 'sleep' ? SLEEP_TARGET_H : undefined),
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
  const cards = [weightCard(p), nutritionCard(p), trainingCard(p), recordsCard(p), habitsCard(p), measurementsCard(p)].filter((c): c is HTMLElement => c !== null);
  root.replaceChildren(
    controls,
    h('p', { className: 'muted small' }, `${fmtDay(p.from)} to ${fmtDay(p.to)}${state.loading ? ' · updating…' : ''}`),
    state.error && h('p', { className: 'error small' }, state.error),
    ...cards,
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
