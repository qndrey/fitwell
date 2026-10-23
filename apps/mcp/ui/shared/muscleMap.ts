import type { MuscleLevel, MuscleLoad, MuscleMap } from '../../src/analytics/muscleTypes';
import { h } from './dom';
import { textButton } from './icons';
import { daysBetween, deltaText, HEAT, RECOVERY_HEAT, RECOVERY_LABEL, RECOVERY_ORDER, recoveryOf, type MapMode } from './muscleHeat';

export { deltaText, heatColours, type MapMode } from './muscleHeat';

const LABEL: Record<MuscleLevel, string> = { none: 'Not trained', below: 'Under the range', in_range: 'In range', high: 'Over the range' };
const ORDER: MuscleLevel[] = ['below', 'none', 'in_range', 'high'];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const daysAgo = (to: string, d: string) => daysBetween(d, to);
const ago = (days: number) => (days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);
const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
function swatch(colour: string): HTMLElement {
  const el = h('i', { className: 'sw' });
  el.style.background = colour;
  return el;
}

function row(m: MuscleLoad, map: MuscleMap, colour: string, mode: MapMode): HTMLElement {
  const last = m.lastTrained ? (daysAgo(map.to, m.lastTrained) === 0 ? 'trained today' : `last trained ${daysAgo(map.to, m.lastTrained)} days ago`) : 'not trained as a main muscle';
  const delta = mode === 'sets' ? deltaText(m, map.weeks) : null;
  return h(
    'li',
    {},
    h(
      'details',
      {},
      h(
        'summary',
        {},
        swatch(colour),
        h('span', { className: 'name' }, cap(m.muscle)),
        h('span', { className: 'sets' }, mode === 'recovery' ? (m.lastTrained ? ago(daysAgo(map.to, m.lastTrained)) : 'not in this period') : `${m.setsPerWeek} sets a week`),
        delta && h('span', { className: 'delta' }, delta),
      ),
      h('p', { className: 'muted small' }, cap(last), mode === 'recovery' ? `. ${m.setsPerWeek} sets a week` : '', m.topExercises.length ? `. Most from ${m.topExercises.map((e) => `${e.name} (${e.sets})`).join(', ')}.` : '.'),
    ),
  );
}

/** The map card: period switch, the figure, a legend and every muscle with its numbers, grouped by level. */
export function renderMuscleMap(map: MuscleMap, dark: boolean, figure: HTMLElement | null, onWeeks: (weeks: number) => void, loading: boolean, mode: MapMode = 'sets'): HTMLElement {
  const colours = HEAT[dark ? 'dark' : 'light'];
  const recoveryColours = RECOVERY_HEAT[dark ? 'dark' : 'light'];
  const seg = h(
    'div',
    { className: 'choices', role: 'group', 'aria-label': 'Period' },
    ...[1, 4, 12].map((w) => textButton(null, `${w}w`, () => map.weeks !== w && onWeeks(w), { pressed: map.weeks === w, disabled: loading, label: w === 1 ? '1 week' : `${w} weeks` })),
  );
  const legend =
    mode === 'recovery'
      ? h('p', { className: 'legend' }, ...RECOVERY_ORDER.map((l) => h('span', { className: 'key' }, swatch(hex(recoveryColours[l])), RECOVERY_LABEL[l])))
      : h(
          'p',
          { className: 'legend' },
          ...(['none', 'below', 'in_range', 'high'] as MuscleLevel[]).map((l) =>
            h('span', { className: 'key' }, swatch(hex(colours[l])), l === 'below' ? `Under ${map.range.low}` : l === 'in_range' ? `${map.range.low}–${map.range.high}` : l === 'high' ? `Over ${map.range.high}` : LABEL[l]),
          ),
        );
  const groups =
    mode === 'recovery'
      ? RECOVERY_ORDER.map((r) => {
          const ms = map.muscles.filter((m) => recoveryOf(map.to, m.lastTrained) === r);
          if (!ms.length) return null;
          const days = (m: MuscleLoad) => (m.lastTrained ? daysAgo(map.to, m.lastTrained) : Infinity);
          return h('div', { className: 'group' }, h('h3', {}, `${RECOVERY_LABEL[r]} (${ms.length})`), h('ul', { className: 'muscles' }, ...[...ms].sort((a, b) => days(a) - days(b) || a.muscle.localeCompare(b.muscle)).map((m) => row(m, map, hex(recoveryColours[r]), mode))));
        })
      : ORDER.map((level) => {
          const ms = map.muscles.filter((m) => m.level === level);
          if (!ms.length) return null;
          return h('div', { className: 'group' }, h('h3', {}, `${LABEL[level]} (${ms.length})`), h('ul', { className: 'muscles' }, ...[...ms].sort((a, b) => b.setsPerWeek - a.setsPerWeek || a.muscle.localeCompare(b.muscle)).map((m) => row(m, map, hex(colours[m.level]), mode))));
        });
  return h(
    'section',
    { className: 'guide musclemap', 'aria-label': 'Muscles trained' },
    h('div', { className: 'head' }, h('h2', {}, 'Muscles trained'), seg),
    h('p', { className: 'muted small' }, `${mode === 'recovery' ? 'Days since each muscle was trained as a main muscle' : 'Hard sets a week'}, ${fmtDay(map.from)} to ${fmtDay(map.to)} · ${map.sessions} strength session${map.sessions === 1 ? '' : 's'}${loading ? ' · updating…' : ''}`),
    figure,
    legend,
    ...groups,
    h('p', { className: 'muted small' }, `A set counts 1 for the muscles an exercise mainly works and 0.5 for the ones that help. ${map.range.low}–${map.range.high} hard sets a week is a rough guide for the big muscle groups; small ones like forearms and neck usually get enough from other lifts.`),
  );
}
