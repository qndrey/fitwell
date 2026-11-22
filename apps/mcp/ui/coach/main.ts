import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { CoachRoster, RosterPerson, RosterTrainee } from '../../src/analytics/coachTypes';
import { fmtDay } from '../shared/chart';
import { h } from '../shared/dom';
import { textButton } from '../shared/icons';

const state = { roster: null as CoachRoster | null, error: '' };

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell coaching', version: '0.1.0' }, {}, { autoResize: true });

const name = (p: RosterPerson) => p.nickname ?? p.email ?? '';
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const n0 = (n: number) => Math.round(n).toLocaleString('en-US');

/** What the coach asks Claude for when they want the detail: the tools read exactly what the trainee shares. The name is only data in the message. */
function review(t: RosterTrainee) {
  const food = t.shareFood ? ` and get_trainee_food (days 7)` : '';
  const text = `Review how ${name(t.who)} is doing: call list_assignments with coaching_id ${t.coachingId}${food}, compare what I assigned with what they did and say what you would change. Do not change anything yet.`;
  void app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }).catch(() => undefined);
}

function program(t: RosterTrainee): Node | null {
  const p = t.program;
  if (!p) return null;
  if (p.sessionsDone === null || p.status === 'waiting' || p.status === 'skipped') return h('p', { className: 'stat' }, `Program “${p.name}”: ${p.status === 'skipped' ? 'declined' : 'waiting for them to accept'}`);
  const pct = p.sessionsTotal > 0 ? Math.min(100, Math.round((p.sessionsDone / p.sessionsTotal) * 100)) : 0;
  return h(
    'div',
    {},
    h('p', { className: 'stat' }, `Program “${p.name}”${p.status === 'ended' ? ' (ended)' : ''}: ${p.sessionsDone} of ${p.sessionsTotal} sessions done`),
    h('div', { className: 'bar', role: 'img', 'aria-label': `${pct} % of the program's sessions are done` }, h('i', { css: { width: `${pct}%` } })),
  );
}

function card(t: RosterTrainee, today: string): Node {
  const crossYear = (d: string) => d.slice(0, 4) !== today.slice(0, 4);
  const head = h('div', { className: 'top' }, h('h3', {}, name(t.who)), h('span', { className: 'meta' }, t.status === 'pending' ? 'offer not answered yet' : `coaching since ${fmtDay(t.since, crossYear(t.since))}`));
  if (t.status === 'pending') return h('li', { className: 'trainee' }, head, h('p', { className: 'meta' }, 'Nothing can be assigned until they accept.'));
  const w = t.workouts;
  return h(
    'li',
    { className: 'trainee' },
    head,
    w.assigned === 0
      ? h('p', { className: 'stat' }, 'No workout assigned in the last 4 weeks.')
      : h(
          'p',
          { className: 'stat' },
          w.adherencePct === null ? `${plural(w.assigned, 'workout')} assigned, none due yet` : `${w.adherencePct} % of what came due was done`,
          ` · ${w.done} done`,
          w.skipped ? ` · ${w.skipped} skipped` : '',
          w.waiting ? ` · ${w.waiting} waiting` : '',
        ),
    w.overdue > 0 ? h('p', { className: 'stat alert' }, `${plural(w.overdue, 'workout')} overdue`) : null,
    h('p', { className: 'meta' }, t.lastDone ? `Last finished ${fmtDay(t.lastDone, crossYear(t.lastDone))}` : 'Nothing finished yet', t.next ? ` · next: ${t.next.name}${t.next.dueOn ? `, due ${fmtDay(t.next.dueOn, crossYear(t.next.dueOn))}` : ''}${t.next.started ? ' (started)' : ''}` : ''),
    program(t),
    t.shareFood
      ? h('p', { className: 'stat' }, t.food && t.food.loggedDays > 0 ? `Food: logged ${t.food.loggedDays} of the last 7 days, averaging ${n0(t.food.kcal ?? 0)}${t.food.goalKcal ? ` of ${n0(t.food.goalKcal)}` : ''} kcal and ${n0(t.food.proteinG ?? 0)}${t.food.goalProteinG ? ` of ${n0(t.food.goalProteinG)}` : ''} g protein` : 'Food: nothing logged in the last 7 days')
      : null,
    t.targetsWaiting ? h('p', { className: 'meta' }, 'Targets proposed, not answered yet.') : null,
    textButton(null, 'Ask Claude to review', () => review(t), { label: `Ask Claude to review how ${name(t.who)} is doing` }),
  );
}

function draw() {
  const r = state.roster;
  if (!r) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading your trainees…'));
    return;
  }
  if (r.trainees.length === 0) {
    root.replaceChildren(
      h('header', {}, h('h1', {}, 'Coaching')),
      h('section', { className: 'card empty' }, h('p', {}, 'You are not coaching anyone yet.'), h('p', { className: 'muted small' }, 'Ask Claude to offer coaching to a friend. Nothing is assigned or shared until they accept, and they choose what you see.')),
    );
    return;
  }
  const parts: (Node | null)[] = [
    h('header', {}, h('h1', {}, 'Coaching'), h('span', { className: 'muted small' }, `${plural(r.trainees.length, 'trainee')} of ${r.limit}`)),
    state.error ? h('p', { className: 'error' }, state.error) : null,
    h('ul', { className: 'trainees', 'aria-label': 'Trainees' }, ...r.trainees.map((t) => card(t, r.today))),
    h('p', { className: 'muted small' }, 'Each trainee decides what you see. A number is only what they share.'),
  ];
  root.replaceChildren(...parts.filter((x): x is Node => x !== null));
}

function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'Coaching could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `coach draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const roster = (result.structuredContent as { roster?: CoachRoster } | undefined)?.roster;
  if (roster) {
    state.roster = roster;
    render();
  } else if (result.isError) {
    state.error = 'Coaching could not be opened. Claude will explain why.';
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
