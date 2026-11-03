import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { CrewConsistency, CrewFeed, CrewPerson, CrewWorkout } from '../../src/analytics/crewTypes';
import { fmtDay } from '../shared/chart';
import { h } from '../shared/dom';
import { textButton } from '../shared/icons';

const state = { feed: null as CrewFeed | null, error: '', busy: new Set<string>() };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell crew', version: '0.1.0' }, {}, { autoResize: true });

const name = (p: CrewPerson) => p.nickname ?? p.email ?? '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function streaks(c: CrewConsistency): string[] {
  return [
    ...(c.trainingWeeks && c.trainingWeeks.current > 0 ? [`${c.trainingWeeks.atLeast ? 'at least ' : ''}${plural(c.trainingWeeks.current, 'week')} of training`] : []),
    ...(c.loggingDays.current > 0 ? [`${plural(c.loggingDays.current, 'day')} of logging`] : []),
  ];
}

function line(w: CrewWorkout): string {
  const parts: string[] = [];
  if (w.type === 'strength') {
    if (w.exerciseCount > 0) parts.push(plural(w.exerciseCount, 'exercise'));
    if (w.sets > 0) parts.push(plural(w.sets, 'set'));
  }
  if (w.minutes !== null) parts.push(`${w.minutes} min`);
  return parts.join(' · ');
}

async function kudos(w: CrewWorkout) {
  if (w.kudos.mine || state.busy.has(w.id)) return;
  state.busy.add(w.id);
  try {
    const res = await app.callServerTool({ name: 'give_kudos', arguments: { workout_id: w.id } });
    if (res.isError) throw new Error('refused');
    w.kudos = { count: w.kudos.count + 1, mine: true };
  } catch {
    state.error = 'Kudos could not be given. Try again.';
  }
  state.busy.delete(w.id);
  render();
}

function draw() {
  const f = state.feed;
  if (!f) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading your crew…'));
    return;
  }
  if (f.friends.length === 0) {
    root.replaceChildren(
      h('header', {}, h('h1', {}, 'Crew')),
      h('section', { className: 'card empty' }, h('p', {}, 'No friend shares anything with you yet.'), h('p', { className: 'muted small' }, 'Ask Claude to connect with a friend by nickname. Each of you then chooses what to share, and only that shows here.')),
    );
    return;
  }
  const withStreaks = f.friends.filter((x) => x.consistency);
  const parts: (Node | null)[] = [
    h('header', {}, h('h1', {}, 'Crew')),
    state.error ? h('p', { className: 'error' }, state.error) : null,
    h(
      'section',
      { className: 'card', 'aria-label': 'Friends' },
      h('h2', {}, 'Friends'),
      h('ul', { className: 'friends' }, ...f.friends.map((x) => h('li', {}, h('span', { className: 'who' }, name(x.who)), h('span', { className: 'stat' }, x.consistency ? streaks(x.consistency).join(' · ') || 'nothing running right now' : 'shares workouts')))),
      withStreaks.length === 0 ? null : h('p', { className: 'muted small' }, 'Streaks are only what each friend shares.'),
    ),
    h(
      'section',
      { 'aria-label': 'Recent workouts' },
      h('h2', {}, 'Last two weeks'),
      f.workouts.length === 0
        ? h('p', { className: 'muted' }, 'No finished workouts shared in the last two weeks.')
        : h(
            'ul',
            { className: 'feed' },
            ...f.workouts.map((w) =>
              h(
                'li',
                { className: 'workout' },
                h('div', { className: 'top' }, h('span', { className: 'who' }, name(w.who)), h('span', { className: 'meta' }, fmtDay(w.day, f.from.slice(0, 4) !== f.to.slice(0, 4)))),
                h('h3', {}, w.title),
                line(w) ? h('p', { className: 'meta' }, line(w)) : null,
                w.exercises.length > 0 ? h('p', { className: 'meta' }, w.exercises.join(', ') + (w.exerciseCount > w.exercises.length ? ', …' : '')) : null,
                h(
                  'div',
                  { className: 'kudos' },
                  textButton(w.kudos.mine ? 'check' : null, w.kudos.mine ? 'Kudos given' : 'Kudos', () => void kudos(w), { pressed: w.kudos.mine, disabled: w.kudos.mine || state.busy.has(w.id), label: `Give kudos to ${name(w.who)} for ${w.title}` }),
                  w.kudos.count > 0 ? h('span', { className: 'count' }, plural(w.kudos.count, 'kudos', 'kudos')) : null,
                ),
              ),
            ),
          ),
    ),
    f.yours.length === 0
      ? null
      : h(
          'section',
          { className: 'card', 'aria-label': 'Kudos on your workouts' },
          h('h2', {}, 'Kudos on yours'),
          h('ul', { className: 'friends' }, ...f.yours.map((y) => h('li', {}, h('span', { className: 'who' }, y.title), h('span', { className: 'stat' }, `${fmtDay(y.day, false)} · ${y.from.map(name).join(', ')}`)))),
        ),
  ];
  root.replaceChildren(...parts.filter((x): x is Node => x !== null));
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The crew feed could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `crew draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const feed = (result.structuredContent as { feed?: CrewFeed } | undefined)?.feed;
  if (feed) {
    state.feed = feed;
    render();
  } else if (result.isError) {
    state.error = 'The crew feed could not be opened. Claude will explain why.';
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
