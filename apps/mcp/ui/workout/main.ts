import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { PlannedExercise, PlannedSet, WorkoutPlan } from '../../src/workout/plan';

interface FinishSummary {
  minutes: number;
  volumeKg: number;
  exercises: { name: string; done: string; personalRecord?: string }[];
}

const state = {
  plan: null as WorkoutPlan | null,
  current: 0,
  reps: 0,
  weight: 0,
  restUntil: 0,
  finished: null as FinishSummary | null,
  finishing: false,
  serverOk: null as boolean | null,
  note: '',
};

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell workout', version: '0.2.0' }, {}, { autoResize: true });

// ---------- tiny DOM helper (textContent only: names come from data, never parsed as HTML) ----------
type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k.startsWith('aria-') || k === 'role') el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const kg = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const closed = (s: PlannedSet) => s.done || !!s.skipped;
const nextSet = (e: PlannedExercise) => e.sets.find((s) => !closed(s));

// ---------- workout logic ----------
/** The tool result may be a replay (chat reopened): fetch the stored state first, falling back to the result. */
async function open(plan: WorkoutPlan) {
  if (state.plan?.workoutId === plan.workoutId) return; // the host may resend the result; keep local progress
  try {
    const res = await app.callServerTool({ name: 'get_workout', arguments: { workoutId: plan.workoutId } });
    const fresh = (res.structuredContent as { workout?: WorkoutPlan } | undefined)?.workout;
    if (!res.isError && fresh) plan = fresh;
  } catch {
    /* offline: use what the tool result carried */
  }
  load(plan);
}

function load(plan: WorkoutPlan) {
  if (state.plan?.workoutId === plan.workoutId) return;
  state.plan = plan;
  state.finished = null;
  state.restUntil = 0;
  // Resuming: start at the first exercise with an open set.
  const open = plan.exercises.findIndex((e) => nextSet(e));
  if (open === -1 || plan.finished) {
    void finish();
    return;
  }
  select(open);
}

/** Prefill the steppers: the previous done set of this exercise if there is one (carry over), else the plan. */
function select(i: number) {
  const ex = state.plan!.exercises[i]!;
  state.current = i;
  const target = nextSet(ex) ?? ex.sets[ex.sets.length - 1]!;
  const prev = [...ex.sets].reverse().find((s) => s.done);
  state.reps = prev?.reps ?? target.targetReps;
  state.weight = prev?.weightKg ?? target.weightKg ?? 0;
  render();
}

function nextOpen(from: number): number {
  const ex = state.plan!.exercises;
  for (let k = 0; k < ex.length; k++) {
    const i = (from + k) % ex.length;
    if (nextSet(ex[i]!)) return i;
  }
  return -1;
}

function logSet(skip = false) {
  const plan = state.plan!;
  const ex = plan.exercises[state.current]!;
  const set = nextSet(ex);
  if (!set) return;
  if (skip) set.skipped = true;
  else {
    set.done = true;
    set.reps = state.reps;
    if (!ex.bodyweight) set.weightKg = state.weight;
    if (ex.restSec > 0) state.restUntil = Date.now() + ex.restSec * 1000;
  }
  void sync(set, ex, skip);
  if (nextSet(ex)) return render(); // next set of the same exercise starts from what was just done
  const next = nextOpen(state.current + 1);
  if (next === -1) {
    state.restUntil = 0;
    render();
  } else select(next);
}

async function sync(set: PlannedSet, ex: PlannedExercise, skip: boolean) {
  try {
    const args = { workoutId: state.plan!.workoutId, setId: set.id, reps: skip ? 0 : (set.reps ?? 0), skip, ...(ex.bodyweight || skip ? {} : { weightKg: set.weightKg }) };
    const res = await app.callServerTool({ name: 'log_set', arguments: args });
    state.serverOk = !res.isError;
  } catch {
    state.serverOk = false;
  }
  render();
  void app.updateModelContext({ content: [{ type: 'text', text: `Workout in progress. ${progressText()}` }] }).catch(() => undefined);
}

function progressText(): string {
  const plan = state.plan!;
  const parts = plan.exercises.map((ex) => {
    const done = ex.sets.filter((s) => s.done);
    if (!done.length) return `${ex.name}: not done`;
    return `${ex.name}: ${done.map((s) => (ex.bodyweight ? `${s.reps}` : `${s.reps}×${kg(s.weightKg ?? 0)} kg`)).join(', ')}`;
  });
  return `${plan.name} (${mmss(Date.now() - plan.startedAt)}). ${parts.join('; ')}.`;
}

async function finish() {
  if (state.finishing) return;
  state.finishing = true;
  state.restUntil = 0;
  render();
  let summary: FinishSummary | null = null;
  try {
    const res = await app.callServerTool({ name: 'finish_workout', arguments: { workoutId: state.plan!.workoutId } });
    if (!res.isError) summary = res.structuredContent as unknown as FinishSummary;
    state.serverOk = !res.isError;
  } catch {
    state.serverOk = false;
  }
  state.finished = summary ?? { minutes: Math.round((Date.now() - state.plan!.startedAt) / 60000), volumeKg: 0, exercises: [] };
  state.finishing = false;
  render();
  if (state.plan!.finished) return; // reopened a finished workout: nothing new to tell Claude
  state.plan!.finished = true;
  const prs = summary?.exercises.filter((e) => e.personalRecord).map((e) => `${e.name}: ${e.personalRecord}`) ?? [];
  const text = summary
    ? `I finished my workout "${state.plan!.name}" in ${summary.minutes} min (volume ${summary.volumeKg} kg). ${summary.exercises.map((e) => `${e.name}: ${e.done}`).join('; ')}.${prs.length ? ` Personal records: ${prs.join('; ')}.` : ''}`
    : `I finished my workout. ${progressText()}`;
  try {
    const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
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
  const logged = plan.exercises.reduce((n, e) => n + e.sets.filter(closed).length, 0);
  const ex = plan.exercises[state.current]!;
  const allDone = nextOpen(0) === -1;
  const resting = state.restUntil > Date.now();
  const ctx = app.getHostContext();
  const set = nextSet(ex);

  const body: Child[] = [
    h('header', {}, h('strong', {}, plan.name), h('span', { className: 'muted clock' }, `${logged}/${total} sets · `, h('span', { id: 'elapsed' }, mmss(Date.now() - plan.startedAt)))),
  ];

  if (state.finished) {
    const f = state.finished;
    body.push(
      h(
        'section',
        { className: 'card' },
        h('h1', {}, 'Workout finished'),
        h('p', { className: 'muted' }, `${f.minutes} min${f.volumeKg ? ` · ${f.volumeKg.toLocaleString()} kg lifted` : ''}`),
        ...f.exercises.map((e) => h('p', {}, h('strong', {}, e.name), ` ${e.done}`, e.personalRecord && h('span', { className: 'done' }, ` · ${e.personalRecord}`))),
        state.note && h('p', { className: 'muted small' }, state.note),
      ),
    );
  } else if (state.finishing) {
    body.push(h('section', { className: 'card' }, h('p', { className: 'muted' }, 'Saving…')));
  } else if (resting) {
    body.push(
      h(
        'section',
        { className: 'card rest', 'aria-label': 'Rest' },
        h('p', { className: 'muted' }, 'Rest'),
        h('p', { className: 'time', role: 'timer', id: 'rest' }, mmss(state.restUntil - Date.now())),
        h('p', { className: 'muted small' }, allDone ? 'All sets done' : `Next: ${ex.name}, set ${ex.sets.indexOf(set ?? ex.sets[0]!) + 1}`),
        h(
          'div',
          { className: 'actions' },
          h('button', { type: 'button', onclick: () => ((state.restUntil += 15_000), render()) }, '+15 s'),
          h('button', { type: 'button', className: 'primary', onclick: () => ((state.restUntil = 0), render()) }, 'Skip rest'),
        ),
      ),
    );
  } else if (!allDone && set) {
    body.push(
      h(
        'section',
        { className: 'card', 'aria-label': 'Current set' },
        h('p', { className: 'muted small' }, `Exercise ${state.current + 1} of ${plan.exercises.length} · ${ex.equipment}`),
        h('h1', {}, ex.name),
        h('p', {}, `Set ${ex.sets.indexOf(set) + 1} of ${ex.sets.length} · target ${set.targetReps} reps`),
        ex.lastTime && h('p', { className: 'muted small' }, `Last time: ${ex.lastTime}`),
        ex.note && h('p', { className: 'muted small' }, ex.note),
        h(
          'div',
          { className: 'steppers' },
          stepper('Reps', String(state.reps), () => ((state.reps = Math.max(0, state.reps - 1)), render()), () => ((state.reps += 1), render())),
          ex.bodyweight
            ? h('div', { className: 'stepper' }, h('span', { className: 'muted small' }, 'Load'), h('p', {}, 'Bodyweight'))
            : stepper('Weight kg', kg(state.weight), () => ((state.weight = Math.max(0, state.weight - 2.5)), render()), () => ((state.weight += 2.5), render())),
        ),
        h('button', { type: 'button', className: 'primary', onclick: () => logSet() }, 'Log set'),
        h('button', { type: 'button', onclick: () => logSet(true) }, 'Skip set'),
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
            { type: 'button', 'aria-current': i === state.current && !allDone ? 'step' : 'false', disabled: !!state.finished || state.finishing || !nextSet(e), onclick: () => select(i) },
            h('span', {}, e.name),
            h('span', { className: nextSet(e) ? 'dots' : 'dots done' }, e.sets.map((s) => (s.done ? '●' : s.skipped ? '–' : '○')).join('')),
          ),
        ),
      ),
    ),
  );
  if (!state.finished && !state.finishing) body.push(h('button', { type: 'button', className: allDone ? 'primary' : '', onclick: () => void finish() }, allDone ? 'Finish and send to Claude' : 'Finish early'));

  // Diagnostics: which client, and whether set logging reaches the server.
  const server = state.serverOk === null ? 'server: no set logged yet' : state.serverOk ? 'saved to Fitwell ✓' : 'could not reach Fitwell ✗';
  body.push(h('footer', {}, `${ctx?.platform ?? 'unknown platform'} · ${ctx?.displayMode ?? 'inline'} · ${server}`));

  root.replaceChildren(...body.filter((c): c is Node | string => c !== null && c !== false && c !== undefined));
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
  if (plan) void open(plan);
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
  if (elapsed) elapsed.textContent = mmss(Date.now() - state.plan.startedAt);
  const rest = document.getElementById('rest');
  if (rest) rest.textContent = mmss(state.restUntil - Date.now());
}, 1000);

await app.connect();
applyHost(app.getHostContext());
render();
