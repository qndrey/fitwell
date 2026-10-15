import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { ExerciseGuide } from '../../src/exercises/guide';
import type { PlannedCardio, PlannedExercise, PlannedSet, WorkoutPlan } from '../../src/workout/plan';
import { renderGuide } from '../shared/guide';
import { createMotionPlayer, type MotionPlayer } from '../shared/motionView';

interface FinishSummary {
  minutes: number;
  volumeKg: number;
  exercises: { name: string; done: string; personalRecord?: string; notes?: string }[];
  cardio?: { activity: string; when: string; minutes: number; distanceKm?: number; kcal?: number }[];
}

/** One step of the workout: a warm-up, an exercise or a finisher, in the order they are done. */
type Item = { kind: 'ex'; ex: PlannedExercise } | { kind: 'cardio'; c: PlannedCardio };

const state = {
  plan: null as WorkoutPlan | null,
  current: 0,
  reps: 0,
  weight: 0,
  minutes: 0,
  km: 0,
  noteOpen: false,
  guideOpen: false,
  guides: new Map<string, ExerciseGuide>(),
  guideFailed: false,
  restUntil: 0,
  finished: null as FinishSummary | null,
  finishing: false,
  serverOk: null as boolean | null,
  note: '',
};

const root = document.getElementById('app')!;
/** Created the first time "How to do it" opens (a WebGL context is not free on a phone); null when the device has none. */
let motion: MotionPlayer | null | undefined;
let motionFor = '';
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
const cardioClosed = (c: PlannedCardio) => c.done || !!c.skipped;
const items = (): Item[] => {
  const plan = state.plan!;
  return [...plan.cardio.filter((c) => c.when === 'before').map((c): Item => ({ kind: 'cardio', c })), ...plan.exercises.map((ex): Item => ({ kind: 'ex', ex })), ...plan.cardio.filter((c) => c.when === 'after').map((c): Item => ({ kind: 'cardio', c }))];
};
const itemOpen = (it: Item) => (it.kind === 'ex' ? !!nextSet(it.ex) : !cardioClosed(it.c));

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
  plan.cardio ??= []; // a workout saved before cardio blocks existed
  state.plan = plan;
  state.finished = null;
  state.restUntil = 0;
  // Resuming: start at the first step that still has something open.
  const open = items().findIndex(itemOpen);
  if (open === -1 || plan.finished) {
    void finish();
    return;
  }
  select(open);
}

/** Prefill the steppers: the previous done set of this exercise if there is one (carry over), else the plan. */
function select(i: number) {
  const it = items()[i]!;
  state.current = i;
  state.noteOpen = it.kind === 'ex' && !!it.ex.notes;
  state.guideOpen = false;
  state.guideFailed = false;
  motion?.stop();
  motionFor = '';
  if (it.kind === 'ex') {
    const ex = it.ex;
    const target = nextSet(ex) ?? ex.sets[ex.sets.length - 1]!;
    const prev = [...ex.sets].reverse().find((x) => x.done);
    state.reps = prev?.reps ?? target.targetReps;
    state.weight = prev?.weightKg ?? target.weightKg ?? 0;
  } else {
    state.minutes = it.c.minutes ?? it.c.plannedMin;
    state.km = it.c.distanceKm ?? it.c.plannedKm ?? 0;
  }
  render();
}

function nextOpen(from: number): number {
  const all = items();
  for (let k = 0; k < all.length; k++) {
    const i = (from + k) % all.length;
    if (itemOpen(all[i]!)) return i;
  }
  return -1;
}

function logSet(skip = false) {
  const it = items()[state.current]!;
  if (it.kind !== 'ex') return;
  const ex = it.ex;
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

function logCardio(skip = false) {
  const it = items()[state.current]!;
  if (it.kind !== 'cardio') return;
  const c = it.c;
  if (skip) c.skipped = true;
  else {
    c.done = true;
    c.minutes = state.minutes;
    if (state.km > 0) c.distanceKm = state.km;
    delete c.skipped;
  }
  void syncCardio(c, skip);
  const next = nextOpen(state.current + 1);
  if (next === -1) render();
  else select(next);
}

async function syncCardio(c: PlannedCardio, skip: boolean) {
  try {
    const res = await app.callServerTool({ name: 'log_cardio_block', arguments: { workoutId: state.plan!.workoutId, blockId: c.id, skip, ...(skip ? {} : { minutes: c.minutes ?? c.plannedMin, ...(c.distanceKm ? { distanceKm: c.distanceKm } : {}) }) } });
    state.serverOk = !res.isError;
  } catch {
    state.serverOk = false;
  }
  render();
  void app.updateModelContext({ content: [{ type: 'text', text: `Workout in progress. ${progressText()}` }] }).catch(() => undefined);
}

/** Saved when the person leaves the note field; the text is kept locally at once so a redraw never loses it. */
async function saveNote(ex: PlannedExercise) {
  try {
    const res = await app.callServerTool({ name: 'set_exercise_note', arguments: { workoutId: state.plan!.workoutId, exerciseId: ex.uid, notes: ex.notes ?? '' } });
    state.serverOk = !res.isError;
  } catch {
    state.serverOk = false;
  }
  render();
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
  const parts = items().map((it) => {
    if (it.kind === 'cardio') return it.c.done ? `${it.c.name} ${it.c.minutes ?? it.c.plannedMin} min${it.c.distanceKm ? `, ${kg(it.c.distanceKm)} km` : ''}` : `${it.c.name}: ${it.c.skipped ? 'skipped' : 'not done'}`;
    const ex = it.ex;
    const done = ex.sets.filter((x) => x.done);
    const note = ex.notes ? ` (note: ${ex.notes})` : '';
    if (!done.length) return `${ex.name}: not done${note}`;
    return `${ex.name}: ${done.map((x) => (ex.bodyweight ? `${x.reps}` : `${x.reps}×${kg(x.weightKg ?? 0)} kg`)).join(', ')}${note}`;
  });
  return `${plan.name} (${mmss(Date.now() - plan.startedAt)}). ${parts.join('; ')}.`;
}

async function finish() {
  if (state.finishing) return;
  motion?.stop();
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
    ? `I finished my workout "${state.plan!.name}" in ${summary.minutes} min (volume ${summary.volumeKg} kg). ${summary.exercises.map((e) => `${e.name}: ${e.done}${e.notes ? ` (note: ${e.notes})` : ''}`).join('; ')}.${summary.cardio?.length ? ` Cardio: ${summary.cardio.map((c) => `${c.minutes} min ${c.activity}${c.distanceKm ? ` ${kg(c.distanceKm)} km` : ''}`).join('; ')}.` : ''}${prs.length ? ` Personal records: ${prs.join('; ')}.` : ''}`
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

/** A note field for one exercise. The text is kept in the plan at once; the server gets it when the field is left. */
function notesEditor(ex: PlannedExercise) {
  const area = h('textarea', {
    rows: 2,
    maxLength: 300,
    value: ex.notes ?? '',
    placeholder: 'e.g. seat 4, slow on the way down',
    'aria-label': `Note for ${ex.name}`,
    oninput: (e: Event) => {
      ex.notes = (e.target as HTMLTextAreaElement).value;
    },
    onchange: () => void saveNote(ex),
  });
  return h(
    'details',
    { className: 'notes', open: state.noteOpen || !!ex.notes, ontoggle: (e: Event) => ((state.noteOpen = (e.target as HTMLDetailsElement).open), undefined) },
    h('summary', {}, ex.notes ? 'Note' : 'Add a note'),
    area,
  );
}

/** Asks the host to open a link; false when it cannot (the guide then shows the search words to copy). */
async function openLink(url: string): Promise<boolean> {
  try {
    const res = await app.openLink({ url });
    return !res.isError;
  } catch {
    return false;
  }
}

async function loadGuide(id: string) {
  try {
    const res = await app.callServerTool({ name: 'get_exercise_guide', arguments: { id } });
    const g = (res.structuredContent as { guide?: ExerciseGuide } | undefined)?.guide;
    if (res.isError || !g) throw new Error('no guide');
    state.guides.set(id, g);
    state.guideFailed = false;
  } catch {
    state.guideFailed = true;
  }
  render();
}

/** The animation element for an open guide, created on first use and started once per exercise. */
function animation(g: ExerciseGuide): HTMLElement | null {
  if (!state.guideOpen) return null;
  if (motion === undefined) motion = createMotionPlayer();
  if (!motion) return null;
  if (motionFor !== g.ref) {
    motion.show(g.motion, g.name, { primary: g.primary, secondary: g.secondary });
    motionFor = g.ref;
  }
  return motion.element;
}

/** "How to do it": animation, muscles, steps and machine setup, fetched the first time it is opened. */
function guidePanel(ex: PlannedExercise) {
  const g = state.guides.get(ex.id);
  return h(
    'details',
    {
      className: 'guidebox',
      open: state.guideOpen,
      ontoggle: (e: Event) => {
        state.guideOpen = (e.target as HTMLDetailsElement).open;
        if (state.guideOpen && !state.guides.has(ex.id)) void loadGuide(ex.id);
        if (!state.guideOpen) {
          motion?.stop();
          motionFor = '';
        }
      },
    },
    h('summary', {}, 'How to do it'),
    g ? renderGuide(g, openLink, animation(g)) : h('p', { className: 'muted small' }, state.guideFailed ? 'Could not load the guide. Close and open it to try again.' : 'Loading…'),
  );
}

/** What comes after the set that was just logged, shown while resting: reps and weight, last time, notes. */
function upNext(it: Item | undefined): Child {
  if (!it || !itemOpen(it)) return h('p', { className: 'next' }, h('strong', {}, 'That was the last set.'), ' Next: finish the workout.');
  if (it.kind === 'cardio') {
    return h('div', { className: 'next' }, h('p', { className: 'muted small' }, it.c.when === 'before' ? 'Next: warm-up' : 'Next: finisher'), h('p', { className: 'nexttitle' }, it.c.name), h('p', {}, `${state.minutes} min${state.km > 0 ? ` · ${kg(state.km)} km` : ''}`));
  }
  const ex = it.ex;
  const set = nextSet(ex)!;
  const n = ex.sets.indexOf(set) + 1;
  const started = ex.sets.some(closed);
  return h(
    'div',
    { className: 'next' },
    h('p', { className: 'muted small' }, started ? 'Next set' : 'Next exercise'),
    h('p', { className: 'nexttitle' }, ex.name),
    h('p', {}, `Set ${n} of ${ex.sets.length} · `, h('strong', {}, ex.bodyweight ? `${state.reps} reps, bodyweight` : `${state.reps} × ${kg(state.weight)} kg`)),
    !started && ex.lastTime && h('p', { className: 'muted small' }, `Last time: ${ex.lastTime}`),
    !started && ex.note && h('p', { className: 'muted small' }, ex.note),
    ex.notes && h('p', { className: 'small' }, `Note: ${ex.notes}`),
    !started && !ex.notes && ex.lastNotes && h('p', { className: 'muted small' }, `Last note: ${ex.lastNotes}`),
  );
}

function listLabel(it: Item) {
  if (it.kind === 'cardio') return `${it.c.name} · ${it.c.minutes ?? it.c.plannedMin} min`;
  return it.ex.name;
}

function render() {
  const plan = state.plan;
  if (!plan) return;
  // Typing a note: a redraw would drop the cursor, so wait until the field is left.
  if (document.activeElement?.tagName === 'TEXTAREA') return;
  const all = items();
  const it = all[state.current]!;
  const total = plan.exercises.reduce((n, e) => n + e.sets.length, 0);
  const logged = plan.exercises.reduce((n, e) => n + e.sets.filter(closed).length, 0);
  const allDone = nextOpen(0) === -1;
  const resting = state.restUntil > Date.now();
  const ctx = app.getHostContext();

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
        ...f.exercises.map((e) => h('p', {}, h('strong', {}, e.name), ` ${e.done}`, e.personalRecord && h('span', { className: 'done' }, ` · ${e.personalRecord}`), e.notes && h('span', { className: 'muted small block' }, `Note: ${e.notes}`))),
        ...(f.cardio ?? []).map((c) => h('p', {}, h('strong', {}, c.activity), ` ${c.minutes} min${c.distanceKm ? ` · ${kg(c.distanceKm)} km` : ''}${c.kcal ? ` · about ${c.kcal} kcal` : ''}`)),
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
        upNext(allDone ? undefined : it),
        h(
          'div',
          { className: 'actions' },
          h('button', { type: 'button', onclick: () => ((state.restUntil += 15_000), render()) }, '+15 s'),
          h('button', { type: 'button', className: 'primary', onclick: () => ((state.restUntil = 0), render()) }, 'Skip rest'),
        ),
      ),
    );
  } else if (it.kind === 'ex' && nextSet(it.ex)) {
    const ex = it.ex;
    const set = nextSet(ex)!;
    body.push(
      h(
        'section',
        { className: 'card', 'aria-label': 'Current set' },
        h('p', { className: 'muted small' }, `Exercise ${plan.exercises.indexOf(ex) + 1} of ${plan.exercises.length} · ${ex.equipment}`),
        h('h1', {}, ex.name),
        h('p', {}, `Set ${ex.sets.indexOf(set) + 1} of ${ex.sets.length} · target ${set.targetReps} reps`),
        ex.lastTime && h('p', { className: 'muted small' }, `Last time: ${ex.lastTime}`),
        ex.note && h('p', { className: 'muted small' }, ex.note),
        ex.lastNotes && !ex.notes && h('p', { className: 'muted small' }, `Last note: ${ex.lastNotes}`),
        h(
          'div',
          { className: 'steppers' },
          stepper('Reps', String(state.reps), () => ((state.reps = Math.max(0, state.reps - 1)), render()), () => ((state.reps += 1), render())),
          ex.bodyweight
            ? h('div', { className: 'stepper' }, h('span', { className: 'muted small' }, 'Load'), h('p', {}, 'Bodyweight'))
            : stepper('Weight kg', kg(state.weight), () => ((state.weight = Math.max(0, state.weight - 2.5)), render()), () => ((state.weight += 2.5), render())),
        ),
        guidePanel(ex),
        notesEditor(ex),
        h('button', { type: 'button', className: 'primary', onclick: () => logSet() }, 'Log set'),
        h('button', { type: 'button', onclick: () => logSet(true) }, 'Skip set'),
      ),
    );
  } else if (it.kind === 'cardio' && !cardioClosed(it.c)) {
    const c = it.c;
    body.push(
      h(
        'section',
        { className: 'card', 'aria-label': 'Cardio' },
        h('p', { className: 'muted small' }, c.when === 'before' ? 'Warm-up' : 'Finisher'),
        h('h1', {}, c.name),
        h('p', {}, `Planned ${c.plannedMin} min${c.plannedKm ? ` · ${kg(c.plannedKm)} km` : ''}`),
        h(
          'div',
          { className: 'steppers' },
          stepper('Minutes', String(state.minutes), () => ((state.minutes = Math.max(1, state.minutes - 1)), render()), () => ((state.minutes += 1), render())),
          stepper('Distance km', state.km > 0 ? kg(state.km) : '–', () => ((state.km = Math.max(0, Math.round((state.km - 0.5) * 10) / 10)), render()), () => ((state.km = Math.round((state.km + 0.5) * 10) / 10), render())),
        ),
        h('button', { type: 'button', className: 'primary', onclick: () => logCardio() }, 'Done'),
        h('button', { type: 'button', onclick: () => logCardio(true) }, 'Skip'),
      ),
    );
  } else if (it.kind === 'ex') {
    // An exercise with nothing left to do: what was logged, and its note can still be changed.
    const ex = it.ex;
    body.push(
      h(
        'section',
        { className: 'card', 'aria-label': 'Finished exercise' },
        h('h1', {}, ex.name),
        h('p', { className: 'muted' }, ex.sets.map((x) => (x.done ? (ex.bodyweight ? `${x.reps}` : `${x.reps}×${kg(x.weightKg ?? 0)} kg`) : 'skipped')).join(' · ')),
        notesEditor(ex),
        !allDone && h('button', { type: 'button', className: 'primary', onclick: () => select(nextOpen(state.current + 1)) }, 'Continue the workout'),
      ),
    );
  } else {
    const c = it.c;
    body.push(h('section', { className: 'card', 'aria-label': 'Finished cardio' }, h('h1', {}, c.name), h('p', { className: 'muted' }, c.done ? `${c.minutes ?? c.plannedMin} min${c.distanceKm ? ` · ${kg(c.distanceKm)} km` : ''}` : 'skipped'), !allDone && h('button', { type: 'button', className: 'primary', onclick: () => select(nextOpen(state.current + 1)) }, 'Continue the workout')));
  }

  body.push(
    h(
      'ol',
      { className: 'list', 'aria-label': 'Workout steps' },
      ...all.map((step, i) => {
        const open = itemOpen(step);
        const dots = step.kind === 'ex' ? step.ex.sets.map((x) => (x.done ? '●' : x.skipped ? '–' : '○')).join('') : step.c.done ? '●' : step.c.skipped ? '–' : '○';
        return h(
          'li',
          {},
          h(
            'button',
            { type: 'button', 'aria-current': i === state.current ? 'step' : 'false', disabled: !!state.finished || state.finishing || resting, onclick: () => select(i) },
            h('span', {}, listLabel(step)),
            h('span', { className: open ? 'dots' : 'dots done' }, dots),
          ),
        );
      }),
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
  motion?.setTheme();
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
