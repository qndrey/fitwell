import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { Progress } from '../../src/analytics/types';
import { barChart, consistencyCalendar, crossesYear, fmtDay, lineChart, num, rangeLabel, stackedWeekBars, weekBars } from '../shared/chart';
import { weekMidpoint } from '../shared/chartMath';
import { shortName } from '../shared/names';
import { MUSCLE_REGIONS, setsByRegion, WEEKLY_SET_RANGE } from '../../src/analytics/muscleTypes';
import { h, type Child } from '../shared/dom';
import { energyView } from './energy';
import { createCardPager, type CardPager } from '../shared/cardPager';

const RANGES = [{ days: 30, short: '30d', long: '30 days' }, { days: 90, short: '90d', long: '90 days' }, { days: 365, short: '1y', long: '1 year' }] as const;
type CardKey = 'weight' | 'nutrition' | 'energy' | 'training' | 'volume' | 'strength' | 'habits' | 'measures';
const state = { progress: null as Progress | null, days: 90 as number, loading: false, error: '', cardKey: 'weight' as CardKey, openLift: '', measure: '', habit: 'sleep' as 'sleep' | 'steps' | 'water', volume: 'sets' as 'sets' | 'volume' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell dashboard', version: '0.1.0' }, {}, { autoResize: true });
let pager: CardPager | null = null;
/** What the live region adds to a card's name when it settles: the card's big number. */
const spoken = new Map<string, string>();

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
    headroom: 1.08,
    reference: n.goals.kcal ?? undefined,
  });
}

function proteinChart(p: Progress) {
  const n = p.nutrition;
  if (!weekly(p)) return null;
  const points = n.weeks.map((w) => ({ day: weekMidpoint(w.week, startOf(p), p.to), value: w.protein }));
  return lineChart({ from: startOf(p), to: p.to, label: `Average protein per logged day, by week: ${num(n.weeks[0]!.protein, 0)} to ${num(n.weeks[n.weeks.length - 1]!.protein, 0)} g.`, columns: ['Week of', 'Protein (g a day)'], dots: points, line: points, goal: n.goals.proteinG ? { value: n.goals.proteinG, atStart: true } : undefined, digits: 0, height: 110, boldSingle: true });
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

// ---------- building blocks ----------
const empty = (text: string) => h('p', { className: 'muted small' }, text);
const caption = (text: string) => h('p', { className: 'cap' }, text);
/** The heading a screen reader lands on after the buttons; the label row names the card for everyone else. */
const heading = (name: string) => h('h2', { className: 'sr-only', tabIndex: -1, 'data-focus': '' }, name);
/** The one tinted block of a card: the big number, its sentence, a chart and a caption. */
const tint = (number: string | null, sentence: string | null, ...rest: Child[]) => h('div', { className: 'tint' }, number && h('p', { className: 'big' }, number), sentence && h('p', { className: 'muted small' }, sentence), ...rest);
const hrow = (label: string, value: string, note?: string | null) => h('div', { className: 'hrow' }, h('span', { className: 'name' }, label), h('span', { className: 'val' }, value, note && h('span', { className: 'muted' }, ` ${note}`)));
const subhead = (text: string) => h('h3', { className: 'sub' }, text);
/** Text buttons that pick one of a few views: the chosen one is semibold and underlined. */
const toggle = (label: string, options: readonly (readonly [string, string])[], current: string, pick: (key: string) => void) =>
  h('div', { className: 'toggle', role: 'group', 'aria-label': label }, ...options.map(([key, text]) => h('button', { type: 'button', className: 'link', 'data-key': `toggle-${label}-${key}`, 'aria-pressed': String(key === current), onclick: () => pick(key) }, text)));

interface Built {
  key: CardKey;
  name: string;
  /** Said with the card's name when it comes into view. */
  say?: string;
  body: Child[];
}

function weightCard(p: Progress): Built {
  const w = p.weight;
  const chart = weightChart(p);
  const name = 'Weight';
  if (w.latestKg === null) return { key: 'weight', name, body: [heading(name), empty('No weigh-ins in this period. Tell Claude your weight to start the chart.')] };
  const number = `${num(w.trendKg ?? w.latestKg)} kg`;
  return {
    key: 'weight',
    name,
    say: number,
    body: [
      heading(name),
      tint(number, w.trendKg !== null ? `trend${w.trendChangeKg !== null ? `, ${signed(w.trendChangeKg)} kg since ${dayLabel(p, w.average[0]!.day)}` : ''} (7-day average)` : 'last weigh-in', chart, chart && caption(w.trendChangeKg === null ? 'A trend line needs at least 3 weigh-ins within a week.' : `weigh-ins and the 7-day average${w.goalKg !== null ? '; dashed: your goal' : ''}`)),
      hrow('Last weigh-in', `${num(w.latestKg)} kg`, w.latestDay && `· ${dayLabel(p, w.latestDay)}`),
      w.fromGoalKg !== null && hrow('From your goal', `${num(w.fromGoalKg)} kg`, `of ${num(w.goalKg!)} kg${w.trendKg !== null ? ' (by the trend)' : ''}`),
    ],
  };
}

const EXTRA_ROWS = [['fiber', 'Fiber', 'fiberG', 'target'], ['addedSugar', 'Added sugar', 'addedSugarG', 'limit'], ['satFat', 'Sat. fat', 'satFatG', 'limit']] as const;

function nutritionCard(p: Progress): Built {
  const n = p.nutrition;
  const a = n.adherence;
  const name = 'Nutrition';
  const avg = n.averagePerLoggedDay;
  if (!avg) return { key: 'nutrition', name, body: [heading(name), empty('No food logged in this period. Tell Claude what you eat to start the chart.')] };
  const chart = nutritionChart(p);
  const number = `${num(avg.kcal, 0)} kcal`;
  const g = (v: number) => `${num(v, 0)} g`;
  return {
    key: 'nutrition',
    name,
    say: number,
    body: [
      heading(name),
      tint(number, `average on ${n.daysLogged} logged ${n.daysLogged === 1 ? 'day' : 'days'}${n.goals.kcal !== null ? `, goal ${num(n.goals.kcal, 0)}` : ''}`, chart, chart && caption(weekly(p) ? 'average calories per day, by week' : 'calories per logged day')),
      n.goals.kcal === null && empty('Set calorie and macro goals with Claude to see them on the chart.'),
      hrow('Protein', g(avg.protein), n.goals.proteinG !== null ? `goal ${g(n.goals.proteinG)}` : null),
      hrow('Carbs', g(avg.carbs)),
      hrow('Fat', g(avg.fat)),
      ...EXTRA_ROWS.filter(([k]) => avg.extras?.[k] !== undefined).map(([k, label, goal, word]) => hrow(label, `${num(avg.extras![k]!, 1)} g`, n.goals[goal] !== null ? `${word} ${g(n.goals[goal]!)}` : null)),
      n.proteinPerKg !== null && hrow('Protein per kg', `${num(n.proteinPerKg, 1)} g`, 'of trend weight'),
      weekly(p) && subhead('Protein, weekly average'),
      proteinChart(p),
      a.kcalWithin10Pct !== null && hrow('Calories within 10 % of goal', `${a.kcalWithin10Pct} of ${a.ofDays}`, 'logged days'),
      a.proteinReached !== null && hrow('Protein goal reached', `${a.proteinReached} of ${a.ofDays}`, 'logged days'),
    ],
  };
}

function energyCard(p: Progress): Built {
  const v = energyView(p.energy);
  const name = 'Energy';
  if (v.empty) return { key: 'energy', name, body: [heading(name), empty(v.empty), v.reason && empty(v.reason)] };
  const top = Math.max(v.burned ?? 0, v.eaten ?? 0, 1);
  const bar = (label: string, kcal: number, cls: string) =>
    h('div', { className: 'row' }, h('span', { className: 'name' }, label), h('span', { className: 'val' }, `~${num(kcal, 0)} kcal`), h('div', { className: `meter ${cls}`, 'aria-hidden': 'true' }, h('span', { css: { width: `${Math.round((kcal / top) * 100)}%` } })));
  return {
    key: 'energy',
    name,
    say: v.headline,
    body: [
      heading(name),
      tint(null, null, h('p', { className: 'lead' }, v.headline), h('div', { className: 'rows' }, v.eaten !== null && bar('Eaten (average)', v.eaten, 'eaten'), bar('Burned (estimate)', v.burned!, 'burned'))),
      v.gap && h('p', { className: 'hline' }, v.gap),
      v.trend && h('p', { className: 'hline' }, v.trend),
      v.target && h('p', { className: 'hline' }, v.target),
      v.goalDate && h('p', { className: 'hline' }, v.goalDate),
      v.ask && empty(v.ask),
      empty(v.basis),
    ],
  };
}

function trainingCard(p: Progress): Built {
  const t = p.training;
  const name = 'Training';
  const total = t.sessions.strength + t.sessions.cardio + t.sessions.session;
  if (total === 0) return { key: 'training', name, body: [heading(name), empty('No workouts in this period. Tell Claude about a workout to start the chart.')] };
  const chart = trainingChart(p);
  const number = num(t.perWeek);
  return {
    key: 'training',
    name,
    say: `${number} workouts a week`,
    body: [
      heading(name),
      tint(number, `workouts a week${t.goalWorkoutsPerWeek ? `, goal ${t.goalWorkoutsPerWeek}` : ''}`, chart, chart && caption([`strength ${t.sessions.strength}`, `cardio and classes ${t.sessions.cardio + t.sessions.session}`, t.weeks.some((w) => w.partial) && 'outline: week not complete', t.goalWorkoutsPerWeek !== null && 'dashed: goal'].filter(Boolean).join(' · '))),
      t.averageStrengthMin ? hrow('Strength sessions', `about ${t.averageStrengthMin} min`) : null,
      subhead('Days trained, by week'),
      consistencyCalendar({ weeks: t.weeks.map((w) => w.week), days: t.days, to: p.to, goal: t.goalWorkoutsPerWeek }),
      caption('S strength · C cardio · P class · outline: no workout'),
    ],
  };
}

function volumeCard(p: Progress): Built {
  const t = p.training;
  const name = 'Volume';
  const total = t.sessions.strength + t.sessions.cardio + t.sessions.session;
  if (total === 0) return { key: 'volume', name, body: [heading(name), empty('No workouts in this period. Tell Claude about a workout to start the chart.')] };
  const chart = volumeChart(p);
  const { low, high } = WEEKLY_SET_RANGE;
  const scale = Math.max(high * 1.1, ...t.setsPerWeekByMuscle.map((m) => m.sets)); // room past 20, so its tick is inside the bar
  const levelWord = (n: number) => (n < low ? `under ${low}` : n <= high ? `${low}–${high}` : `over ${high}`);
  const tick = (at: number, of: number) => h('i', { className: 'tick', css: { left: `${(at / of) * 100}%` } });
  const partial = t.weeks.some((w) => w.partial) ? ' · outline: week not complete' : '';
  return {
    key: 'volume',
    name,
    body: [
      heading(name),
      toggle('Volume measure', [['sets', 'Sets'], ['volume', 'Volume']], state.volume, (k) => { state.volume = k as "sets" | "volume"; render(); }),
      chart ?? empty(state.volume === 'sets' ? 'No finished strength sets in this period.' : 'No weighted sets in this period.'),
      chart && state.volume === 'sets' && h('div', { className: 'legend' }, ...MUSCLE_REGIONS.map((k, i) => h('span', {}, h('i', { className: `sw-s${i}` }), REGION_NAME[k].toLowerCase()))),
      chart && caption(state.volume === 'sets' ? `hard sets a week · dashed lines: ${low} and ${high} sets a week${partial}` : `kg lifted: reps × weight of working sets${partial}`),
      t.setsPerWeekByMuscle.length > 0 && subhead('Hard sets a week, by muscle'),
      t.setsPerWeekByMuscle.length > 0 &&
        h('div', { className: 'rows' }, ...t.setsPerWeekByMuscle.slice(0, 8).map((m) => h('div', { className: 'row' }, h('span', { className: 'name' }, m.muscle), h('span', { className: 'val' }, `${num(m.sets)} · ${levelWord(m.sets)}`), h('div', { className: 'meter', 'aria-hidden': 'true' }, h('span', { css: { width: `${Math.min(100, (m.sets / scale) * 100)}%` } }), tick(low, scale), tick(high, scale))))),
      t.setsPerWeekByMuscle.length > 0 && caption(`A set counts 1 for the muscles an exercise mainly works and 0.5 for the ones that help. The ticks mark ${low} and ${high} hard sets a week, the usual range. Ask Claude to show the muscle map.`),
    ],
  };
}

/** One lift: a row with its numbers, opening to the e1RM line (◆ marks a new best), and the last 5 sessions. */
function liftRow(p: Progress, e: Progress['records']['exercises'][number]) {
  const short = shortName(e.name);
  const values = e.sessions.length > 1 ? `${num(e.firstE1rmKg)} → ${num(e.latestE1rmKg)} kg` : `${num(e.latestE1rmKg)} kg`;
  const detail = e.sessions.length > 1 ? `${values} · best ${num(e.bestE1rmKg)} kg (${dayLabel(p, e.bestDay)})` : `${values} · one session`;
  const bests = e.sessions.filter((x) => x.isBest);
  const recent = e.sessions.slice(-5).reverse();
  return h(
    'details',
    { className: 'lift', open: state.openLift === e.id, ontoggle: (ev: Event) => { const open = (ev.currentTarget as HTMLDetailsElement).open; if (open) state.openLift = e.id; else if (state.openLift === e.id) state.openLift = ''; } },
    h('summary', { 'aria-label': `${e.name}: ${detail}` }, h('span', { className: 'name' }, short), h('span', { className: 'val' }, values), h('span', { className: 'chev', 'aria-hidden': 'true' }, '›')),
    h('div', { className: 'liftbody' },
      h('p', { className: 'muted small' }, detail),
      lineChart({ from: startOf(p), to: p.to, label: `${e.name}, estimated 1RM by session: ${num(e.firstE1rmKg)} to ${num(e.latestE1rmKg)} kg${bests.length ? `, ${bests.length} new best${bests.length === 1 ? '' : 's'}` : ''}.`, columns: ['Date', 'Estimated 1RM (kg)'], dots: e.points.map((q) => ({ day: q.day, value: q.e1rmKg })), line: e.points.map((q) => ({ day: q.day, value: q.e1rmKg })), digits: 0, height: 110, boldSingle: true, dotRadius: 2.2, marks: bests.map((x) => x.day) }),
      bests.length > 0 && caption('◆ new best estimate'),
      h(
        'table',
        { className: 'sessions' },
        h('caption', {}, `Last ${recent.length} session${recent.length === 1 ? '' : 's'}`),
        h('thead', {}, h('tr', {}, ...['Date', 'Top set', 'Est. 1RM', ''].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, ...recent.map((x) => h('tr', {}, h('td', {}, dayLabel(p, x.day)), h('td', {}, `${x.topSet.reps} × ${num(x.topSet.kg)} kg`), h('td', {}, `${num(x.e1rm)} kg`), h('td', {}, x.isBest ? '◆ best' : '')))),
      ),
      h('p', { className: 'muted small' }, `Open full lift page: ask Claude to show your ${short} progress.`),
    ),
  );
}

function strengthCard(p: Progress): Built {
  const r = p.records.exercises;
  const name = 'Strength';
  return {
    key: 'strength',
    name,
    body: [
      heading(name),
      r.length === 0 ? empty('Log weighted exercises in the workout player to see estimated one-rep maxes.') : h('div', { className: 'lifts' }, ...r.map((e) => liftRow(p, e))),
      r.length > 0 && caption('Estimated one-rep max (Epley estimate from sets of 12 reps or fewer).'),
    ],
  };
}

function measuresCard(p: Progress): Built | null {
  const m = p.measurements.types;
  if (m.length === 0) return null;
  const picked = m.find((t) => t.key === state.measure) ?? m[0]!;
  const name = 'Measures';
  const number = `${num(picked.latest)} ${picked.unit}`;
  return {
    key: 'measures',
    name,
    say: `${picked.label} ${number}`,
    body: [
      heading(name),
      m.length > 1 && toggle('Measurement', m.map((t) => [t.key, t.label] as const), picked.key, (k) => { state.measure = k; render(); }),
      tint(number, picked.points.length > 1 ? `${picked.label}, ${signed(picked.change)} ${picked.unit} since ${dayLabel(p, picked.firstDay)}` : picked.label, lineChart({ from: startOf(p), to: p.to, label: `${picked.label} from ${rangeLabel(startOf(p), p.to)}: ${picked.points.length} measurements, ${num(picked.first)} to ${num(picked.latest)} ${picked.unit}.`, columns: ['Date', `${picked.label} (${picked.unit})`], dots: picked.points, line: picked.points, boldSingle: true, dotRadius: 2.2 }), picked.points.length < 2 && caption('A line needs at least two measurements.')),
      ...m.filter((t) => t.key !== picked.key).map((t) => hrow(t.label, t.firstDay === t.latestDay ? `${num(t.latest)} ${t.unit}` : `${num(t.first)} → ${num(t.latest)} ${t.unit}`, t.firstDay === t.latestDay ? null : `(${signed(t.change)})`)),
    ],
  };
}

function habitsCard(p: Progress): Built | null {
  const x = p.metrics;
  if (!x.sleep.daily.length && !x.steps.daily.length && !x.water.daily.length) return null;
  const tabs = ([['sleep', 'Sleep', x.sleep.daily.length], ['steps', 'Steps', x.steps.daily.length], ['water', 'Water', x.water.daily.length]] as const).filter((t) => t[2] > 0);
  const picked = tabs.find((t) => t[0] === state.habit) ?? tabs[0]!;
  const kind = picked[0];
  const series = kind === 'sleep' ? x.sleep.daily.map((d) => ({ day: d.day, value: d.hours })) : kind === 'steps' ? x.steps.daily.map((d) => ({ day: d.day, value: d.steps })) : x.water.daily.map((d) => ({ day: d.day, value: d.ml / 1000 }));
  const unit = kind === 'sleep' ? 'h' : kind === 'steps' ? 'steps' : 'L';
  const avg = kind === 'sleep' ? x.sleep.averageHours : kind === 'steps' ? x.steps.average : x.water.averageMl === null ? null : x.water.averageMl / 1000;
  const noun = kind === 'sleep' ? (series.length === 1 ? 'night' : 'nights') : series.length === 1 ? 'day' : 'days';
  const goal = kind === 'sleep' ? x.sleep.goalHours : null;
  const name = 'Sleep, steps, water';
  const number = avg === null ? null : `${num(avg, kind === 'steps' ? 0 : 1)} ${unit}`;
  return {
    key: 'habits',
    name,
    say: number ? `${picked[1]} ${number}` : undefined,
    body: [
      heading(name),
      tabs.length > 1 && toggle('Habit', tabs.map((t) => [t[0], t[1]] as const), kind, (k) => { state.habit = k as "sleep" | "steps" | "water"; render(); }),
      tint(number, avg === null ? `${picked[1]} per logged ${noun}` : `average on ${series.length} logged ${noun}${goal !== null ? `, goal ${num(goal)} h` : ''}`, barChart({ from: startOf(p), to: p.to, days: daysShown(p), label: `${picked[1]} per logged day, ${series.length} days, average ${avg === null ? 'unknown' : num(avg, kind === 'steps' ? 0 : 1)} ${unit}.`, columns: ['Date', `${picked[1]} (${unit})`], points: series, digits: kind === 'steps' ? 0 : 1, reference: goal ?? undefined }), caption(kind === 'sleep' ? `hours slept${goal !== null ? ` · dashed: sleep goal ${num(goal)} h` : ''}` : kind === 'steps' ? 'steps per logged day' : 'litres per logged day')),
    ],
  };
}

// ---------- the pager ----------
const cardsOf = (p: Progress): Built[] => [weightCard(p), nutritionCard(p), energyCard(p), trainingCard(p), volumeCard(p), strengthCard(p), habitsCard(p), measuresCard(p)].filter((c): c is Built => c !== null);

const rangeText = (p: Progress) => `${rangeLabel(startOf(p), p.to)}${startOf(p) > p.from ? ' · since your first log' : ''}`;

function periodButtons() {
  return h('div', { className: 'periods', role: 'group', 'aria-label': 'Period' }, ...RANGES.map((r) => h('button', { type: 'button', className: 'link', 'data-key': `period-${r.days}`, 'aria-label': r.long, 'aria-pressed': String(state.days === r.days), disabled: state.loading, onclick: () => void load(r.days) }, r.short)));
}

/** A drawing bug must never leave a blank frame: say so, and tell the host's log. */
function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    pager?.destroy();
    pager = null;
    root.replaceChildren(h('p', { className: 'error center' }, 'The dashboard could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `dashboard draw failed: ${message}` }).catch(() => undefined);
  }
}

function draw() {
  const p = state.progress;
  if (!p) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading your progress…'));
    return;
  }
  const focusKey = document.activeElement?.getAttribute('data-key');
  const built = cardsOf(p);
  const infos = built.map((c) => ({ key: c.key, name: c.name }));
  spoken.clear();
  for (const c of built) if (c.say) spoken.set(c.key, c.say);
  const first = !pager;
  if (!pager) {
    pager = createCardPager({
      title: 'Progress',
      cards: infos,
      labelRow: true,
      trackLabel: 'Progress cards',
      onSettle: (pos) => {
        state.cardKey = (pager!.cards()[pos]?.dataset.key as CardKey | undefined) ?? state.cardKey;
        pager!.refreshHeader();
        pager!.refreshCards();
      },
      announceText: (pos) => {
        const c = pager!.cards()[pos];
        const say = c?.dataset.key ? spoken.get(c.dataset.key) : undefined;
        return `${c?.getAttribute('data-name') ?? ''}, card ${pos + 1} of ${pager!.cards().length}${say ? `, ${say}` : ''}`;
      },
      focusTarget: (card) => card.querySelector<HTMLElement>('[data-focus]'),
    });
  }
  const at = Math.max(0, infos.findIndex((c) => c.key === state.cardKey));
  const cards = pager.setCards(infos, at);
  pager.setLabel({ sub: () => `${rangeText(p)}${state.loading ? ' · updating…' : ''}`, right: periodButtons() });
  built.forEach((c, i) => {
    const card = cards[i]!;
    const top = card.scrollTop;
    card.dataset.key = c.key;
    card.setAttribute('data-name', c.name);
    card.replaceChildren(...c.body.filter((x): x is Node | string => x !== null && x !== false && x !== undefined));
    card.scrollTop = top;
  });
  pager.refreshCards();
  if (first) {
    root.replaceChildren(pager.header, ...(state.error ? [h('p', { className: 'error small' }, state.error)] : []), pager.track);
  } else {
    root.querySelector('p.error')?.remove();
    if (state.error) pager.header.after(h('p', { className: 'error small' }, state.error));
  }
  if (pager.pos() !== at) pager.goTo(at, { auto: true });
  if (focusKey) root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
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
