import type { MuscleLevel, MuscleLoad, MuscleMap } from '../../src/analytics/muscleTypes';
import { h } from './dom';

/** One colour per level, readable on the skin tone in either theme; never the only signal (the list has the numbers). */
const HEAT: Record<'light' | 'dark', Record<MuscleLevel, number>> = {
  light: { none: 0xa9a39b, below: 0x3f7fd0, in_range: 0x2e9a5a, high: 0xd8402a },
  dark: { none: 0x77726b, below: 0x6aa8f0, in_range: 0x4cc47e, high: 0xff6a52 },
};
const LABEL: Record<MuscleLevel, string> = { none: 'Not trained', below: 'Under the range', in_range: 'In range', high: 'Over the range' };
const ORDER: MuscleLevel[] = ['below', 'none', 'in_range', 'high'];

export const heatColours = (map: MuscleMap, dark: boolean): Map<string, number> => new Map(map.muscles.map((m) => [m.muscle, HEAT[dark ? 'dark' : 'light'][m.level]]));

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const daysAgo = (to: string, d: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
function swatch(colour: string): HTMLElement {
  const el = h('i', { className: 'sw' });
  el.style.background = colour;
  return el;
}

function row(m: MuscleLoad, to: string, colour: string): HTMLElement {
  const last = m.lastTrained ? (daysAgo(to, m.lastTrained) === 0 ? 'trained today' : `last trained ${daysAgo(to, m.lastTrained)} days ago`) : 'not trained as a main muscle';
  return h(
    'li',
    {},
    h(
      'details',
      {},
      h('summary', {}, swatch(colour), h('span', { className: 'name' }, cap(m.muscle)), h('span', { className: 'sets' }, `${m.setsPerWeek} sets a week`)),
      h('p', { className: 'muted small' }, cap(last), m.topExercises.length ? `. Most from ${m.topExercises.map((e) => `${e.name} (${e.sets})`).join(', ')}.` : '.'),
    ),
  );
}

/** The map card: period switch, the figure, a legend and every muscle with its numbers, grouped by level. */
export function renderMuscleMap(map: MuscleMap, dark: boolean, figure: HTMLElement | null, onWeeks: (weeks: number) => void, loading: boolean): HTMLElement {
  const colours = HEAT[dark ? 'dark' : 'light'];
  const seg = h(
    'div',
    { className: 'seg', role: 'group', 'aria-label': 'Period' },
    ...[1, 4, 12].map((w) => h('button', { type: 'button', 'aria-pressed': String(map.weeks === w), disabled: loading, onclick: () => map.weeks !== w && onWeeks(w) }, w === 1 ? '1 week' : `${w} weeks`)),
  );
  const legend = h(
    'p',
    { className: 'legend' },
    ...(['none', 'below', 'in_range', 'high'] as MuscleLevel[]).map((l) =>
      h('span', { className: 'key' }, swatch(hex(colours[l])), l === 'below' ? `Under ${map.range.low}` : l === 'in_range' ? `${map.range.low}–${map.range.high}` : l === 'high' ? `Over ${map.range.high}` : LABEL[l]),
    ),
  );
  const groups = ORDER.map((level) => {
    const ms = map.muscles.filter((m) => m.level === level);
    if (!ms.length) return null;
    return h('div', { className: 'group' }, h('h3', {}, `${LABEL[level]} (${ms.length})`), h('ul', { className: 'muscles' }, ...ms.sort((a, b) => b.setsPerWeek - a.setsPerWeek || a.muscle.localeCompare(b.muscle)).map((m) => row(m, map.to, hex(colours[m.level])))));
  });
  return h(
    'section',
    { className: 'guide musclemap', 'aria-label': 'Muscles trained' },
    h('h2', {}, 'Muscles trained'),
    h('p', { className: 'muted small' }, `Hard sets a week, ${fmtDay(map.from)} to ${fmtDay(map.to)} · ${map.sessions} strength session${map.sessions === 1 ? '' : 's'}${loading ? ' · updating…' : ''}`),
    seg,
    figure,
    legend,
    ...groups,
    h('p', { className: 'muted small' }, `A set counts 1 for the muscles an exercise mainly works and 0.5 for the ones that help. ${map.range.low}–${map.range.high} hard sets a week is a rough guide for the big muscle groups; small ones like forearms and neck usually get enough from other lifts.`),
  );
}
