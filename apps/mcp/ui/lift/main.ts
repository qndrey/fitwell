import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { LiftProgress } from '../../src/analytics/types';
import { crossesYear, fmtDay, lineChart, num } from '../shared/chart';
import { dayNum } from '../shared/chartMath';
import { h } from '../shared/dom';
import { shortName } from '../shared/names';

const PERIODS = [['90 days', 90], ['1 year', 365], ['All', 0]] as const;
const SESSIONS_SHOWN = 10;
const state = { lift: null as LiftProgress | null, period: 365 as number, error: '' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell lift progress', version: '0.1.0' }, {}, { autoResize: true });

/** The sessions inside the chosen period (0 = all). */
const inPeriod = (l: LiftProgress) => (state.period === 0 ? l.sessions : l.sessions.filter((s) => dayNum(s.day) > dayNum(l.to) - state.period));

function chart(l: LiftProgress, sessions: LiftProgress['sessions']) {
  const bests = sessions.filter((s) => s.isBest);
  const points = sessions.map((s) => ({ day: s.day, value: s.e1rm }));
  return h(
    'div',
    {},
    lineChart({
      from: sessions[0]!.day,
      to: l.to,
      label: `${l.name}, estimated 1RM by session: ${num(sessions[0]!.e1rm)} to ${num(sessions.at(-1)!.e1rm)} kg${bests.length ? `, ${bests.length} new best${bests.length === 1 ? '' : 's'}` : ''}.`,
      columns: ['Date', 'Estimated 1RM (kg)'],
      dots: points,
      line: points,
      digits: 0,
      height: 150,
      dotRadius: 2.5,
      marks: bests.map((s) => s.day),
    }),
    bests.length > 0 && h('p', { className: 'muted small' }, '◆ new best estimate'),
  );
}

function draw() {
  const l = state.lift;
  if (!l) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading your lift…'));
    return;
  }
  const all = l.sessions;
  const shown = inPeriod(l);
  const withYear = crossesYear(all[0]?.day ?? l.to, l.to);
  const day = (d: string) => fmtDay(d, withYear);
  const best = shown.reduce<(typeof shown)[number] | null>((b, s) => (!b || s.e1rm > b.e1rm ? s : b), null);
  const header = h(
    'header',
    {},
    h('h1', {}, shortName(l.name)),
    all.length > 0 && h('div', { className: 'seg', role: 'group', 'aria-label': 'Period' }, ...PERIODS.map(([label, n]) => h('button', { type: 'button', 'aria-pressed': String(state.period === n), onclick: () => { state.period = n; draw(); } }, label))),
  );
  if (all.length === 0) {
    root.replaceChildren(header, h('section', { className: 'card', 'aria-label': 'Estimated 1RM' }, h('p', { className: 'muted' }, 'No sessions of this lift yet. Log it in the workout player to see progress.')));
    return;
  }
  const recent = shown.slice(-SESSIONS_SHOWN).reverse();
  root.replaceChildren(
    header,
    h(
      'section',
      { className: 'card', 'aria-label': 'Estimated 1RM' },
      h('h2', {}, 'Estimated 1RM'),
      best ? h('p', { className: 'headline' }, `${num(best.e1rm)} kg `, h('small', {}, `best in this period · ${day(best.day)}`)) : h('p', { className: 'muted' }, 'No sessions in this period.'),
      shown.length >= 2 ? chart(l, shown) : shown.length === 1 ? h('p', { className: 'muted small' }, 'A line needs at least two sessions.') : null,
      h('p', { className: 'muted small' }, 'Epley estimate from sets of 12 reps or fewer.'),
    ),
    h(
      'section',
      { className: 'card', 'aria-label': 'Rep records' },
      h('h2', {}, 'Rep records (all time)'),
      h(
        'table',
        { className: 'recs' },
        h('caption', { className: 'sr-only' }, 'Heaviest weight for at least this many reps'),
        h('thead', {}, h('tr', {}, ...['Reps', 'Weight', 'Date'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, ...l.repRecords.map((r) => h('tr', {}, h('td', {}, `${r.reps} ${r.reps === 1 ? 'rep' : 'reps'}`), h('td', {}, r.kg === null ? 'not yet' : `${num(r.kg)} kg`), h('td', {}, r.day ? day(r.day) : '')))),
      ),
      h('p', { className: 'muted small' }, 'Heaviest weight lifted for at least that many reps.'),
    ),
    ...(recent.length === 0 ? [] : [
      h(
        'section',
        { className: 'card', 'aria-label': 'Last sessions' },
        h('h2', {}, `Last ${recent.length === 1 ? 'session' : `${recent.length} sessions`}`),
        h(
          'table',
          { className: 'sessions' },
          h('thead', {}, h('tr', {}, ...['Date', 'Top set', 'Est. 1RM', ''].map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', {}, ...recent.map((s) => h('tr', {}, h('td', {}, day(s.day)), h('td', {}, `${s.reps.join(', ')} × ${num(s.topSet.kg)} kg`), h('td', {}, `${num(s.e1rm)} kg`), h('td', {}, s.isBest ? '◆ best' : '')))),
        ),
      ),
    ]),
    h('p', { className: 'muted small' }, 'Ask Claude for a progression plan.'),
  );
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The lift page could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `lift draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const lift = (result.structuredContent as { lift?: LiftProgress } | undefined)?.lift;
  if (lift) {
    state.lift = lift;
    render();
  } else if (result.isError) {
    state.error = 'The lift page could not be opened. Claude will explain why.';
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
