import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { Progress } from '../../src/analytics/types';
import { barChart, consistencyCalendar, crossesYear, fmtDay, lineChart, num, rangeLabel, sparkline, stackedWeekBars, weekBars } from '../shared/chart';
import { weekMidpoint } from '../shared/chartMath';
import { shortName } from '../shared/names';
import { MUSCLE_REGIONS, setsByRegion, WEEKLY_SET_RANGE } from '../../src/analytics/muscleTypes';
import { h } from '../shared/dom';
import { energyView } from './energy';
import { buildPager, type PagerCard } from '../shared/pager';

const RANGES = [30, 90, 365] as const;
const state = { progress: null as Progress | null, days: 90 as number, loading: false, error: '', card: 0, allLifts: false, measure: '', habit: 'sleep' as 'sleep' | 'steps' | 'water', volume: 'sets' as 'sets' | 'volume' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell dashboard', version: '0.1.0' }, {}, { autoResize: true });


const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n), digits)}`;

/** Charts start where the data does, not at the start of the period. */
const startOf = (p: Progress) => (p.dataFrom && p.dataFrom > p.from ? p.dataFrom : p.from);
const daysShown = (p: Progress) => Math.floor((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${startOf(p)}T00:00:00Z`)) / 86_400_000) + 1;
/** Dates carry the year when what is shown crosses one. */
const dayLabel = (p: Progress, d: string) => fmtDay(d, crossesYear(startOf(p), p.to));

// ---------- charts ----------
function weightChart(p: Progress) {
  const w = p.weight;
  if (w.daily.length === 0) return null;
  return lineChart({
    from: startOf(p),
    to: p.to,
    label: `Weight from ${rangeLabel(startOf(p), p.to)}: ${w.daily.length} weigh-ins${w.trendChangeKg !== null ? `, 7-day average changed by ${signed(w.trendChangeKg)} kg` : ''}.`,
    columns: ['Date', 'Weigh-in (kg)', '7-day average (kg)'],
    dots: w.daily.map((d) => ({ day: d.day, value: d.kg })),
    line: w.average.map((d) => ({ day: d.day, value: d.kg })),
    goal: w.goalKg ? { value: w.goalKg } : undefined,
    height: 150,
    pad: [0.1, 0.5],
    dotsOnTop: true,
  });
}

/** Longer periods show a weekly average instead of a bar a day, so the bars stay readable. */
const weekly = (p: Progress) => p.days >= 60 && p.nutrition.weeks.length > 0;

function nutritionChart(p: Progress) {
  const n = p.nutrition;
  if (n.daily.length === 0) return null;
  const average = n.averagePerLoggedDay ? `, average ${num(n.averagePerLoggedDay.kcal, 0)} kcal` : '';
  if (weekly(p)) {
    return barChart({
      from: startOf(p),
      to: p.to,
      days: n.weeks.length,
      label: `Average calories per logged day, by week, ${n.weeks.length} weeks${average}.`,
      columns: ['Week of', 'Average calories (kcal a day)'],
      points: n.weeks.map((w) => ({ day: weekMidpoint(w.week, startOf(p), p.to), value: w.kcal })),
      height: 130,
      headroom: 1.08,
      reference: n.goals.kcal ?? undefined,
    });
  }
  return barChart({
    from: startOf(p),
    to: p.to,
    days: daysShown(p),
    label: `Calories per logged day, ${n.daysLogged} days${average}.`,
    columns: ['Date', 'Calories (kcal)'],
    points: n.daily.map((d) => ({ day: d.day, value: d.kcal })),
    height: 130,
    headroom: 1.08,
    reference: n.goals.kcal ?? undefined,
  });
}

function proteinChart(p: Progress) {
  const n = p.nutrition;
  if (!weekly(p)) return null;
  const points = n.weeks.map((w) => ({ day: weekMidpoint(w.week, startOf(p), p.to), value: w.protein }));
  return lineChart({ from: startOf(p), to: p.to, label: `Average protein per logged day, by week: ${num(n.weeks[0]!.protein, 0)} to ${num(n.weeks[n.weeks.length - 1]!.protein, 0)} g.`, columns: ['Week of', 'Protein (g a day)'], dots: points, line: points, goal: n.goals.proteinG ? { value: n.goals.proteinG, atStart: true } : undefined, digits: 0, height: 100, boldSingle: true });
}

function trainingChart(p: Progress) {
  const wk = p.training.weeks;
  if (!wk.some((w) => w.strength + w.cardio + w.session > 0)) return null;
  return weekBars({
    weeks: wk.map((w) => ({ week: w.week, a: w.strength, b: w.cardio + w.session, partial: w.partial })),
    to: p.to,
    label: `Workouts per week over ${wk.length} weeks: ${p.training.sessions.strength} strength and ${p.training.sessions.cardio + p.training.sessions.session} cardio or class sessions in total.`,
    columns: ['Week', 'Strength workouts', 'Cardio and class workouts'],
    goal: p.training.goalWorkoutsPerWeek,
  });
}

const REGION_NAME = { upper: 'Upper body', lower: 'Lower body', core: 'Core' } as const;
const tonnes = (v: number) => (v >= 1000 ? `${num(v / 1000, 1)}k` : num(v, 0));

/** Weekly volume of finished strength workouts: hard sets stacked by body region (Sets) or tonnage (Volume). */
function volumeChart(p: Progress) {
  const wk = p.training.weeks;
  const { low, high } = WEEKLY_SET_RANGE;
  if (state.volume === 'volume') {
    if (!wk.some((w) => w.tonnageKg > 0)) return null;
    return stackedWeekBars({ weeks: wk.map((w) => ({ week: w.week, values: [w.tonnageKg], partial: w.partial })), to: p.to, label: `Weekly training volume over ${wk.length} weeks: reps times weight of the working sets, from ${tonnes(Math.min(...wk.map((w) => w.tonnageKg)))} to ${tonnes(Math.max(...wk.map((w) => w.tonnageKg)))} kg.`, columns: ['Week', 'Volume (kg)'], tick: tonnes });
  }
  if (!wk.some((w) => Object.keys(w.sets).length > 0)) return null;
  const rows = wk.map((w) => ({ w, r: setsByRegion(w.sets) }));
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return stackedWeekBars({ weeks: rows.map(({ w, r }) => ({ week: w.week, values: MUSCLE_REGIONS.map((k) => r1(r[k])), partial: w.partial })), to: p.to, label: `Weekly hard sets over ${wk.length} weeks, stacked by upper body, lower body and core.`, columns: ['Week', ...MUSCLE_REGIONS.map((k) => `${REGION_NAME[k]} (sets)`)], lines: [low, high], digits: 0 });
}

function volumeBlock(p: Progress) {
  const chart = volumeChart(p);
  const t = p.training;
  const { low, high } = WEEKLY_SET_RANGE;
  return [
    h('h2', { className: 'small muted' }, 'Training volume, by week'),
    h('div', { className: 'seg big', role: 'group', 'aria-label': 'Volume measure' }, ...([['sets', 'Sets'], ['volume', 'Volume']] as const).map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(state.volume === k), onclick: () => { state.volume = k; render(); } }, label))),
    chart ?? empty(state.volume === 'sets' ? 'No finished strength sets in this period.' : 'No weighted sets in this period.'),
    chart && state.volume === 'sets' && h('div', { className: 'legend' }, ...MUSCLE_REGIONS.map((k, i) => h('span', {}, h('i', { className: `sw-s${i}` }), REGION_NAME[k].toLowerCase())), h('span', {}, h('i', { className: 'goalsw' }), `${low} and ${high}`)),
    chart && state.volume === 'sets' && h('p', { className: 'muted small' }, `Each bar adds up the hard sets credited to every muscle (1 for a main muscle, 0.5 for a helping one). The dashed lines mark ${low} and ${high}, the usual weekly range for one muscle.`),
    chart && state.volume === 'volume' && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw-s0' }), 'kg lifted: reps × weight of working sets')),
    chart && t.weeks.some((w) => w.partial) && h('p', { className: 'muted small' }, 'Outline: week not complete.'),
  ];
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
      : w.trendKg !== null
        ? h('p', { className: 'headline' }, `${num(w.trendKg)} kg `, h('small', {}, `trend${w.trendChangeKg !== null ? ` · ${signed(w.trendChangeKg)} kg since ${dayLabel(p, w.average[0]!.day)}` : ''}`))
        : h('p', { className: 'headline' }, `${num(w.latestKg)} kg `, h('small', {}, 'last weigh-in')),
    w.trendKg !== null && w.latestKg !== null && h('p', { className: 'muted small' }, `Last weigh-in ${num(w.latestKg)} kg on ${dayLabel(p, w.latestDay!)}`),
    w.fromGoalKg !== null && h('p', { className: 'muted small' }, `${num(w.fromGoalKg)} kg from your goal of ${num(w.goalKg!)} kg${w.trendKg !== null ? ' (by the trend)' : ''}`),
    chart,
    chart && w.trendChangeKg === null && empty('A trend line needs at least 3 weigh-ins within a week.'),
    chart && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1 faint' }), 'weigh-in'), h('span', {}, h('i', { className: 'sw1' }), '7-day average'), w.goalKg !== null && h('span', {}, h('i', { className: 'goalsw' }), `goal ${num(w.goalKg)} kg`)),
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
    chart && n.goals.kcal !== null && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1' }), weekly(p) ? 'average calories per day, by week' : 'calories per day'), h('span', {}, h('i', { className: 'goalsw' }), `goal ${num(n.goals.kcal, 0)} kcal`)),
    weekly(p) && h('h2', { className: 'small muted' }, 'Protein, weekly average'),
    proteinChart(p),
    n.proteinPerKg !== null && h('p', { className: 'small' }, `${num(n.proteinPerKg, 1)} g protein per kg of trend weight (average)`),
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
  const { low, high } = WEEKLY_SET_RANGE;
  const scale = Math.max(high * 1.1, ...t.setsPerWeekByMuscle.map((m) => m.sets)); // room past 20, so its tick is inside the bar
  const levelWord = (n: number) => (n < low ? `under ${low}` : n <= high ? `${low}–${high}` : `over ${high}`);
  const tick = (at: number, of: number) => h('i', { className: 'tick', css: { left: `${(at / of) * 100}%` } });
  return h(
    'section',
    { className: 'card', 'aria-label': 'Training' },
    h('h2', {}, 'Training'),
    total === 0
      ? empty('No workouts in this period.')
      : h('p', { className: 'headline' }, `${num(t.perWeek)} `, h('small', {}, `workouts a week${t.goalWorkoutsPerWeek ? ` (goal ${t.goalWorkoutsPerWeek})` : ''}${t.averageStrengthMin ? ` · strength sessions about ${t.averageStrengthMin} min` : ''}`)),
    chart,
    chart && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1' }), `strength ${t.sessions.strength}`), h('span', {}, h('i', { className: 'sw2' }), `cardio & classes ${t.sessions.cardio + t.sessions.session}`), t.weeks.some((w) => w.partial) && h('span', {}, h('i', { className: 'outline' }), 'outline: week not complete'), t.goalWorkoutsPerWeek !== null && h('span', {}, h('i', { className: 'goalsw' }), `goal ${t.goalWorkoutsPerWeek} a week`)),
    total > 0 && h('h2', { className: 'small muted' }, 'Days trained, by week'),
    total > 0 && consistencyCalendar({ weeks: t.weeks.map((w) => w.week), days: t.days, to: p.to, goal: t.goalWorkoutsPerWeek }),
    total > 0 && h('p', { className: 'muted small' }, 'S strength · C cardio · P class · outline: no workout'),
    ...(total > 0 ? volumeBlock(p) : []),
    t.setsPerWeekByMuscle.length > 0 && h('h2', { className: 'small muted' }, 'Hard sets a week, by muscle'),
    t.setsPerWeekByMuscle.length > 0 &&
      h(
        'div',
        { className: 'rows' },
        ...t.setsPerWeekByMuscle.slice(0, 8).map((m) =>
          h('div', { className: 'row' }, h('span', { className: 'name' }, m.muscle), h('span', { className: 'val' }, `${num(m.sets)} · ${levelWord(m.sets)}`), h('div', { className: 'meter', 'aria-hidden': 'true' }, h('span', { css: { width: `${Math.min(100, (m.sets / scale) * 100)}%` } }), tick(low, scale), tick(high, scale))),
        ),
      ),
    t.setsPerWeekByMuscle.length > 0 && h('p', { className: 'muted small' }, `A set counts 1 for the muscles an exercise mainly works and 0.5 for the ones that help. The ticks mark ${low} and ${high} hard sets a week, the usual range. Ask Claude to show the muscle map.`),
  );
}

const FIRST_LIFTS = 6;

/** One lift: a row with its numbers, opening to the e1RM line (◆ marks a new best), and the last 5 sessions. */
function liftRow(p: Progress, e: Progress['records']['exercises'][number]) {
  const name = shortName(e.name);
  const values = e.sessions.length > 1 ? `${num(e.firstE1rmKg)} → ${num(e.latestE1rmKg)} kg · best ${num(e.bestE1rmKg)} kg (${dayLabel(p, e.bestDay)})` : `${num(e.latestE1rmKg)} kg · one session`;
  const bests = e.sessions.filter((x) => x.isBest);
  const recent = e.sessions.slice(-5).reverse();
  return h(
    'details',
    { className: 'lift' },
    h('summary', { 'aria-label': `${e.name}: ${values}` }, h('div', {}, h('div', { className: 'name' }, name), h('div', { className: 'val' }, values)), sparkline(e.points.map((q) => ({ day: q.day, value: q.e1rmKg })))),
    lineChart({ from: startOf(p), to: p.to, label: `${e.name}, estimated 1RM by session: ${num(e.firstE1rmKg)} to ${num(e.latestE1rmKg)} kg${bests.length ? `, ${bests.length} new best${bests.length === 1 ? '' : 's'}` : ''}.`, columns: ['Date', 'Estimated 1RM (kg)'], dots: e.points.map((q) => ({ day: q.day, value: q.e1rmKg })), line: e.points.map((q) => ({ day: q.day, value: q.e1rmKg })), digits: 0, height: 110, boldSingle: true, dotRadius: 2.2, marks: bests.map((x) => x.day) }),
    bests.length > 0 && h('p', { className: 'muted small' }, '◆ new best estimate'),
    h(
      'table',
      { className: 'sessions' },
      h('caption', {}, `Last ${recent.length} session${recent.length === 1 ? '' : 's'}`),
      h('thead', {}, h('tr', {}, ...['Date', 'Top set', 'Est. 1RM', ''].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, ...recent.map((x) => h('tr', {}, h('td', {}, dayLabel(p, x.day)), h('td', {}, `${x.topSet.reps} × ${num(x.topSet.kg)} kg`), h('td', {}, `${num(x.e1rm)} kg`), h('td', {}, x.isBest ? '◆ best' : '')))),
    ),
    h('p', { className: 'muted small' }, `Open full lift page: ask Claude to show your ${name} progress.`),
  );
}

function recordsCard(p: Progress) {
  const r = p.records.exercises;
  const shown = state.allLifts ? r : r.slice(0, FIRST_LIFTS);
  return h(
    'section',
    { className: 'card', 'aria-label': 'Strength' },
    h('h2', {}, 'Strength (estimated 1RM)'),
    r.length === 0 ? empty('Log weighted exercises in the workout player to see estimated one-rep maxes.') : h('div', { className: 'rows' }, ...shown.map((e) => liftRow(p, e))),
    r.length > FIRST_LIFTS && h('button', { type: 'button', className: 'more', onclick: () => { state.allLifts = !state.allLifts; render(); } }, state.allLifts ? `Show fewer lifts` : `Show all lifts (${r.length})`),
    r.length > 0 && empty('Epley estimate from sets of 12 reps or fewer.'),
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
    h('p', { className: 'headline' }, `${num(picked.latest)} ${picked.unit} `, picked.points.length > 1 && h('small', {}, `${signed(picked.change)} ${picked.unit} since ${dayLabel(p, picked.firstDay)}`)),
    lineChart({ from: startOf(p), to: p.to, label: `${picked.label} from ${rangeLabel(startOf(p), p.to)}: ${picked.points.length} measurements, ${num(picked.first)} to ${num(picked.latest)} ${picked.unit}.`, columns: ['Date', `${picked.label} (${picked.unit})`], dots: picked.points, line: picked.points, boldSingle: true, dotRadius: 2.2 }),
    picked.points.length < 2 && empty('A line needs at least two measurements.'),
    m.length > 1 && h('div', { className: 'rows' }, ...m.filter((t) => t.key !== picked.key).map((t) => h('div', { className: 'row' }, h('span', { className: 'name' }, t.label), h('span', { className: 'val' }, t.firstDay === t.latestDay ? `${num(t.latest)} ${t.unit}` : `${num(t.first)} → ${num(t.latest)} ${t.unit} (${signed(t.change)})`)))),
  );
}

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
    barChart({ from: startOf(p), to: p.to, days: daysShown(p), label: `${picked[1]} per logged day, ${series.length} days, average ${avg === null ? 'unknown' : num(avg, kind === 'steps' ? 0 : 1)} ${unit}.`, columns: ['Date', `${picked[1]} (${unit})`], points: series, digits: kind === 'steps' ? 0 : 1, reference: kind === 'sleep' ? x.sleep.goalHours ?? undefined : undefined }),
    kind === 'sleep' && avg !== null && x.sleep.goalHours !== null && h('p', { className: 'muted small' }, `Your sleep goal is ${num(x.sleep.goalHours)} h a night.`),
    kind === 'sleep' && h('div', { className: 'legend' }, h('span', {}, h('i', { className: 'sw1' }), 'hours slept'), x.sleep.goalHours !== null && h('span', {}, h('i', { className: 'goalsw' }), `sleep goal ${num(x.sleep.goalHours)} h`)),
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
  const pagerCards: PagerCard[] = [];
  for (const [title, el] of [['Weight', weightCard(p)], ['Nutrition', nutritionCard(p)], ['Energy', energyCard(p)], ['Training', trainingCard(p)], ['Strength', recordsCard(p)], ['Habits', habitsCard(p)], ['Measures', measurementsCard(p)]] as [string, HTMLElement | null][]) if (el) pagerCards.push({ title, el });
  root.replaceChildren(
    controls,
    h('p', { className: 'muted small' }, `${rangeLabel(startOf(p), p.to)}${startOf(p) > p.from ? ` · since your first log on ${dayLabel(p, startOf(p))}` : ''}${state.loading ? ' · updating…' : ''}`),
    state.error && h('p', { className: 'error small' }, state.error),
    ...buildPager(pagerCards, state.card, (i) => (state.card = i)),
    h('footer', {}, 'Trends use the 7-day average; a single weigh-in swings with water and food.'),
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
