import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { LoggedSet, WorkoutPlan } from '../../src/workout/plan';

interface Done extends LoggedSet {
  /** Did the server acknowledge it? (The spike checks the view → server round trip on every client.) */
  synced: boolean;
}

const state = {
  plan: null as WorkoutPlan | null,
  current: 0,
  /** Per exercise: sets logged or skipped so far. */
  progress: [] as number[],
  reps: 0,
  weight: 0,
  done: [] as Done[],
  restUntil: 0,
  startedAt: 0,
  finished: false,
  serverOk: null as boolean | null,
  note: '',
};

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell workout', version: '0.1.0' }, {}, { autoResize: true });

// ---------- tiny DOM helper (textContent only: names come from data, never parsed as HTML) ----------
type Child = Node | string | null | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k.startsWith('aria-') || k === 'role') el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const kg = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---------- workout logic ----------
function load(plan: WorkoutPlan) {
  if (state.plan?.workoutId === plan.workoutId) return; // the host may resend the result; keep progress
  Object.assign(state, { plan, current: 0, progress: plan.exercises.map(() => 0), done: [], restUntil: 0, startedAt: Date.now(), finished: false });
  select(0);
}

function select(i: number) {
  const ex = state.plan!.exercises[i]!;
  state.current = i;
  const target = ex.sets[Math.min(state.progress[i]!, ex.sets.length - 1)]!;
  state.reps = target.reps;
  state.weight = target.weightKg ?? 0;
  render();
}

function nextOpen(from: number): number {
  const ex = state.plan!.exercises;
  for (let k = 0; k < ex.length; k++) {
    const i = (from + k) % ex.length;
    if (state.progress[i]! < ex[i]!.sets.length) return i;
  }
  return -1;
}

async function logSet(skip = false) {
  const plan = state.plan!;
  const ex = plan.exercises[state.current]!;
  const setNumber = state.progress[state.current]! + 1;
  state.progress[state.current] = setNumber;
  if (!skip) {
    const set: Done = { workoutId: plan.workoutId, exerciseId: ex.id, setNumber, reps: state.reps, weightKg: ex.sets[0]!.weightKg === undefined ? undefined : state.weight, synced: false };
    state.done.push(set);
    if (ex.restSec > 0) state.restUntil = Date.now() + ex.restSec * 1000;
    void sync(set);
  }
  if (setNumber < ex.sets.length) return render(); // next set of the same exercise starts from what was just done
  const next = nextOpen(state.current + 1);
  if (next === -1) {
    state.restUntil = 0;
    render();
  } else select(next);
}

async function sync(set: Done) {
  try {
    const { workoutId, exerciseId, setNumber, reps, weightKg } = set;
    const res = await app.callServerTool({ name: 'log_set', arguments: { workoutId, exerciseId, setNumber, reps, ...(weightKg === undefined ? {} : { weightKg }) } });
    set.synced = !res.isError;
    state.serverOk = !res.isError;
  } catch {
    state.serverOk = false;
  }
  render();
  void app.updateModelContext({ content: [{ type: 'text', text: `Workout in progress. ${summary()}` }] }).catch(() => undefined);
}

function summary(): string {
  const plan = state.plan!;
  const parts = plan.exercises.map((ex) => {
    const sets = state.done.filter((d) => d.exerciseId === ex.id);
    if (!sets.length) return `${ex.name}: not done`;
    return `${ex.name}: ${sets.map((s) => (s.weightKg === undefined ? `${s.reps}` : `${s.reps}×${kg(s.weightKg)} kg`)).join(', ')}`;
  });
  return `${plan.name} (${mmss(Date.now() - state.startedAt)}). ${parts.join('; ')}.`;
}

async function finish() {
  state.finished = true;
  state.restUntil = 0;
  render();
  try {
    const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: `I finished my workout. ${summary()}` }] });
    state.note = res.isError ? 'Could not send the summary to Claude; it is shown above.' : 'Summary sent to Claude.';
  } catch {
    state.note = 'Could not send the summary to Claude; it is shown above.';
  }
  render();
}

// ---------- view ----------
function stepper(label: string, value: string, dec: () => void, inc: () => void) {
  return h(
    'div',
    { className: 'stepper' },
    h('span', { className: 'muted small' }, label),
    h(
      'div',
      { className: 'row' },
      h('button', { type: 'button', 'aria-label': `Less ${label.toLowerCase()}`, onclick: dec }, '−'),
      h('output', { 'aria-label': label }, value),
      h('button', { type: 'button', 'aria-label': `More ${label.toLowerCase()}`, onclick: inc }, '+'),
    ),
  );
}

function render() {
  const plan = state.plan;
  if (!plan) return;
  const total = plan.exercises.reduce((n, e) => n + e.sets.length, 0);
  const logged = state.progress.reduce((n, p) => n + p, 0);
  const ex = plan.exercises[state.current]!;
  const allDone = nextOpen(0) === -1;
  const resting = state.restUntil > Date.now();
  const ctx = app.getHostContext();

  const body: Child[] = [
    h('header', {}, h('strong', {}, plan.name), h('span', { className: 'muted clock' }, `${logged}/${total} sets · `, h('span', { id: 'elapsed' }, mmss(Date.now() - state.startedAt)))),
  ];

  if (state.finished) {
    body.push(h('section', { className: 'card' }, h('h1', {}, 'Workout finished'), h('p', {}, summary()), state.note && h('p', { className: 'muted small' }, state.note)));
  } else if (resting) {
    body.push(
      h(
        'section',
        { className: 'card rest', 'aria-label': 'Rest' },
        h('p', { className: 'muted' }, 'Rest'),
        h('p', { className: 'time', role: 'timer', id: 'rest' }, mmss(state.restUntil - Date.now())),
        h('p', { className: 'muted small' }, allDone ? 'All sets done' : `Next: ${ex.name}, set ${state.progress[state.current]! + 1}`),
        h(
          'div',
          { className: 'actions' },
          h('button', { type: 'button', onclick: () => ((state.restUntil += 15_000), render()) }, '+15 s'),
          h('button', { type: 'button', className: 'primary', onclick: () => ((state.restUntil = 0), render()) }, 'Skip rest'),
        ),
      ),
    );
  } else if (!allDone) {
    const bodyweight = ex.sets[0]!.weightKg === undefined;
    body.push(
      h(
        'section',
        { className: 'card', 'aria-label': 'Current set' },
        h('p', { className: 'muted small' }, `Exercise ${state.current + 1} of ${plan.exercises.length} · ${ex.equipment}`),
        h('h1', {}, ex.name),
        h('p', {}, `Set ${state.progress[state.current]! + 1} of ${ex.sets.length}`),
        h(
          'div',
          { className: 'steppers' },
          stepper('Reps', String(state.reps), () => ((state.reps = Math.max(0, state.reps - 1)), render()), () => ((state.reps += 1), render())),
          bodyweight
            ? h('div', { className: 'stepper' }, h('span', { className: 'muted small' }, 'Load'), h('p', {}, 'Bodyweight'))
            : stepper('Weight kg', kg(state.weight), () => ((state.weight = Math.max(0, state.weight - 2.5)), render()), () => ((state.weight += 2.5), render())),
        ),
        h('button', { type: 'button', className: 'primary', onclick: () => void logSet() }, 'Log set'),
        h('button', { type: 'button', onclick: () => void logSet(true) }, 'Skip set'),
      ),
    );
  }

  body.push(
    h(
      'ol',
      { className: 'list', 'aria-label': 'Exercises' },
      ...plan.exercises.map((e, i) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', 'aria-current': i === state.current && !allDone ? 'step' : 'false', disabled: state.finished, onclick: () => select(i) },
            h('span', {}, e.name),
            h('span', { className: state.progress[i] === e.sets.length ? 'dots done' : 'dots' }, '●'.repeat(state.progress[i]!) + '○'.repeat(e.sets.length - state.progress[i]!)),
          ),
        ),
      ),
    ),
  );
  if (!state.finished) body.push(h('button', { type: 'button', className: allDone ? 'primary' : '', onclick: () => void finish() }, allDone ? 'Finish and send to Claude' : 'Finish early'));

  // Diagnostics for the phase 0b spike: which client, and whether set logging reaches the server.
  const server = state.serverOk === null ? 'server: no set logged yet' : state.serverOk ? 'server: sets reach Fitwell ✓' : 'server: could not reach Fitwell ✗';
  body.push(h('footer', {}, `${ctx?.platform ?? 'unknown platform'} · ${ctx?.displayMode ?? 'inline'} · ${server}`));

  root.replaceChildren(...body.filter((c): c is Node | string => c !== null && c !== false));
}

// ---------- host wiring (handlers before connect, so one-shot notifications are not missed) ----------
function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const plan = (result.structuredContent as { workout?: WorkoutPlan } | undefined)?.workout;
  if (plan) load(plan);
  else if (result.isError) root.replaceChildren(h('p', { className: 'error center' }, 'The workout could not be started. Claude will explain why.'));
};
app.onhostcontextchanged = (ctx) => {
  applyHost(ctx);
  render();
};

// Once a second: update only the clock texts, so buttons are never replaced under a finger.
setInterval(() => {
  if (!state.plan || state.finished) return;
  if (state.restUntil && state.restUntil <= Date.now()) {
    state.restUntil = 0;
    try {
      navigator.vibrate?.(200);
    } catch {
      /* not allowed in this frame */
    }
    render();
    return;
  }
  const elapsed = document.getElementById('elapsed');
  if (elapsed) elapsed.textContent = mmss(Date.now() - state.startedAt);
  const rest = document.getElementById('rest');
  if (rest) rest.textContent = mmss(state.restUntil - Date.now());
}, 1000);

await app.connect();
applyHost(app.getHostContext());
render();
