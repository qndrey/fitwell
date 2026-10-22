// Charts for the dashboard and the weekly review: small SVGs that scale with the card, each with a visually hidden data table as its text alternative.
import { calendarRows, crossesYear, niceTicks, dayNum, fmtDay, num, weekdayShort, WORKOUT_LETTER, WORKOUT_NAME, type WorkoutKind } from './chartMath';
import { h, svg as s } from './dom';

export { crossesYear, fmtDay, num, rangeLabel } from './chartMath';

const W = 340;
const M = { l: 36, r: 8, t: 8, b: 20 };

export interface Point {
  day: string;
  value: number;
}

function scale(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function axisLabels(el: SVGElement, from: string, to: string, height: number) {
  const y = crossesYear(from, to);
  el.append(s('text', { x: M.l, y: height - 5 }, fmtDay(from, y)), s('text', { x: W - M.r, y: height - 5, 'text-anchor': 'end' }, fmtDay(to, y)));
}

/** The chart's data as a table that only a screen reader sees. */
export function dataTable(caption: string, headers: string[], rows: (string | number)[][]) {
  return h('table', { className: 'sr-only' }, h('caption', {}, caption), h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, String(c)))))));
}

const frame = (height: number, label: string) => s('svg', { class: 'chart', viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label });
const box = (chart: SVGElement, table: HTMLElement) => h('div', { className: 'chartbox' }, chart, table);

export interface LineChartOptions {
  from: string;
  to: string;
  label: string;
  /** Names the columns of the hidden table: [day, dots, line]. */
  columns: [string, string, string?];
  /** Faint dots, one per reading. */
  dots: Point[];
  /** A line through points (the 7-day average); the same points as the dots when it is a plain series. */
  line?: Point[];
  goal?: { value: number; label?: string; /** Put the label at the left end of the line, where the data is not. */ atStart?: boolean };
  height?: number;
  digits?: number;
  /** Padding around the data as a share of its range, and the least padding. */
  pad?: [number, number];
  /** A single dot is the whole story: draw it bold. */
  boldSingle?: boolean;
  dotRadius?: number;
  /** Draw the dots above the line (the weight chart) rather than under it. */
  dotsOnTop?: boolean;
  /** Days to mark with a diamond (a new best): a shape, so the meaning does not rest on colour. */
  marks?: string[];
}

/** Dots and an optional line over a value axis with grid lines at round values. */
export function lineChart(o: LineChartOptions): HTMLElement {
  const H = o.height ?? 120;
  const digits = o.digits ?? 1;
  const [padFrac, padMin] = o.pad ?? [0.15, digits === 0 ? 1 : 0.2];
  const vals = [...o.dots.map((q) => q.value), ...(o.line ?? []).map((q) => q.value), ...(o.goal ? [o.goal.value] : [])];
  const pad = Math.max(padMin, (Math.max(...vals) - Math.min(...vals)) * padFrac);
  const lo = Math.min(...vals) - pad;
  const hi = Math.max(...vals) + pad;
  const y = scale(lo, hi, H - M.b, M.t);
  const x = scale(dayNum(o.from), dayNum(o.to), M.l, W - M.r);
  const el = frame(H, o.label);
  for (const v of niceTicks(lo, hi, 4)) el.append(s('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }), s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, num(v, digits)));
  if (o.goal) el.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(o.goal.value), y2: y(o.goal.value) }), s('text', { x: o.goal.atStart ? M.l + 2 : W - M.r, y: y(o.goal.value) - 4, 'text-anchor': o.goal.atStart ? 'start' : 'end' }, o.goal.label ?? `goal ${num(o.goal.value, digits)}`));
  const line = o.line && o.line.length > 1 ? s('polyline', { class: 'line', points: o.line.map((q) => `${x(dayNum(q.day))},${y(q.value)}`).join(' ') }) : null;
  const bold = o.boldSingle && o.dots.length === 1;
  const dots = o.dots.map((q) => s('circle', { class: bold ? 'dotfull' : 'dot', cx: x(dayNum(q.day)), cy: y(q.value), r: bold ? 3.5 : o.dotRadius ?? 2.5 }));
  if (o.dotsOnTop) el.append(...(line ? [line] : []), ...dots);
  else el.append(...dots, ...(line ? [line] : []));
  for (const q of o.dots.filter((q) => o.marks?.includes(q.day))) {
    const cx = x(dayNum(q.day));
    const cy = y(q.value);
    el.append(s('polygon', { class: 'pr', points: `${cx},${cy - 5.5} ${cx + 4.5},${cy} ${cx},${cy + 5.5} ${cx - 4.5},${cy}` }));
  }
  axisLabels(el, o.from, o.to, H);
  const average = new Map((o.line ?? []).map((q) => [q.day, q.value]));
  const days = [...new Set([...o.dots.map((q) => q.day), ...(o.line ?? []).map((q) => q.day)])].sort();
  const dotAt = new Map(o.dots.map((q) => [q.day, q.value]));
  const withLine = o.columns[2] !== undefined;
  const rows = days.map((d) => [fmtDay(d, crossesYear(o.from, o.to)), dotAt.has(d) ? num(dotAt.get(d)!, digits) : '', ...(withLine ? [average.has(d) ? num(average.get(d)!, digits) : ''] : [])]);
  return box(el, dataTable(o.label, o.columns[2] !== undefined ? [o.columns[0], o.columns[1], o.columns[2]] : [o.columns[0], o.columns[1]], rows));
}

export interface BarChartOptions {
  from: string;
  to: string;
  /** Days in the period: sets how wide a bar is. */
  days: number;
  label: string;
  /** Names the columns of the hidden table: [day, value]. */
  columns: [string, string];
  points: Point[];
  height?: number;
  digits?: number;
  /** Space above the tallest bar, as a multiplier. */
  headroom?: number;
  /** A dashed reference line (a goal or a target). */
  reference?: number;
}

/** One bar per logged day, from zero. */
export function barChart(o: BarChartOptions): HTMLElement {
  const H = o.height ?? 110;
  const digits = o.digits ?? 0;
  const top = Math.max(...o.points.map((q) => q.value), o.reference ?? 0, 1) * (o.headroom ?? 1.1);
  const y = scale(0, top, H - M.b, M.t);
  const bw = Math.max(1.5, Math.min(14, ((W - M.l - M.r) / o.days) * 0.75));
  const x = scale(dayNum(o.from), dayNum(o.to), M.l + bw / 2, W - M.r - bw / 2); // the first and last bar stay inside the plot, clear of the axis labels
  const el = frame(H, o.label);
  el.append(s('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
  for (const v of niceTicks(0, top, 2).filter((t) => t > 0)) el.append(s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, num(v, digits)));
  for (const q of o.points) el.append(s('rect', { class: 'bar', x: x(dayNum(q.day)) - bw / 2, y: y(q.value), width: bw, height: Math.max(0, H - M.b - y(q.value)), rx: 1.5 }));
  if (o.reference) el.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(o.reference), y2: y(o.reference) }));
  axisLabels(el, o.from, o.to, H);
  const withYear = crossesYear(o.from, o.to);
  return box(el, dataTable(o.label, [...o.columns], o.points.map((q) => [fmtDay(q.day, withYear), num(q.value, digits)])));
}

export interface WeekBar {
  /** First day of the week. */
  week: string;
  /** The lower, darker segment (strength) and the lighter one stacked on it (cardio and classes). */
  a: number;
  b: number;
  /** The week is cut off at either end: drawn as an outline, not a filled bar. */
  partial?: boolean;
}

export interface WeekBarsOptions {
  weeks: WeekBar[];
  /** Last day shown, for the right-hand axis label. */
  to: string;
  label: string;
  /** Names the columns of the hidden table: [week, a, b]. */
  columns: [string, string, string];
  goal?: number | null;
  height?: number;
}

/** Stacked bars, one per week, with the weekly goal as a dashed line. */
export function weekBars(o: WeekBarsOptions): HTMLElement {
  const H = o.height ?? 110;
  const wk = o.weeks;
  const top = Math.max(2, ...wk.map((w) => w.a + w.b));
  const y = scale(0, top, H - M.b, M.t);
  const slot = (W - M.l - M.r) / wk.length;
  const bw = Math.max(2, Math.min(24, slot * 0.7));
  const el = frame(H, o.label);
  el.append(s('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
  for (const v of niceTicks(0, top, 2).filter((t) => t > 0 && Number.isInteger(t))) el.append(s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, String(v)));
  wk.forEach((w, i) => {
    const cx = M.l + slot * (i + 0.5);
    const inset = w.partial ? 0.75 : 0; // the outline's stroke stays inside the bar's footprint
    el.append(s('rect', { class: w.partial ? 'bar-partial' : 'bar', x: cx - bw / 2 + inset, y: y(w.a), width: bw - 2 * inset, height: Math.max(0, H - M.b - y(w.a)), rx: 1.5 }));
    el.append(s('rect', { class: w.partial ? 'bar2-partial' : 'bar2', x: cx - bw / 2 + inset, y: y(w.a + w.b), width: bw - 2 * inset, height: Math.max(0, y(w.a) - y(w.a + w.b)), rx: 1.5 }));
  });
  if (o.goal) el.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(o.goal), y2: y(o.goal) }));
  axisLabels(el, wk[0]!.week, o.to, H);
  const withYear = crossesYear(wk[0]!.week, o.to);
  return box(el, dataTable(o.label, [...o.columns], wk.map((w) => [`Week of ${fmtDay(w.week, withYear)}${w.partial ? ' (partial week)' : ''}`, w.a, w.b])));
}

export interface StackedWeek {
  week: string;
  /** One value per series, bottom first. */
  values: number[];
  /** The week is cut off at either end: drawn as an outline, not a filled bar. */
  partial?: boolean;
}

export interface StackedWeekBarsOptions {
  weeks: StackedWeek[];
  to: string;
  label: string;
  /** Names the columns of the hidden table: [week, ...one per series]. */
  columns: string[];
  /** Dashed horizontal lines (a usual range); the caller's legend says what they mean. */
  lines?: number[];
  /** How a tick value is written on the axis; the hidden table always has the exact numbers. */
  tick?: (v: number) => string;
  digits?: number;
  height?: number;
}

let patternIds = 0;

/**
 * Weekly bars stacked from up to three series, told apart by fill pattern as well as grey (solid, diagonal stripes, dots),
 * with a partial week as an outline. The legend swatches are `.sw-s0`, `.sw-s1` and `.sw-s2` in chart.css.
 */
export function stackedWeekBars(o: StackedWeekBarsOptions): HTMLElement {
  const H = o.height ?? 130;
  const wk = o.weeks;
  const digits = o.digits ?? 0;
  const top = Math.max(1, ...wk.map((w) => w.values.reduce((a, b) => a + b, 0)), ...(o.lines ?? [])) * 1.08;
  const y = scale(0, top, H - M.b, M.t);
  const slot = (W - M.l - M.r) / wk.length;
  const bw = Math.max(2, Math.min(24, slot * 0.7));
  const el = frame(H, o.label);
  const id = `hatch${++patternIds}`;
  el.append(
    s('defs', {}, s('pattern', { id: `${id}-1`, width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { class: 'pat-bg1', width: 4, height: 4 }), s('line', { class: 'pat-fg1', x1: 0, y1: 0, x2: 0, y2: 4 })), s('pattern', { id: `${id}-2`, width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, s('rect', { class: 'pat-bg2', width: 4, height: 4 }), s('circle', { class: 'pat-fg2', cx: 2, cy: 2, r: 0.9 }))),
    s('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }),
  );
  const fmt = o.tick ?? ((v: number) => num(v, digits));
  for (const v of niceTicks(0, top, 3).filter((t) => t > 0)) el.append(s('text', { x: M.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, fmt(v)));
  wk.forEach((w, i) => {
    const cx = M.l + slot * (i + 0.5);
    const inset = w.partial ? 0.75 : 0;
    let base = 0;
    w.values.forEach((v, k) => {
      const attrs = { x: cx - bw / 2 + inset, y: y(base + v), width: bw - 2 * inset, height: Math.max(0, y(base) - y(base + v)), rx: 1.5 };
      el.append(s('rect', { ...attrs, class: w.partial ? `vs${k}-partial` : `vs${k}`, ...(w.partial || k === 0 ? {} : { fill: `url(#${id}-${k})` }) }));
      base += v;
    });
  });
  for (const v of o.lines ?? []) el.append(s('line', { class: 'goal', x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) })); // the legend names the values: a label here would sit on the bars
  axisLabels(el, wk[0]!.week, o.to, H);
  const withYear = crossesYear(wk[0]!.week, o.to);
  return box(el, dataTable(o.label, o.columns, wk.map((w) => [`Week of ${fmtDay(w.week, withYear)}${w.partial ? ' (partial week)' : ''}`, ...w.values.map((v) => num(v, digits))])));
}

/** A tiny trend line with no axes; decorative (the numbers beside it say the same), so it has no table. */
export function sparkline(points: Point[]): SVGElement {
  const el = s('svg', { viewBox: '0 0 90 28', width: 90, height: 28, 'aria-hidden': 'true' });
  if (points.length < 2) return el;
  const x = scale(dayNum(points[0]!.day), dayNum(points[points.length - 1]!.day), 2, 88);
  const vals = points.map((q) => q.value);
  const y = scale(Math.min(...vals), Math.max(...vals), 25, 3);
  el.append(s('polyline', { class: 'spark', points: points.map((q) => `${x(dayNum(q.day))},${y(q.value)}`).join(' ') }));
  return el;
}

export interface StripDay {
  day: string;
  kcal: number | null;
  proteinG: number | null;
  workout: WorkoutKind | null;
  weighIn: number | null;
}

export interface WeekStripOptions {
  days: StripDay[];
  goalKcal?: number | null;
  label: string;
}

/** A week at a glance: calorie bars (goal dashed, value under each bar, "–" for an unlogged day), the workout letter and the weigh-in of each day. */
export function weekStrip(o: WeekStripOptions): HTMLElement {
  const L = 44;
  const slot = (W - L - M.r) / 7;
  const bw = Math.min(26, slot * 0.6);
  const top = Math.max(...o.days.map((d) => d.kcal ?? 0), o.goalKcal ?? 0, 1) * 1.1;
  const base = 56;
  const y = scale(0, top, base, 6);
  const row = { kcal: 70, day: 84, trained: 100, weight: 116 };
  const el = frame(124, o.label);
  const label = (text: string, yy: number) => s('text', { x: 0, y: yy }, text);
  el.append(s('line', { class: 'axis', x1: L, x2: W - M.r, y1: base, y2: base }), label('kcal', row.kcal), label('Trained', row.trained), label('Weight', row.weight));
  if (o.goalKcal) el.append(s('line', { class: 'goal', x1: L, x2: W - M.r, y1: y(o.goalKcal), y2: y(o.goalKcal) }));
  o.days.forEach((d, i) => {
    const cx = L + slot * (i + 0.5);
    const mid = { x: cx, 'text-anchor': 'middle' };
    if (d.kcal !== null) el.append(s('rect', { class: 'bar', x: cx - bw / 2, y: y(d.kcal), width: bw, height: Math.max(0, base - y(d.kcal)), rx: 1.5 }));
    el.append(s('text', { ...mid, y: row.kcal }, d.kcal === null ? '–' : num(d.kcal, 0)), s('text', { ...mid, y: row.day }, weekdayShort(d.day)), s('text', { class: 'letter', ...mid, y: row.trained }, d.workout ? WORKOUT_LETTER[d.workout] : '–'), s('text', { ...mid, y: row.weight }, d.weighIn === null ? '–' : num(d.weighIn, 1)));
  });
  const rows = o.days.map((d) => [`${weekdayShort(d.day)} ${fmtDay(d.day)}`, d.kcal === null ? 'not logged' : num(d.kcal, 0), d.proteinG === null ? 'not logged' : num(d.proteinG, 0), d.workout ? WORKOUT_NAME[d.workout] : 'none', d.weighIn === null ? 'none' : num(d.weighIn, 1)]);
  return box(el, dataTable(o.label, ['Day', 'Calories (kcal)', 'Protein (g)', 'Workout', 'Weigh-in (kg)'], rows));
}

export interface MonthStripOptions {
  /** The days of the period, oldest first, starting on a Monday; grouped by seven into rows. */
  days: StripDay[];
  goalKcal?: number | null;
  label: string;
}

/** Four weeks at a glance: a row per week (Monday to Sunday) of calorie bars (goal dashed) with the workout letter under each, and the week's average calories at the end. */
export function monthStrip(o: MonthStripOptions): HTMLElement {
  const L = 52;
  const R = 44;
  const slot = (W - L - R) / 7;
  const bw = Math.min(22, slot * 0.6);
  const rowH = 46;
  const top = Math.max(...o.days.map((d) => d.kcal ?? 0), o.goalKcal ?? 0, 1) * 1.05;
  const weeks: StripDay[][] = [];
  for (let i = 0; i < o.days.length; i += 7) weeks.push(o.days.slice(i, i + 7));
  const H = 16 + weeks.length * rowH;
  const el = frame(H, o.label);
  'MTWTFSS'.split('').forEach((c, k) => el.append(s('text', { x: L + slot * (k + 0.5), y: 10, 'text-anchor': 'middle' }, c)));
  el.append(s('text', { x: W - M.r, y: 10, 'text-anchor': 'end' }, 'avg kcal'));
  weeks.forEach((wk, i) => {
    const y0 = 16 + i * rowH;
    const base = y0 + 26;
    const y = scale(0, top, base, y0 + 2);
    el.append(s('line', { class: 'axis', x1: L, x2: W - R, y1: base, y2: base }), s('text', { x: 0, y: base - 2 }, fmtDay(wk[0]!.day)));
    if (o.goalKcal) el.append(s('line', { class: 'goal', x1: L, x2: W - R, y1: y(o.goalKcal), y2: y(o.goalKcal) }));
    wk.forEach((d, k) => {
      const cx = L + slot * (k + 0.5);
      if (d.kcal !== null) el.append(s('rect', { class: 'bar', x: cx - bw / 2, y: y(d.kcal), width: bw, height: Math.max(0, base - y(d.kcal)), rx: 1.5 }));
      el.append(s('text', { class: 'letter', x: cx, y: base + 12, 'text-anchor': 'middle' }, d.workout ? WORKOUT_LETTER[d.workout] : '–'));
    });
    const logged = wk.filter((d) => d.kcal !== null);
    el.append(s('text', { x: W - M.r, y: base - 2, 'text-anchor': 'end' }, logged.length ? num(logged.reduce((n, d) => n + d.kcal!, 0) / logged.length, 0) : '–'));
  });
  const rows = o.days.map((d) => [`${weekdayShort(d.day)} ${fmtDay(d.day)}`, d.kcal === null ? 'not logged' : num(d.kcal, 0), d.proteinG === null ? 'not logged' : num(d.proteinG, 0), d.workout ? WORKOUT_NAME[d.workout] : 'none', d.weighIn === null ? 'none' : num(d.weighIn, 1)]);
  return box(el, dataTable(o.label, ['Day', 'Calories (kcal)', 'Protein (g)', 'Workout', 'Weigh-in (kg)'], rows));
}

export interface CalendarOptions {
  /** Mondays of the weeks in the period, oldest first; the last 12 are drawn. */
  weeks: string[];
  days: { day: string; type: WorkoutKind }[];
  to: string;
  /** Workouts a week the person aims for; shown as "3/3" per row. */
  goal?: number | null;
}

/** Trained days as a grid, a row per week (Monday to Sunday): a filled square with the workout's letter, an outline for a rest day, the week's count at the end. */
export function consistencyCalendar(o: CalendarOptions): HTMLElement {
  const rows = calendarRows(o.weeks, o.days, o.to);
  const L = 44;
  const size = 20;
  const step = 28;
  const top = 16;
  const H = top + rows.length * 26;
  const total = rows.reduce((n, r) => n + r.trained, 0);
  const label = `Trained days over the last ${rows.length} weeks: ${total} of ${rows.length * 7}.`;
  const el = frame(H, label);
  'MTWTFSS'.split('').forEach((c, k) => el.append(s('text', { x: L + k * step + size / 2, y: 10, 'text-anchor': 'middle' }, c)));
  rows.forEach((r, i) => {
    const y = top + i * 26;
    el.append(s('text', { x: 0, y: y + 14 }, fmtDay(r.week)));
    r.cells.forEach((c, k) => {
      if (c.future) return;
      const x = L + k * step;
      const name = c.kind ? `${fmtDay(c.day)}: ${WORKOUT_NAME[c.kind]}` : `${fmtDay(c.day)}: rest day`;
      el.append(s('rect', { class: c.kind ? 'cal-on' : 'cal-off', x, y, width: size, height: size, rx: 4, 'aria-label': name }));
      if (c.kind) el.append(s('text', { class: 'cal-letter', x: x + size / 2, y: y + 14, 'text-anchor': 'middle' }, WORKOUT_LETTER[c.kind]));
    });
    el.append(s('text', { class: 'letter', x: W - M.r, y: y + 14, 'text-anchor': 'end' }, o.goal ? `${r.trained}/${o.goal}` : String(r.trained)));
  });
  const headers = ['Week of', ...'Mon Tue Wed Thu Fri Sat Sun'.split(' ')];
  return box(el, dataTable(label, headers, rows.map((r) => [fmtDay(r.week), ...r.cells.map((c) => (c.future ? '' : c.kind ? WORKOUT_NAME[c.kind] : 'rest'))])));
}
