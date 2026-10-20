import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { ExerciseGuide } from '../../src/exercises/guide';
import type { PlannedCardio, PlannedExercise, PlannedSet, WorkoutPlan } from '../../src/workout/plan';
import { buildOverview, cardPosition, cardioClosed, drainQueue, finishState, firstOpenStep, formatLastTime, isFresh, kg, openingCard, stepName, stepOpen, stepsOf, workingCounts, WEIGHT_STEP, plateText as plateTextFor, setName, setValues, weightStepFor as weightStepForGym, type Step } from './cards';
import { h, type Child } from '../shared/dom';
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

type Kind = 'reps' | 'weight' | 'seconds' | 'minutes' | 'km';

const state = {
  plan: null as WorkoutPlan | null,
  /** Card position in the pager (0 is the Overview), read from the track's scroll position. */
  pos: 0,
  /** The step whose draft values the steppers hold. */
  current: 0,
  reps: 0,
  weight: 0,
  /** Timed sets: the seconds to log, and the running countdown (0 when stopped). */
  seconds: 0,
  holdUntil: 0,
  /** Timed sets: a short countdown before the hold starts, so the person can get into position. */
  readyUntil: 0,
  /** How far one tap on the weight stepper moves, by equipment. */
  weightStep: 0.5,
  minutes: 0,
  km: 0,
  /** The stepper whose value is being typed, if any. */
  editing: '' as Kind | '',
  /** The exercise whose note is being edited; the textarea exists only then (see notesPanel). */
  noteEditing: '',
  noteSaved: '',
  guideOpen: false,
  guides: new Map<string, ExerciseGuide>(),
  guideFailed: false,
  /** Swapping the current exercise: substitutes per exercise uid (fetched when the panel opens). */
  swapOpen: false,
  swapAll: false,
  swaps: new Map<string, { id: string; name: string; equipment: string }[]>(),
  swapNote: '',
  swapFailed: false,
  /** The exercise this slot had before a swap, until the first set is logged (undo). */
  swappedFrom: null as { id: string; name: string } | null,
  restUntil: 0,
  restTotal: 0,
  /** The step that holds the running rest (or the one that just ran out). */
  restStep: -1,
  /** The rest ran out by itself: wait for a tap instead of switching screens under a finger. */
  restOver: false,
  /** Moved straight on inside a superset round (no rest). */
  straightOn: false,
  /** The last set logged or skipped, so a mistake can be corrected. */
  lastLogged: null as { exUid: string; setId: string; text: string; skipped: boolean } | null,
  /** Primary actions are ignored for a moment after the screen changes (a double tap must not log twice). */
  lockUntil: 0,
  confirmFinish: false,
  finished: null as FinishSummary | null,
  finishing: false,
  sendFailed: false,
  note: '',
};

/** Changes that did not reach the server yet, by what they change; retried until they do. */
const pending = new Map<string, () => Promise<boolean>>();
/** The ones among them whose last try failed: only these are shown to the person (a save in flight is not news). */
const failed = new Set<string>();
let flushing = false;
let lastFlushAt = 0;

const root = document.getElementById('app')!;
const statusEl = document.getElementById('status');
/** Created the first time "How to do it" opens (a WebGL context is not free on a phone); null when the device has none. */
let motion: MotionPlayer | null | undefined;
let motionFor = '';
const app = new App({ name: 'Fitwell workout', version: '0.3.0' }, {}, { autoResize: true });

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
const closed = (s: PlannedSet) => s.done || !!s.skipped;
const nextSet = (e: PlannedExercise) => e.sets.find((s) => !closed(s));
const items = (): Item[] => {
  const plan = state.plan!;
  return [...plan.cardio.filter((c) => c.when === 'before').map((c): Item => ({ kind: 'cardio', c })), ...plan.exercises.map((ex): Item => ({ kind: 'ex', ex })), ...plan.cardio.filter((c) => c.when === 'after').map((c): Item => ({ kind: 'cardio', c }))];
};
const itemOpen = (it: Item) => stepOpen(it);

const weightStepFor = (ex: PlannedExercise) => weightStepForGym(ex, state.plan?.gym);
const plateText = (ex: PlannedExercise, weight: number) => plateTextFor(ex, weight, state.plan?.gym);

const lock = () => {
  state.lockUntil = Date.now() + 600;
};
const locked = () => Date.now() < state.lockUntil;

function startHold() {
  state.holdUntil = Date.now() + state.seconds * 1000;
}

// A short beep when a rest or a hold ends. A browser only allows sound after the person has touched the page, so the audio context is
// created on the first tap or key press; until then the screen change and the status announcement are the only cues.
let audio: AudioContext | null = null;
function wakeAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}
window.addEventListener('pointerdown', wakeAudio, { capture: true });
window.addEventListener('keydown', wakeAudio, { capture: true });

function beep(times = 1) {
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime;
  for (let i = 0; i < times; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const at = start + i * 0.28;
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.22);
  }
}

/** Tells a screen reader what just happened, once (the view itself is not a live region). */
function announce(text: string) {
  if (!statusEl) return;
  statusEl.textContent = '';
  window.setTimeout(() => {
    statusEl.textContent = text;
  }, 50);
}

// ---------- saving: every change is kept locally at once and retried until the server has it ----------
function enqueue(key: string, run: () => Promise<boolean>) {
  pending.set(key, run);
  void flush();
}

async function flush() {
  if (flushing) return;
  flushing = true;
  lastFlushAt = Date.now();
  try {
    await drainQueue(pending, failed);
  } finally {
    flushing = false;
  }
  if (failed.size > 0) announce(`${failed.size === 1 ? 'A change is' : `${failed.size} changes are`} not saved yet.`);
  render();
}

const call = async (name: string, args: Record<string, unknown>) => !(await app.callServerTool({ name, arguments: args })).isError;

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
  state.restOver = false;
  state.restStep = -1;
  const card = openingCard(plan);
  const steps = stepsOf(plan);
  state.pos = cardPosition(card, steps.length);
  state.current = -1;
  loadDraft(card.kind === 'step' ? card.index : Math.max(0, firstOpenStep(steps)));
  buildShell();
  render();
  if (ui) ui.track.scrollLeft = state.pos * ui.track.clientWidth;
  if (plan.finished) void finish();
}

/** Prefill the steppers: the previous done set of this exercise if there is one (carry over), else the plan. */
function loadDraft(i: number) {
  const it = items()[i]!;
  if (i !== state.current) state.swappedFrom = null;
  state.current = i;
  state.editing = '';
  state.noteEditing = '';
  state.noteSaved = '';
  state.guideOpen = false;
  state.swapOpen = false;
  state.swapAll = false;
  state.swapNote = '';
  state.swapFailed = false;
  state.confirmFinish = false;
  motion?.stop();
  motionFor = '';
  if (it.kind === 'ex') {
    const ex = it.ex;
    const target = nextSet(ex) ?? ex.sets[ex.sets.length - 1]!;
    // Carry over from the last done set of the same kind: a working set never starts from a warm-up's weight.
    const prev = [...ex.sets].reverse().find((x) => x.done && !!x.warmup === !!target.warmup);
    state.reps = prev?.reps ?? target.targetReps;
    state.weight = prev?.weightKg ?? target.weightKg ?? 0;
    state.seconds = prev?.seconds ?? target.targetSec ?? 30;
    state.holdUntil = 0;
    state.readyUntil = 0;
    state.weightStep = weightStepFor(ex);
  } else {
    state.minutes = it.c.minutes ?? it.c.plannedMin;
    state.km = it.c.distanceKm ?? it.c.plannedKm ?? 0;
  }
}

/** Moves to a step: its values are loaded and the pager goes there. */
function select(i: number) {
  state.restOver = false;
  loadDraft(i);
  render();
  goTo(i + 1);
}

function nextOpen(from: number): number {
  const all = items();
  for (let k = 0; k < all.length; k++) {
    const i = (from + k) % all.length;
    if (itemOpen(all[i]!)) return i;
  }
  return -1;
}

/** Exercises (as step indices) of the superset `ex` belongs to, in order; just `ex` when it is in none. */
function supersetSteps(ex: PlannedExercise): number[] {
  const all = items();
  if (!ex.supersetId) return [all.findIndex((x) => x.kind === 'ex' && x.ex === ex)];
  return all.flatMap((x, i) => (x.kind === 'ex' && x.ex.supersetId === ex.supersetId ? [i] : []));
}

function logSet(skip = false) {
  if (locked()) return;
  lock();
  const it = items()[state.current]!;
  if (it.kind !== 'ex') return;
  const ex = it.ex;
  const set = nextSet(ex);
  if (!set) return;
  state.holdUntil = 0;
  state.readyUntil = 0;
  state.swappedFrom = null;
  state.straightOn = false;
  state.confirmFinish = false;
  state.restOver = false;
  if (skip) set.skipped = true;
  else {
    set.done = true;
    set.reps = ex.timed ? 0 : state.reps;
    if (ex.timed) set.seconds = state.seconds;
    if (!ex.bodyweight) set.weightKg = state.weight;
    // A warm-up needs only a short breather.
    const rest = set.warmup ? Math.min(ex.restSec, 60) : ex.restSec;
    if (rest > 0) {
      state.restUntil = Date.now() + rest * 1000;
      state.restTotal = rest * 1000;
      state.restStep = state.current;
    }
  }
  state.lastLogged = { exUid: ex.uid, setId: set.id, text: skip ? `${ex.name} · ${setName(ex, set)} skipped` : `${ex.name} · ${setName(ex, set)} · ${setValues(ex, set)}`, skipped: skip };
  announce(skip ? `Skipped ${setName(ex, set)}.` : `Logged ${setValues(ex, set)}.${state.restUntil > Date.now() ? ` Rest ${mmss(state.restUntil - Date.now())}.` : ''}`);
  enqueue(`set:${set.id}:${ex.uid}`, () => {
    const args = { workoutId: state.plan!.workoutId, setId: set.id, reps: skip ? 0 : (set.reps ?? 0), skip, ...(ex.bodyweight || skip ? {} : { weightKg: set.weightKg }), ...(ex.timed && !skip ? { seconds: set.seconds ?? 0 } : {}) };
    return call('log_set', args);
  });
  void shareProgress();
  if (ex.supersetId) {
    // A superset goes round by round: straight on to the next exercise of the round, rest after the last one.
    const steps = supersetSteps(ex);
    const open = steps.filter((i) => itemOpen(items()[i]!));
    const later = open.find((i) => i > state.current);
    if (later !== undefined) {
      state.restUntil = 0;
      select(later);
      state.straightOn = true;
      render();
      return;
    }
    if (open.length) return select(open[0]!); // a new round, after the rest
  }
  const following = nextSet(ex);
  if (following) {
    // Working sets carry over what was just done; warm-ups, and the first working set after them, start from the plan.
    if (following.warmup || set.warmup) {
      state.reps = following.targetReps;
      state.weight = following.weightKg ?? state.weight;
    }
    return render();
  }
  const next = nextOpen(state.current + 1);
  if (next === -1) {
    state.restUntil = 0;
    render();
  } else select(next);
}

/** Opens the last logged or skipped set again, with its values in the steppers, to correct it. */
function editLast() {
  const last = state.lastLogged;
  const plan = state.plan;
  if (!last || !plan || locked()) return;
  const index = plan.exercises.findIndex((e) => e.uid === last.exUid);
  const ex = plan.exercises[index];
  const set = ex?.sets.find((s) => s.id === last.setId);
  if (!ex || !set) return;
  set.done = false;
  delete set.skipped;
  state.restUntil = 0;
  state.restOver = false;
  state.lastLogged = null;
  const step = items().findIndex((x) => x.kind === 'ex' && x.ex === ex);
  select(step);
  state.reps = set.reps || set.targetReps;
  state.weight = set.weightKg ?? state.weight;
  state.seconds = set.seconds ?? set.targetSec ?? state.seconds;
  enqueue(`set:${set.id}:${ex.uid}`, () => call('log_set', { workoutId: plan.workoutId, setId: set.id, reps: 0, reopen: true }));
  announce(`${ex.name} ${setName(ex, set)} is open again.`);
  lock();
  render();
}

function logCardio(skip = false) {
  if (locked()) return;
  lock();
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
  state.lastLogged = null;
  enqueue(`cardio:${c.id}`, () => call('log_cardio_block', { workoutId: state.plan!.workoutId, blockId: c.id, skip, ...(skip ? {} : { minutes: c.minutes ?? c.plannedMin, ...(c.distanceKm ? { distanceKm: c.distanceKm } : {}) }) }));
  void shareProgress();
  const next = nextOpen(state.current + 1);
  if (next === -1) render();
  else select(next);
}

/** Saved when the person leaves the note field; the text is kept locally at once so a redraw never loses it. */
function saveNote(ex: PlannedExercise) {
  enqueue(`note:${ex.uid}`, () => call('set_exercise_note', { workoutId: state.plan!.workoutId, exerciseId: ex.uid, notes: ex.notes ?? '' }));
}

/** Lets Claude know where the workout stands, so "how am I doing?" works mid-workout. */
async function shareProgress() {
  try {
    await app.updateModelContext({ content: [{ type: 'text', text: `Workout in progress. ${progressText()}` }] });
  } catch {
    /* the host may not support it */
  }
}

function progressText(): string {
  const plan = state.plan!;
  const parts = items().map((it) => {
    if (it.kind === 'cardio') return it.c.done ? `${it.c.name} ${it.c.minutes ?? it.c.plannedMin} min${it.c.distanceKm ? `, ${kg(it.c.distanceKm)} km` : ''}` : `${it.c.name}: ${it.c.skipped ? 'skipped' : 'not done'}`;
    const ex = it.ex;
    const done = ex.sets.filter((x) => x.done);
    const note = ex.notes ? ` (note: ${ex.notes})` : '';
    if (!done.length) return `${ex.name}: not done${note}`;
    return `${ex.name}: ${done.filter((x) => !x.warmup).map((x) => (ex.timed ? `${x.seconds ?? 0} s` : ex.bodyweight ? `${x.reps}` : `${x.reps}×${kg(x.weightKg ?? 0)} kg`)).join(', ')}${note}`;
  });
  return `${plan.name} (${mmss(Date.now() - plan.startedAt)}). ${parts.join('; ')}.`;
}

async function finish() {
  if (state.finishing || (state.plan && !state.plan.finished && locked())) return;
  lock();
  motion?.stop();
  state.finishing = true;
  state.confirmFinish = false;
  state.restUntil = 0;
  state.restOver = false;
  render();
  if (pending.size > 0) await flush(); // what is still unsaved gets one more try before the workout is closed
  let summary: FinishSummary | null = null;
  try {
    const res = await app.callServerTool({ name: 'finish_workout', arguments: { workoutId: state.plan!.workoutId } });
    if (!res.isError) summary = res.structuredContent as unknown as FinishSummary;
  } catch {
    /* the summary below is built from what is on screen */
  }
  state.finished = summary ?? { minutes: Math.round((Date.now() - state.plan!.startedAt) / 60000), volumeKg: 0, exercises: [] };
  state.finishing = false;
  render();
  if (state.plan!.finished) return; // reopened a finished workout: nothing new to tell Claude
  state.plan!.finished = true;
  void sendSummary(summary);
}

async function sendSummary(summary: FinishSummary | null) {
  const prs = summary?.exercises.filter((e) => e.personalRecord).map((e) => `${e.name}: ${e.personalRecord}`) ?? [];
  const unsaved = failed.size > 0 ? ` ${failed.size} change${failed.size === 1 ? ' was' : 's were'} not saved to Fitwell.` : '';
  const text = summary
    ? `I finished my workout "${state.plan!.name}" in ${summary.minutes} min (volume ${summary.volumeKg} kg). ${summary.exercises.map((e) => `${e.name}: ${e.done}${e.notes ? ` (note: ${e.notes})` : ''}`).join('; ')}.${summary.cardio?.length ? ` Cardio: ${summary.cardio.map((c) => `${c.minutes} min ${c.activity}${c.distanceKm ? ` ${kg(c.distanceKm)} km` : ''}`).join('; ')}.` : ''}${prs.length ? ` Personal records: ${prs.join('; ')}.` : ''}${unsaved}`
    : `I finished my workout. ${progressText()}${unsaved}`;
  try {
    const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
    state.sendFailed = !!res.isError;
  } catch {
    state.sendFailed = true;
  }
  state.note = state.sendFailed ? 'Could not send the summary to Claude.' : 'Sent to Claude. It will reply below; ask it to fix anything that is wrong.';
  render();
}

// ---------- view ----------
const STEPPERS: Record<Kind, { label: string; text: () => string; change: (dir: 1 | -1) => void; set: (n: number) => void; raw: () => string; decimal: boolean }> = {
  reps: { label: 'Reps', text: () => String(state.reps), change: (d) => void (state.reps = clamp(state.reps + d, 0, 100)), set: (n) => void (state.reps = clamp(Math.round(n), 0, 100)), raw: () => String(state.reps), decimal: false },
  weight: { label: 'Weight kg', text: () => kg(state.weight), change: (d) => void (state.weight = clamp(r1(state.weight + d * state.weightStep), 0, 500)), set: (n) => void (state.weight = clamp(r1(n), 0, 500)), raw: () => kg(state.weight), decimal: true },
  seconds: { label: 'Seconds', text: () => String(state.seconds), change: (d) => void (state.seconds = clamp(state.seconds + d * 5, 0, 3600)), set: (n) => void (state.seconds = clamp(Math.round(n), 0, 3600)), raw: () => String(state.seconds), decimal: false },
  minutes: { label: 'Minutes', text: () => String(state.minutes), change: (d) => void (state.minutes = clamp(state.minutes + d, 1, 240)), set: (n) => void (state.minutes = clamp(Math.round(n), 1, 240)), raw: () => String(state.minutes), decimal: false },
  km: { label: 'Distance km', text: () => (state.km > 0 ? kg(state.km) : '–'), change: (d) => void (state.km = clamp(r1(state.km + d * 0.5), 0, 500)), set: (n) => void (state.km = clamp(r1(n), 0, 500)), raw: () => (state.km > 0 ? kg(state.km) : ''), decimal: true },
};

/**
 * A tap changes the value once, when the finger lifts; holding repeats it. Nothing changes when the finger goes down, so a swipe or a
 * scroll that starts on a button never changes a value, and a repeat that lost its "finger up" (a host page that took over the
 * gesture) stops by itself: on a move, on the page being hidden, or after a few seconds. The output text is updated in place while
 * held, so the button under the finger stays.
 */
function pressable(btn: HTMLButtonElement, kind: Kind, dir: 1 | -1, out: HTMLElement) {
  const MAX_HOLD_MS = 4000;
  const MOVE_PX = 10;
  let delay: number | undefined;
  let repeat: number | undefined;
  let repeating = false;
  let changed = false;
  let startX = 0;
  let startY = 0;
  const step = () => {
    // A typed value that was not committed yet (this press blurred the field) counts first, so the step starts from it.
    if (state.editing) {
      const field = root.querySelector<HTMLInputElement>('.value-field');
      if (field) {
        const n = Number.parseFloat(field.value.replace(',', '.'));
        if (Number.isFinite(n) && n >= 0) STEPPERS[state.editing].set(n);
      }
      state.editing = '';
    }
    STEPPERS[kind].change(dir);
    changed = true;
    out.textContent = STEPPERS[kind].text();
  };
  const release = () => {
    window.clearTimeout(delay);
    window.clearInterval(repeat);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', cancel);
    repeating = false;
    if (changed) {
      changed = false;
      render();
    }
  };
  const up = () => {
    if (!repeating) step();
    release();
  };
  const cancel = () => release();
  const move = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_PX && !repeating) release();
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    release();
    startX = e.clientX;
    startY = e.clientY;
    delay = window.setTimeout(() => {
      repeating = true;
      step();
      const until = Date.now() + MAX_HOLD_MS;
      repeat = window.setInterval(() => (Date.now() > until ? release() : step()), 90);
    }, 450);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('pointermove', move);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
  });
  // A keyboard press arrives as a click without a pointer; touch and mouse clicks are already handled above.
  btn.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    step();
    changed = false;
    render();
  });
}

/** Typing replaces tapping: the value becomes a field until it is left. */
function commitValue(kind: Kind, raw: string) {
  const n = Number.parseFloat(raw.replace(',', '.'));
  if (Number.isFinite(n) && n >= 0) STEPPERS[kind].set(n);
  state.editing = '';
  render();
}

function stepper(kind: Kind) {
  const spec = STEPPERS[kind];
  const out = h('output', { 'data-key': `${kind}-value` }, spec.text());
  const by = kind === 'weight' ? ` by ${kg(state.weightStep)} kg` : '';
  const dec = h('button', { type: 'button', 'aria-label': `Decrease ${spec.label.toLowerCase()}${by}`, 'data-key': `${kind}-dec` }, '−');
  const inc = h('button', { type: 'button', 'aria-label': `Increase ${spec.label.toLowerCase()}${by}`, 'data-key': `${kind}-inc` }, '+');
  pressable(dec, kind, -1, out);
  pressable(inc, kind, 1, out);
  let value: HTMLElement;
  if (state.editing === kind) {
    const field = h('input', {
      type: 'text',
      inputMode: spec.decimal ? 'decimal' : 'numeric',
      value: spec.raw(),
      'aria-label': spec.label,
      className: 'value-field',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          state.editing = '';
          render();
        }
      },
      onblur: (e: FocusEvent) => {
        if (state.editing === kind) commitValue(kind, (e.target as HTMLInputElement).value);
      },
    });
    value = field;
  } else {
    value = h(
      'button',
      {
        type: 'button',
        className: 'value',
        'aria-label': `${spec.label}: ${spec.text()}. Tap to type a value.`,
        'data-key': `${kind}-edit`,
        onclick: () => {
          state.editing = kind;
          render();
          // Still inside the tap, so iOS opens the keyboard.
          const field = root.querySelector<HTMLInputElement>('.value-field');
          field?.focus();
          field?.select();
        },
      },
      out,
    );
  }
  return h('div', { className: 'stepper', role: 'group', 'aria-label': spec.label }, h('span', { className: 'muted small' }, spec.label), h('div', { className: 'row' }, dec, value, inc));
}

/** "Superset with Triceps Pushdown · round 1 of 2": where an exercise sits in its superset. */
function supersetLabel(ex: PlannedExercise): string | null {
  if (!ex.supersetId) return null;
  const others = supersetSteps(ex)
    .map((i) => items()[i]!)
    .flatMap((x) => (x.kind === 'ex' && x.ex !== ex ? [x.ex.name] : []));
  const working = ex.sets.filter((x) => !x.warmup);
  const set = nextSet(ex);
  const round = set && !set.warmup ? working.indexOf(set) + 1 : 1;
  return `Superset with ${others.join(' and ')} · round ${round} of ${working.length}`;
}

const EQUIPMENT: Record<string, string> = { 'body only': 'bodyweight', other: 'other' };
const equipmentName = (e: string) => EQUIPMENT[e.toLowerCase()] ?? e;

/** The note for one exercise: shown as a line, edited in a panel under the action row. The textarea exists only while editing. */
function notesPanel(ex: PlannedExercise) {
  if (state.noteEditing !== ex.uid) return null;
  const before = ex.notes ?? '';
  const area = h('textarea', {
    rows: 2,
    maxLength: 300,
    value: before,
    placeholder: 'e.g. seat 4, slow on the way down',
    'aria-label': `Note for ${ex.name}`,
    oninput: (e: Event) => {
      ex.notes = (e.target as HTMLTextAreaElement).value;
    },
    // No redraw here: a tap on another button blurs the field first, and redrawing now would swallow that tap.
    onblur: () => {
      if ((ex.notes ?? '') !== before) saveNote(ex);
    },
  });
  return h(
    'div',
    { className: 'panel notes' },
    area,
    h(
      'button',
      {
        type: 'button',
        onclick: () => {
          state.noteEditing = '';
          state.noteSaved = ex.uid;
          saveNote(ex);
          render();
        },
      },
      'Save note',
    ),
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
  if (!state.guideOpen) return null;
  const g = state.guides.get(ex.id);
  return h(
    'div',
    { className: 'panel guidebox' },
    g
      ? renderGuide(g, openLink, animation(g))
      : state.guideFailed
        ? h('p', { className: 'muted small' }, 'Could not load the guide. ', h('button', { type: 'button', className: 'link', onclick: () => ((state.guideFailed = false), void loadGuide(ex.id), render()) }, 'Try again'))
        : h('p', { className: 'muted small' }, 'Loading…'),
    h('button', { type: 'button', className: 'link', onclick: () => toggleGuide(ex) }, 'Close the guide'),
  );
}

function toggleGuide(ex: PlannedExercise) {
  state.guideOpen = !state.guideOpen;
  if (state.guideOpen && !state.guides.has(ex.id)) void loadGuide(ex.id);
  if (!state.guideOpen) {
    motion?.stop();
    motionFor = '';
  }
  render();
}

async function loadSwaps(ex: PlannedExercise) {
  try {
    const res = await app.callServerTool({ name: 'get_substitutes', arguments: { workoutId: state.plan!.workoutId, exerciseId: ex.uid } });
    const list = (res.structuredContent as { substitutes?: { id: string; name: string; equipment: string }[] } | undefined)?.substitutes;
    if (res.isError || !list) throw new Error('no data');
    state.swaps.set(ex.uid, list);
    state.swapNote = list.length ? '' : 'No similar exercise fits your equipment.';
    state.swapFailed = false;
  } catch {
    state.swapNote = 'Could not load alternatives.';
    state.swapFailed = true;
  }
  render();
}

async function swap(ex: PlannedExercise, to: { id: string; name: string }) {
  state.swapNote = `Swapping to ${to.name}…`;
  state.swapFailed = false;
  render();
  try {
    const res = await app.callServerTool({ name: 'swap_exercise', arguments: { workoutId: state.plan!.workoutId, exerciseId: ex.uid, newId: to.id } });
    const plan = (res.structuredContent as { workout?: WorkoutPlan } | undefined)?.workout;
    if (res.isError || !plan) throw new Error('refused');
    plan.cardio ??= [];
    const undoing = state.swappedFrom?.id === to.id;
    const from = { id: ex.id, name: ex.name };
    state.plan = plan;
    state.swaps.delete(ex.uid);
    motion?.stop();
    motionFor = '';
    select(state.current); // prefill the steppers from the new exercise
    state.swappedFrom = undoing ? null : from;
    announce(`Swapped to ${to.name}.`);
    render();
  } catch {
    state.swapNote = 'Could not swap the exercise.';
    state.swapFailed = true;
    render();
  }
}

/** "Swap exercise": similar exercises for the same muscles, offered until the first set of this exercise is logged. */
function swapPanel(ex: PlannedExercise) {
  if (!state.swapOpen) return null;
  const list = state.swaps.get(ex.uid);
  const shown = list && !state.swapAll ? list.slice(0, 4) : list;
  return h(
    'div',
    { className: 'panel swapbox' },
    shown
      ? h('div', { className: 'swaps' }, ...shown.map((x) => h('button', { type: 'button', onclick: () => void swap(ex, x) }, h('span', {}, x.name), h('span', { className: 'muted small' }, equipmentName(x.equipment)))))
      : !state.swapNote && h('p', { className: 'muted small' }, 'Loading…'),
    list && !state.swapAll && list.length > 4 && h('button', { type: 'button', className: 'link', onclick: () => ((state.swapAll = true), render()) }, `Show ${list.length - 4} more`),
    state.swapNote && h('p', { className: 'muted small' }, state.swapNote, ' ', state.swapFailed && h('button', { type: 'button', className: 'link', onclick: () => (list ? void swap(ex, list[0]!) : void loadSwaps(ex)) }, 'Try again')),
  );
}

/** What comes after the set that was just logged, shown while resting: reps and weight, last time, notes. */
function upNext(it: Item | undefined): Child {
  if (!it || !itemOpen(it)) return h('p', { className: 'next' }, h('strong', {}, 'Last set done.'), " Finish when you're ready.");
  if (it.kind === 'cardio') {
    return h('div', { className: 'next' }, h('p', { className: 'muted small' }, it.c.when === 'before' ? 'Next: warm-up' : 'Next: finisher'), h('p', { className: 'nexttitle' }, it.c.name), h('p', {}, `${state.minutes} min${state.km > 0 ? ` · ${kg(state.km)} km` : ''}`));
  }
  const ex = it.ex;
  const set = nextSet(ex)!;
  const started = ex.sets.some(closed);
  return h(
    'div',
    { className: 'next' },
    h('p', { className: 'muted small' }, started ? 'Next set' : 'Next exercise'),
    h('p', { className: 'nexttitle' }, ex.name),
    h('p', {}, `${setName(ex, set).replace(/^./, (c) => c.toUpperCase())} · `, h('strong', {}, ex.bodyweight ? `${state.reps} reps, bodyweight` : `${state.reps} × ${kg(state.weight)} kg`)),
    !started && ex.lastTime && h('p', { className: 'muted small' }, formatLastTime(ex.lastTime)),
    !started && ex.note && h('p', { className: 'muted small' }, ex.note),
    ex.notes && h('p', { className: 'small' }, `Note: ${ex.notes}`),
    !started && !ex.notes && ex.lastNotes && h('p', { className: 'muted small' }, `Last note: ${ex.lastNotes}`),
  );
}

function listLabel(it: Item) {
  if (it.kind === 'cardio') return `${it.c.name} · ${it.c.minutes ?? it.c.plannedMin} min`;
  return it.ex.name;
}

/** The "just logged" line with the way back: shown while resting and on the next set. */
function lastLoggedLine(): Child {
  const last = state.lastLogged;
  if (!last) return null;
  return h('p', { className: 'justlogged' }, h('span', {}, last.skipped ? 'Skipped: ' : 'Logged: ', last.text.replace(/ skipped$/, '')), h('button', { type: 'button', className: 'link', 'data-key': 'edit-last', onclick: editLast }, last.skipped ? 'Undo skip' : 'Edit'));
}

function setDots(step: Item): { text: string; aria: string; node: Node } {
  if (step.kind === 'cardio') {
    const glyph = step.c.done ? '●' : step.c.skipped ? '–' : '○';
    return { text: glyph, aria: step.c.done ? 'done' : step.c.skipped ? 'skipped' : 'not done', node: h('span', { className: step.c.done || step.c.skipped ? 'dots done' : 'dots', 'aria-hidden': 'true' }, glyph) };
  }
  const glyph = (x: PlannedSet) => (x.done ? '●' : x.skipped ? '–' : '○');
  const warm = step.ex.sets.filter((x) => x.warmup);
  const working = step.ex.sets.filter((x) => !x.warmup);
  const doneWorking = working.filter((x) => x.done).length;
  const skipped = working.filter((x) => x.skipped).length;
  const aria = `${doneWorking} of ${working.length} sets done${skipped ? `, ${skipped} skipped` : ''}${warm.length ? `, ${warm.filter((x) => x.done).length} of ${warm.length} warm-ups` : ''}`;
  return {
    text: '',
    aria,
    node: h('span', { className: itemOpen(step) ? 'dots' : 'dots done', 'aria-hidden': 'true' }, warm.length > 0 && h('span', { className: 'wdots' }, warm.map(glyph).join('')), working.map(glyph).join('')),
  };
}

// ---------- pager ----------
interface Shell {
  header: HTMLElement;
  clock: HTMLElement;
  save: HTMLElement;
  strip: HTMLButtonElement;
  counter: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  chip: HTMLElement;
  track: HTMLElement;
  cards: HTMLElement[];
}

let ui: Shell | null = null;
let pointerDown = false;
let pendingFocus = -1;
let settleTimer: number | undefined;
let saveShown = 0;
const hasScrollEnd = 'onscrollend' in window;

const clean = (cs: Child[]) => cs.filter((c): c is Node | string => c !== null && c !== false && c !== undefined);
const cardCount = () => items().length + 2;
const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const cardName = (pos: number) => {
  const all = items();
  return pos === 0 ? 'Overview' : pos === all.length + 1 ? 'Finish' : stepName(all[pos - 1]!);
};

function buildShell() {
  const plan = state.plan!;
  const clock = h('span', { className: 'muted clock' });
  const save = h('p', { className: 'status-line', role: 'status', hidden: true });
  const strip = h('button', { type: 'button', className: 'strip', 'data-strip': '', 'data-key': 'strip', onclick: () => goTo(0, { focus: true }) });
  const counter = h('span', { className: 'muted small counter' });
  const prev = h('button', { type: 'button', className: 'nav', 'aria-label': 'Previous card', 'data-key': 'prev', onclick: () => goTo(state.pos - 1) }, '‹');
  const next = h('button', { type: 'button', className: 'nav', 'aria-label': 'Next card', 'data-key': 'next', onclick: () => goTo(state.pos + 1) }, '›');
  const chip = h('div', { className: 'chip', hidden: true });
  const header = h('header', { className: 'head' }, h('div', { className: 'titlebar' }, h('strong', {}, plan.name), clock), save, h('div', { className: 'navrow' }, prev, strip, counter, next), chip);
  const cards = Array.from({ length: cardCount() }, () => h('section', { className: 'pcard', role: 'group', 'aria-roledescription': 'card' }));
  const track = h(
    'div',
    {
      className: 'track',
      'aria-roledescription': 'carousel',
      'aria-label': 'Workout cards',
      onscroll: () => {
        if (hasScrollEnd) return;
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(settle, 120);
      },
      onscrollend: () => settle(),
      onpointerdown: () => {
        pointerDown = true;
      },
    },
    ...cards,
  );
  ui = { header, clock, save, strip, counter, prev, next, chip, track, cards };
  root.replaceChildren(header, track);
}

window.addEventListener('pointerup', () => (pointerDown = false), { capture: true });
window.addEventListener('pointercancel', () => (pointerDown = false), { capture: true });
window.addEventListener('blur', () => (pointerDown = false));

/** The card the track is showing: nearest card to the scroll position, read from the track itself. */
function trackPos(): number {
  if (!ui) return 0;
  const w = ui.track.clientWidth;
  return w > 0 ? clamp(Math.round(ui.track.scrollLeft / w), 0, ui.cards.length - 1) : state.pos;
}

/** The scroll came to rest: the card in view is the current one. */
function settle() {
  if (!ui) return;
  const pos = trackPos();
  if (pos !== state.pos) enterCard(pos);
  if (pendingFocus === pos) ui.cards[pos]?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  pendingFocus = -1;
}

function enterCard(pos: number) {
  state.pos = pos;
  const step = pos - 1;
  if (step >= 0 && step < items().length && step !== state.current) loadDraft(step);
  render();
}

/** Moves the pager; never while a finger is down on the track (it would fight the swipe). */
function goTo(pos: number, opts: { focus?: boolean } = {}) {
  if (!ui || pointerDown) return;
  const target = clamp(pos, 0, ui.cards.length - 1);
  pendingFocus = opts.focus ? target : -1;
  if (trackPos() === target) {
    settle();
    return;
  }
  ui.cards[target]!.scrollIntoView({ inline: 'center', block: 'nearest', behavior: scrollBehavior() });
}

document.addEventListener('keydown', (e) => {
  if (!ui || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const to = e.key === 'ArrowLeft' ? state.pos - 1 : e.key === 'ArrowRight' ? state.pos + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ui.cards.length - 1 : null;
  if (to === null) return;
  e.preventDefault();
  goTo(to);
});

const setNumber = (ex: PlannedExercise, set: PlannedSet) => (set.warmup ? `warm-up ${ex.sets.filter((x) => x.warmup).indexOf(set) + 1}` : `set ${ex.sets.filter((x) => !x.warmup).indexOf(set) + 1}`);
const restRunning = () => state.restUntil > Date.now() && state.restStep >= 0 && state.restStep < items().length;

function stripSegments(): Node[] {
  const plan = state.plan!;
  const steps = stepsOf(plan);
  const count = steps.length + 2;
  const stepState = (s: Step) => {
    if (s.kind === 'cardio') return cardioClosed(s.c) ? 'full' : 'empty';
    const closedCount = s.ex.sets.filter(closed).length;
    return closedCount === s.ex.sets.length ? 'full' : closedCount > 0 ? 'half' : 'empty';
  };
  if (count > 12) {
    const closedSteps = steps.filter((s) => !stepOpen(s)).length;
    const bar = h('span', { className: 'cbar', 'aria-hidden': 'true' }, h('span', { className: 'cfill' }), h('span', { className: 'cmark' }));
    bar.style.setProperty('--fill', String((closedSteps / Math.max(1, steps.length)) * 100));
    bar.style.setProperty('--pos', String((state.pos / (count - 1)) * 100));
    return [bar];
  }
  const overview = isFresh(steps) ? 'empty' : 'full';
  const end = plan.finished || state.finished ? 'full' : steps.every((s) => !stepOpen(s)) ? 'half' : 'empty';
  return Array.from({ length: count }, (_, pos) => {
    const kind = pos === 0 ? overview : pos === count - 1 ? end : stepState(steps[pos - 1]!);
    return h('span', { className: `seg ${kind}${pos === state.pos ? ' current' : ''}`, 'data-seg': kind, 'aria-hidden': 'true' });
  });
}

function updateHeader() {
  if (!ui || !state.plan) return;
  const plan = state.plan;
  const count = ui.cards.length;
  ui.clock.replaceChildren(...(state.finished ? [`${state.finished.minutes} min`] : [h('span', { 'data-clock': 'elapsed' }, mmss(Date.now() - plan.startedAt))]));
  if (failed.size !== saveShown) {
    saveShown = failed.size;
    ui.save.hidden = failed.size === 0;
    ui.save.replaceChildren(...clean(failed.size === 0 ? [] : [`${failed.size === 1 ? '1 change is' : `${failed.size} changes are`} not saved yet. `, h('button', { type: 'button', className: 'link', 'data-key': 'retry', onclick: () => void flush() }, 'Try again')]));
  }
  ui.strip.setAttribute('aria-label', `Card ${state.pos + 1} of ${count}. Go to the overview.`);
  ui.strip.replaceChildren(...stripSegments());
  ui.counter.textContent = `${state.pos + 1} / ${count}`;
  ui.prev.disabled = state.pos === 0;
  ui.next.disabled = state.pos === count - 1;
  const show = restRunning() && state.pos !== 0 && state.pos !== state.restStep + 1;
  ui.chip.hidden = !show;
  if (!show) {
    ui.chip.replaceChildren();
    return;
  }
  const it = items()[state.restStep]!;
  const set = it.kind === 'ex' ? nextSet(it.ex) : undefined;
  ui.chip.replaceChildren(
    h('span', {}, 'Rest ', h('span', { 'data-clock': 'rest' }, mmss(state.restUntil - Date.now())), ` · ${stepName(it)}${it.kind === 'ex' && set ? ` · ${setNumber(it.ex, set)} next` : ''}`),
    h('button', { type: 'button', 'data-key': 'chip-go', onclick: () => goTo(state.restStep + 1, { focus: true }) }, 'Go'),
  );
}

function overviewBody(): Child[] {
  const plan = state.plan!;
  const ov = buildOverview(plan);
  const rest = restRunning() ? items()[state.restStep] : undefined;
  const restSet = rest?.kind === 'ex' ? nextSet(rest.ex) : undefined;
  return [
    h(
      'div',
      { className: 'card overview' },
      h('p', { className: 'muted small' }, 'Today'),
      h('h1', { tabIndex: -1 }, plan.name),
      h('p', {}, `${ov.workingDone} of ${ov.workingTotal} sets · ${ov.exerciseCount} ${ov.exerciseCount === 1 ? 'exercise' : 'exercises'}`),
      h('progress', { className: 'ovprogress', max: Math.max(1, ov.workingTotal), value: ov.workingDone, 'aria-label': 'Sets done' }),
      rest &&
        h(
          'div',
          { className: 'restrow' },
          h('span', {}, 'Resting ', h('span', { 'data-clock': 'rest' }, mmss(state.restUntil - Date.now())), rest.kind === 'ex' && restSet ? ` · Next: ${rest.ex.name}, ${setName(rest.ex, restSet)}` : ''),
          h('button', { type: 'button', 'data-key': 'rest-go', onclick: () => goTo(state.restStep + 1, { focus: true }) }, 'Go'),
        ),
      h(
        'ol',
        { className: 'list', 'aria-label': 'Workout steps' },
        ...ov.rows.map((row) => {
          const [done, total] = row.progress.split('/');
          const label = total === undefined ? `${row.name}, ${row.progress}` : `${row.name}, ${done} of ${total} sets done`;
          return h(
            'li',
            { className: row.superset ? 'ss' : '' },
            h(
              'button',
              { type: 'button', className: 'ovrow', 'aria-label': label, ...(row.superset ? { 'aria-describedby': `ss-${row.index}` } : {}), 'data-key': `row-${row.index}`, onclick: () => goTo(row.index + 1, { focus: true }) },
              h('span', { className: 'rowtext' }, h('span', { className: 'name' }, row.name), row.todayTarget && h('span', { className: 'muted small' }, `Today: ${row.todayTarget}`), row.lastTime && h('span', { className: 'muted small' }, row.lastTime)),
              h('span', { className: row.open ? 'dots' : 'dots done', 'aria-hidden': 'true' }, row.dots),
              row.superset && h('span', { className: 'sr-only', id: `ss-${row.index}` }, 'Superset'),
            ),
          );
        }),
      ),
      ov.action && !plan.finished && h('button', { type: 'button', className: 'primary', 'data-key': 'overview-go', onclick: () => goTo(ov.action!.stepIndex + 1, { focus: true }) }, ov.action.label),
      h('p', { className: 'muted small center-text' }, 'Ask Claude to change the plan.'),
    ),
  ];
}

function summaryBody(): Child[] {
  const plan = state.plan!;
  const working = plan.exercises.flatMap((e) => e.sets.filter((s) => !s.warmup));
    const f = state.finished;
    if (!f) return [];
    const doneWorking = working.filter((s) => s.done).length;
    const bests = f.exercises.filter((e) => e.personalRecord);
    const skipped = plan.exercises.flatMap((e) => e.sets.flatMap((s) => (s.skipped && !s.warmup ? [`${e.name} set ${e.sets.filter((x) => !x.warmup).indexOf(s) + 1}`] : [])));
    const notDone = plan.exercises.flatMap((e) => e.sets.flatMap((s) => (!closed(s) && !s.warmup ? [`${e.name} set ${e.sets.filter((x) => !x.warmup).indexOf(s) + 1}`] : [])));
    return [
      h(
        'div',
        { className: 'card summary' },
        h('h1', { tabIndex: -1 }, 'Workout finished'),
        h('p', { className: 'muted' }, `${f.minutes} min · ${doneWorking} working ${doneWorking === 1 ? 'set' : 'sets'}${f.volumeKg ? ` · ${f.volumeKg.toLocaleString()} kg lifted` : ''}`),
        bests.length > 0 && h('div', { className: 'bests' }, h('h2', {}, 'New best'), ...bests.map((e) => h('p', {}, h('strong', {}, e.name), ` · ${(e.personalRecord ?? '').replace(/^new best\s*/i, '')}`))),
        ...f.exercises.map((e) => h('p', {}, h('strong', {}, e.name), ` ${e.done}`, e.notes && h('span', { className: 'muted small block' }, `Note: ${e.notes}`))),
        skipped.length > 0 && h('p', {}, h('strong', {}, 'Skipped'), ` ${skipped.join(', ')}`),
        notDone.length > 0 && h('p', {}, h('strong', {}, 'Not done'), ` ${notDone.join(', ')}`),
        ...(f.cardio ?? []).map((c) => h('p', {}, h('strong', {}, c.activity), ` ${c.minutes} min${c.distanceKm ? ` · ${kg(c.distanceKm)} km` : ''}${c.kcal ? ` · about ${c.kcal} kcal` : ''}`)),
        state.note && h('p', { className: 'muted small' }, state.note, ' ', state.sendFailed && h('button', { type: 'button', className: 'link', onclick: () => ((state.sendFailed = false), state.note = '', void sendSummary(state.finished), render()) }, 'Send again')),
      ),
    ];
}

function finishBody(): Child[] {
  const plan = state.plan!;
  if (state.finished) return summaryBody();
  if (state.finishing) return [h('div', { className: 'card' }, h('h1', { tabIndex: -1 }, 'Finish'), h('p', { className: 'muted' }, 'Saving…'))];
  const steps = stepsOf(plan);
  const fs = finishState(steps);
  const counts = workingCounts(steps);
  const first = firstOpenStep(steps);
  return [
    h(
      'div',
      { className: 'card finish' },
      h('h1', { tabIndex: -1 }, 'Finish'),
      h('p', { className: 'muted' }, h('span', { 'data-clock': 'elapsed' }, mmss(Date.now() - plan.startedAt)), ` elapsed · ${counts.closed} of ${counts.total} working sets`),
      fs.notDone.length > 0 && h('p', {}, h('strong', {}, 'Not done'), ` ${fs.notDone.join(', ')}`),
      fs.skipped.length > 0 && h('p', {}, h('strong', {}, 'Skipped'), ` ${fs.skipped.join(', ')}`),
      fs.canFinishDirectly
        ? h('button', { type: 'button', className: 'primary', 'data-key': 'finish', onclick: () => void finish() }, 'Finish and send to Claude')
        : state.confirmFinish
          ? h(
              'div',
              { className: 'confirm', role: 'group', 'aria-label': 'End the workout?' },
              h('p', {}, h('strong', {}, 'End the workout now?'), ` ${fs.workingOpen} ${fs.workingOpen === 1 ? 'set is' : 'sets are'} not done.`),
              h(
                'div',
                { className: 'actions' },
                h('button', { type: 'button', 'data-key': 'keep', onclick: () => ((state.confirmFinish = false), render(), first !== -1 && goTo(first + 1, { focus: true })) }, 'Keep training'),
                h('button', { type: 'button', className: 'primary', onclick: () => void finish() }, 'End and send to Claude'),
              ),
            )
          : h('button', { type: 'button', className: 'finish-early', 'data-key': 'finish-early', onclick: () => ((state.confirmFinish = true), render()) }, 'Finish early'),
    ),
  ];
}

/** One step's card: the full body for the current step, a heading with its progress for the others (they are out of view). */
function stepCardBody(i: number): Child[] {
  const plan = state.plan!;
  const all = items();
  const it = all[i]!;
  if (i !== state.current) return [h('div', { className: 'card' }, h('h1', { tabIndex: -1 }, listLabel(it)), setDots(it).node)];
  const out: Child[] = [];
  const allDone = nextOpen(0) === -1;
  const resting = restRunning() && state.restStep === i;
  if (resting) {
    out.push(
      h(
        'div',
        { className: 'card rest' },
        lastLoggedLine(),
        h('p', { className: 'muted' }, 'Rest'),
        h('p', { className: 'time', role: 'timer', 'data-clock': 'rest' }, mmss(state.restUntil - Date.now())),
        h('div', { className: 'bar', 'aria-hidden': 'true' }, h('span', { 'data-restbar': '' })),
        upNext(allDone ? undefined : it),
        h(
          'div',
          { className: 'actions three' },
          h('button', { type: 'button', 'data-key': 'rest-less', onclick: () => ((state.restUntil = Math.max(Date.now() + 1000, state.restUntil - 15_000)), (state.restTotal = Math.max(1000, state.restTotal - 15_000)), render()) }, '−15 s'),
          h('button', { type: 'button', 'data-key': 'rest-more', onclick: () => ((state.restUntil += 15_000), (state.restTotal += 15_000), render()) }, '+15 s'),
          h('button', { type: 'button', className: 'primary', 'data-key': 'rest-skip', onclick: () => (locked() ? undefined : (lock(), (state.restUntil = 0), render())) }, 'Skip rest'),
        ),
      ),
    );
  } else if (state.restOver && state.restStep === i && !allDone) {
    const set = it.kind === 'ex' ? nextSet(it.ex) : undefined;
    out.push(
      h(
        'div',
        { className: 'card rest' },
        lastLoggedLine(),
        h('p', { className: 'muted' }, 'Rest over'),
        h('p', { className: 'time' }, '0:00'),
        upNext(it),
        h('div', { className: 'actions' }, h('button', { type: 'button', className: 'primary wide', 'data-key': 'start-set', onclick: () => (locked() ? undefined : ((state.restOver = false), lock(), render())) }, it.kind === 'ex' && set ? `Start ${setName(it.ex, set)}` : 'Start')),
      ),
    );
  } else if (it.kind === 'ex' && nextSet(it.ex)) {
    const ex = it.ex;
    const set = nextSet(ex)!;
    const warm = ex.sets.filter((x) => x.warmup);
    const which = set.warmup ? `Warm-up ${warm.indexOf(set) + 1} of ${warm.length}` : `Set ${ex.sets.filter((x) => !x.warmup).indexOf(set) + 1} of ${ex.sets.filter((x) => !x.warmup).length}`;
    const target = ex.timed ? `target ${set.targetSec ?? 0} s` : `target ${set.targetReps} reps`;
    const plates = plateText(ex, state.weight);
    const holding = state.holdUntil > Date.now();
    const ready = state.readyUntil > Date.now();
    const started = ex.sets.some(closed);
    const canSwap = !started;
    out.push(
      h(
        'div',
        { className: set.warmup ? 'card set warmup' : 'card set' },
        h('p', { className: 'muted small' }, `Exercise ${plan.exercises.indexOf(ex) + 1} of ${plan.exercises.length} · ${equipmentName(ex.equipment)}`),
        h('h1', { tabIndex: -1 }, ex.name),
        ex.supersetId && h('p', { className: 'small ss' }, supersetLabel(ex), state.straightOn && ' · straight on, no rest'),
        h('p', { className: 'setline' }, set.warmup && h('span', { className: 'pill' }, 'Warm-up'), set.warmup && ' ', `${which} · ${target}`),
        lastLoggedLine(),
        ex.lastTime && h('p', { className: 'muted small' }, formatLastTime(ex.lastTime)),
        ex.notes && h('p', { className: 'small' }, `Note: ${ex.notes}`, state.noteSaved === ex.uid && h('span', { className: 'muted' }, ' · saved')),
        ex.lastNotes && !ex.notes && h('p', { className: 'muted small' }, `Last note: ${ex.lastNotes}`),
        state.swappedFrom && !started && h('p', { className: 'small' }, `Swapped from ${state.swappedFrom.name} · `, h('button', { type: 'button', className: 'link', onclick: () => void swap(ex, state.swappedFrom!) }, 'Undo')),
        h('div', { className: 'steppers' }, ex.timed ? stepper('seconds') : stepper('reps'), ex.bodyweight ? h('div', { className: 'stepper' }, h('span', { className: 'muted small' }, 'Load'), h('p', { className: 'bodyweight' }, 'Bodyweight')) : stepper('weight')),
        !started && !ex.bodyweight && !ex.timed && state.weightStep !== WEIGHT_STEP && h('p', { className: 'muted small' }, `Weight moves in ${kg(state.weightStep)} kg steps. Tap the number to type another value.`),
        plates && h('p', { className: 'muted small plates' }, plates),
        ex.note && h('p', { className: 'muted small' }, ex.note),
        ex.timed &&
          h(
            'div',
            { className: 'hold' },
            ready && h('p', { className: 'time', role: 'timer', 'data-clock': 'ready' }, `Get ready ${Math.max(1, Math.ceil((state.readyUntil - Date.now()) / 1000))}`),
            holding && h('p', { className: 'time', role: 'timer', 'data-clock': 'hold' }, mmss(state.holdUntil - Date.now())),
            ready
              ? h(
                  'div',
                  { className: 'actions' },
                  h('button', { type: 'button', onclick: () => ((state.readyUntil = 0), startHold(), render()) }, 'Start now'),
                  h('button', { type: 'button', onclick: () => ((state.readyUntil = 0), render()) }, 'Cancel'),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    onclick: () => {
                      if (holding) {
                        state.seconds = clamp(state.seconds - Math.ceil((state.holdUntil - Date.now()) / 1000), 0, 3600); // stopped early: log what was held
                        state.holdUntil = 0;
                      } else state.readyUntil = Date.now() + 5000;
                      render();
                    },
                  },
                  holding ? 'Stop the timer' : `Start a ${state.seconds} s timer (5 s to get ready)`,
                ),
          ),
        h('button', { type: 'button', className: 'primary', 'data-key': 'log', onclick: () => logSet() }, ex.timed || ex.bodyweight ? `Log set · ${setValues(ex, { reps: state.reps, seconds: state.seconds, weightKg: state.weight })}` : `Log set · ${setValues(ex, { reps: state.reps, weightKg: state.weight })}`),
        h(
          'div',
          { className: 'more' },
          h('button', { type: 'button', className: 'link', 'data-key': 'skip', onclick: () => logSet(true) }, 'Skip set'),
          h(
            'button',
            {
              type: 'button',
              className: 'link',
              'aria-expanded': String(state.noteEditing === ex.uid),
              'data-key': 'note',
              onclick: () => {
                state.noteEditing = state.noteEditing === ex.uid ? '' : ex.uid;
                state.noteSaved = '';
                render();
                // Still inside the tap, so iOS opens the keyboard.
                root.querySelector<HTMLTextAreaElement>('.notes textarea')?.focus();
              },
            },
            ex.notes ? 'Edit note' : 'Note',
          ),
          canSwap &&
            h(
              'button',
              {
                type: 'button',
                className: 'link',
                'aria-expanded': String(state.swapOpen),
                'data-key': 'swap',
                onclick: () => {
                  state.swapOpen = !state.swapOpen;
                  if (state.swapOpen && !state.swaps.has(ex.uid)) void loadSwaps(ex);
                  render();
                },
              },
              'Swap',
            ),
          h('button', { type: 'button', className: 'link', 'aria-expanded': String(state.guideOpen), 'data-key': 'guide', onclick: () => toggleGuide(ex) }, 'How to do it'),
        ),
        notesPanel(ex),
        canSwap && swapPanel(ex),
        guidePanel(ex),
      ),
    );
  } else if (it.kind === 'cardio' && !cardioClosed(it.c)) {
    const c = it.c;
    out.push(
      h(
        'div',
        { className: 'card' },
        h('p', { className: 'muted small' }, c.when === 'before' ? 'Warm-up' : 'Finisher'),
        h('h1', { tabIndex: -1 }, c.name),
        h('p', {}, `Planned ${c.plannedMin} min${c.plannedKm ? ` · ${kg(c.plannedKm)} km` : ''}`),
        h('div', { className: 'steppers' }, stepper('minutes'), stepper('km')),
        h('button', { type: 'button', className: 'primary', 'data-key': 'log', onclick: () => logCardio() }, 'Log cardio'),
        h('div', { className: 'more' }, h('button', { type: 'button', className: 'link', 'data-key': 'skip', onclick: () => logCardio(true) }, 'Skip this')),
      ),
    );
  } else if (it.kind === 'ex') {
    // An exercise with nothing left to do: what was logged, and its note can still be changed.
    const ex = it.ex;
    out.push(
      h(
        'div',
        { className: 'card' },
        h('h1', { tabIndex: -1 }, ex.name),
        h('p', { className: 'muted' }, ex.sets.filter((x) => !x.warmup).map((x) => (x.done ? (ex.timed ? `${x.seconds ?? 0} s` : ex.bodyweight ? `${x.reps}` : `${x.reps}×${kg(x.weightKg ?? 0)} kg`) : 'skipped')).join(' · ')),
        ex.notes && h('p', { className: 'small' }, `Note: ${ex.notes}`),
        h('div', { className: 'more' }, h('button', { type: 'button', className: 'link', onclick: () => ((state.noteEditing = state.noteEditing === ex.uid ? '' : ex.uid), render(), root.querySelector<HTMLTextAreaElement>('.notes textarea')?.focus()) }, ex.notes ? 'Edit note' : 'Note')),
        notesPanel(ex),
        !allDone && h('button', { type: 'button', className: 'primary', onclick: () => select(nextOpen(i + 1)) }, 'Continue the workout'),
      ),
    );
  } else {
    const c = it.c;
    out.push(h('div', { className: 'card' }, h('h1', { tabIndex: -1 }, c.name), h('p', { className: 'muted' }, c.done ? `${c.minutes ?? c.plannedMin} min${c.distanceKm ? ` · ${kg(c.distanceKm)} km` : ''}` : 'skipped'), !allDone && h('button', { type: 'button', className: 'primary', onclick: () => select(nextOpen(i + 1)) }, 'Continue the workout')));
  }
  return out;
}

function render() {
  const plan = state.plan;
  if (!plan || !ui) return;
  // Typing a note or a value: a redraw would drop the cursor, so wait until the field is left.
  const typing = document.activeElement?.tagName;
  if (typing === 'TEXTAREA' || (typing === 'INPUT' && state.editing)) return;
  const focusKey = document.activeElement?.getAttribute('data-key');
  updateHeader();
  const last = ui.cards.length - 1;
  ui.cards.forEach((card, pos) => {
    const body = pos === 0 ? overviewBody() : pos === last ? finishBody() : stepCardBody(pos - 1);
    const top = card.scrollTop;
    card.setAttribute('aria-label', `${pos + 1} of ${last + 1}: ${cardName(pos)}`);
    card.inert = pos !== state.pos;
    card.replaceChildren(...clean(body));
    card.scrollTop = top;
  });
  // The cards were redrawn: put the focus back on the same control, so a keyboard or switch user keeps their place.
  if (focusKey) {
    const sel = `[data-key="${focusKey}"]`;
    (ui.cards[state.pos]?.querySelector<HTMLElement>(sel) ?? ui.header.querySelector<HTMLElement>(sel))?.focus({ preventScroll: true });
  }
  updateClocks();
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
  else if (result.isError) {
    const message = h('p', { className: 'error center' }, 'The workout could not be started. Claude will explain why.');
    if (ui) ui.track.replaceWith(message);
    else root.replaceChildren(message);
    ui = null;
  }
};
app.onhostcontextchanged = (ctx) => {
  applyHost(ctx);
  motion?.setTheme();
  render();
};

/** The running clocks and the rest bar: only text and a width change, so buttons are never replaced under a finger. */
function updateClocks() {
  if (!state.plan) return;
  const now = Date.now();
  for (const el of document.querySelectorAll<HTMLElement>('[data-clock]')) {
    switch (el.dataset.clock) {
      case 'ready':
        el.textContent = `Get ready ${Math.max(1, Math.ceil((state.readyUntil - now) / 1000))}`;
        break;
      case 'hold':
        el.textContent = mmss(state.holdUntil - now);
        break;
      case 'elapsed':
        el.textContent = mmss(now - state.plan.startedAt);
        break;
      case 'rest':
        el.textContent = mmss(state.restUntil - now);
        break;
    }
  }
  if (state.restTotal > 0) for (const bar of document.querySelectorAll<HTMLElement>('[data-restbar]')) bar.style.width = `${clamp(((state.restUntil - now) / state.restTotal) * 100, 0, 100)}%`;
}

// Once a second: update the clocks, and notice a rest or a hold that ran out.
setInterval(() => {
  if (!state.plan || state.finished) return;
  if (failed.size > 0 && Date.now() - lastFlushAt > 15_000) void flush();
  if (state.restUntil && state.restUntil <= Date.now()) {
    state.restUntil = 0;
    state.restOver = nextOpen(0) !== -1;
    lock();
    announce('Rest over.');
    beep(2);
    try {
      navigator.vibrate?.(200);
    } catch {
      /* not allowed in this frame */
    }
    render();
    return;
  }
  if (state.readyUntil && state.readyUntil <= Date.now()) {
    state.readyUntil = 0;
    startHold();
    announce('Go.');
    beep(1);
    render();
    return;
  }
  if (state.holdUntil && state.holdUntil <= Date.now()) {
    state.holdUntil = 0;
    announce('Time.');
    beep(3);
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* not allowed in this frame */
    }
    render();
    return;
  }
  updateClocks();
}, 1000);

await app.connect();
applyHost(app.getHostContext());
render();
