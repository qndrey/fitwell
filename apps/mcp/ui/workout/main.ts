import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { ExerciseGuide } from '../../src/exercises/guide';
import type { PlannedCardio, PlannedExercise, PlannedSet, WorkoutPlan } from '../../src/workout/plan';
import { buildOverview, nextSet, cardPosition, cardioClosed, drainQueue, draftFor, finishState, firstOpenStep, formatLastTime, isFresh, kg, nextTarget, openingCard, stepName, stepOpen, stepsOf, supersetHandoff, workingCounts, WEIGHT_STEP, plateText as plateTextFor, setName, setValues, type Draft, type PagerIntent, type Rest, type Step } from './cards';
import { h, type Child } from '../shared/dom';
import { renderGuide } from '../shared/guide';
import { createMotionPlayer, type MotionPlayer } from '../shared/motionView';

interface FinishSummary {
  minutes: number;
  volumeKg: number;
  exercises: {
    name: string;
    done: string;
    personalRecord?: string;
    notes?: string;
  }[];
  cardio?: {
    activity: string;
    when: string;
    minutes: number;
    distanceKm?: number;
    kcal?: number;
  }[];
}

/** One step of the workout: a warm-up, an exercise or a finisher, in the order they are done. */
type Item = { kind: 'ex'; ex: PlannedExercise } | { kind: 'cardio'; c: PlannedCardio };

type Kind = 'reps' | 'weight' | 'seconds' | 'minutes' | 'km';
type Scope = 'zone' | 'edit';

const state = {
  plan: null as WorkoutPlan | null,
  /** Card position in the pager (0 is the Overview), read from the track's scroll position. */
  pos: 0,
  /** One set of stepper values per step, kept while the view is open. */
  drafts: [] as Draft[],
  /** The logged set whose editor is open (one at a time), with the values being edited. */
  edit: null as {
    stepIndex: number;
    uid: string;
    setId: string;
    draft: Draft;
  } | null,
  /** The stepper whose value is being typed, if any. */
  editing: null as { scope: Scope; kind: Kind } | null,
  /** Timed sets: the countdown before the hold, the running hold (0 when stopped) and the step that owns them. */
  holdUntil: 0,
  readyUntil: 0,
  timerStep: -1,
  /** The one running rest of the workout. */
  rest: null as Rest | null,
  /** The next set's steppers are shown in the rest zone. */
  restChange: false,
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
  /** The alternative a failed swap was trying, for Try again. */
  swapTry: null as { id: string; name: string } | null,
  /** The exercise a slot had before a swap, by slot uid, until the first set is logged (undo). */
  swappedFrom: new Map<string, { id: string; name: string }>(),
  /** The cardio block being edited (with the distance it cannot go below), and the one asking "Skip cardio?". */
  cardioEdit: null as { id: string; kmFloor: number } | null,
  cardioAsk: '',
  /** Moved straight on inside a superset round (no rest): the card it moved to, shown until the first stepper tap or `until`. */
  straight: null as { step: number; until: number } | null,
  /** Where the pager goes by itself after a log, until a manual move cancels it. */
  intent: null as PagerIntent | null,
  /** Primary actions are ignored for a moment after the screen changes (a double tap must not log twice). */
  lockUntil: 0,
  confirmFinish: false,
  finished: null as FinishSummary | null,
  finishing: false,
  sendFailed: false,
  note: '',
  /** The summary could not be loaded from the server: what is shown comes from the stored plan. */
  summaryNote: '',
  /** A finished workout was reopened and its summary refetch failed (Try again). */
  summaryFailed: false,
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
const items = (): Item[] => {
  const plan = state.plan!;
  return [...plan.cardio.filter((c) => c.when === 'before').map((c): Item => ({ kind: 'cardio', c })), ...plan.exercises.map((ex): Item => ({ kind: 'ex', ex })), ...plan.cardio.filter((c) => c.when === 'after').map((c): Item => ({ kind: 'cardio', c }))];
};
const itemOpen = (it: Item) => stepOpen(it);

const plateText = (ex: PlannedExercise, weight: number) => plateTextFor(ex, weight, state.plan?.gym);

const lock = () => {
  state.lockUntil = Date.now() + 600;
};
const locked = () => Date.now() < state.lockUntil;

function startHold(i: number) {
  state.timerStep = i;
  state.holdUntil = Date.now() + state.drafts[i]!.seconds * 1000;
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
  if (failed.size > 0) announce(`${failed.size === 1 ? '1 change' : `${failed.size} changes`} not saved.`);
  render();
}

const call = async (name: string, args: Record<string, unknown>) => !(await app.callServerTool({ name, arguments: args })).isError;

// ---------- workout logic ----------
/** The tool result may be a replay (chat reopened): fetch the stored state first, falling back to the result. */
async function open(plan: WorkoutPlan) {
  if (state.plan?.workoutId === plan.workoutId) return; // the host may resend the result; keep local progress
  try {
    const res = await app.callServerTool({
      name: 'get_workout',
      arguments: { workoutId: plan.workoutId },
    });
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
  state.summaryNote = '';
  state.summaryFailed = false;
  state.sendFailed = false;
  state.note = '';
  state.swappedFrom.clear();
  state.rest = null;
  state.restChange = false;
  state.edit = null;
  state.editing = null;
  state.timerStep = -1;
  state.holdUntil = 0;
  state.readyUntil = 0;
  state.straight = null;
  state.intent = null;
  const card = openingCard(plan);
  const steps = stepsOf(plan);
  state.pos = cardPosition(card, steps.length);
  state.drafts = steps.map((step) => draftFor(step, plan.gym));
  resetSecondary();
  buildShell();
  render();
  if (ui) ui.track.scrollLeft = state.pos * ui.track.clientWidth;
  if (plan.finished) void finish();
}

/** The notes editor, swap list and guide belong to the card in view; they close when another card comes in. */
function resetSecondary() {
  state.noteEditing = '';
  state.noteSaved = '';
  state.guideOpen = false;
  state.swapOpen = false;
  state.swapAll = false;
  state.swapNote = '';
  state.swapFailed = false;
  state.swapTry = null;
  state.cardioEdit = null;
  state.cardioAsk = '';
  state.confirmFinish = false;
  state.edit = null;
  state.editing = null;
  state.restChange = false;
  motion?.stop();
  motionFor = '';
}

/** Carries out the pending automatic move, unless a manual move cancelled it. */
function followIntent() {
  const intent = state.intent;
  state.intent = null;
  if (!intent || intent.cancelled || !intent.target) return;
  const pos = intent.target.kind === 'finish' ? cardCount() - 1 : intent.target.index + 1;
  goTo(pos, { auto: true });
}

/** Exercises (as step indices) of the superset `ex` belongs to, in order; just `ex` when it is in none. */
function supersetSteps(ex: PlannedExercise): number[] {
  const all = items();
  if (!ex.supersetId) return [all.findIndex((x) => x.kind === 'ex' && x.ex === ex)];
  return all.flatMap((x, i) => (x.kind === 'ex' && x.ex.supersetId === ex.supersetId ? [i] : []));
}

const restRunning = () => !!state.rest && state.rest.untilMs > Date.now();

/** Queues the save of one set; the arguments are read when it runs, so the latest values go out. */
function enqueueSet(ex: PlannedExercise, set: PlannedSet, skip: boolean) {
  enqueue(`set:${set.id}:${ex.uid}`, () => {
    const args = {
      workoutId: state.plan!.workoutId,
      setId: set.id,
      reps: skip ? 0 : (set.reps ?? 0),
      skip,
      ...(ex.bodyweight || skip ? {} : { weightKg: set.weightKg }),
      ...(ex.timed && !skip ? { seconds: set.seconds ?? 0 } : {}),
    };
    return call('log_set', args);
  });
}

function writeValues(ex: PlannedExercise, set: PlannedSet, d: Draft) {
  set.reps = ex.timed ? 0 : d.reps;
  if (ex.timed) set.seconds = d.seconds;
  if (!ex.bodyweight) set.weightKg = d.weight;
}

function logSet(i: number, skip = false) {
  if (locked()) return;
  lock();
  const plan = state.plan!;
  const it = items()[i];
  if (!it || it.kind !== 'ex' || plan.finished) return;
  const ex = it.ex;
  const set = nextSet(ex);
  if (!set) return;
  const d = state.drafts[i]!;
  if (state.timerStep === i) {
    state.holdUntil = 0;
    state.readyUntil = 0;
  }
  state.swappedFrom.delete(ex.uid);
  state.straight = null;
  state.intent = null;
  state.confirmFinish = false;
  state.restChange = false;
  state.edit = null;
  state.editing = null;
  if (skip) set.skipped = true;
  else {
    set.done = true;
    delete set.skipped;
    writeValues(ex, set, d);
  }
  const handoff = ex.supersetId ? supersetHandoff(stepsOf(plan), i) : null;
  const partner = handoff?.kind === 'partner' ? handoff.index : -1;
  if (partner !== -1) state.rest = null;
  else if (!skip && nextSet(ex)) {
    // A warm-up needs only a short breather.
    const sec = set.warmup ? Math.min(ex.restSec, 60) : ex.restSec;
    if (sec > 0)
      state.rest = {
        stepIndex: i,
        untilMs: Date.now() + sec * 1000,
        totalMs: sec * 1000,
      };
    if (state.rest?.stepIndex === i && handoff?.kind === 'rest') state.intent = { target: { kind: 'step', index: handoff.returnTo }, cancelled: false };
  }
  state.drafts[i] = draftFor(stepsOf(plan)[i]!, plan.gym);
  announce(skip ? `Skipped ${setName(ex, set)}.` : `Logged ${setValues(ex, set)}.${restRunning() ? ` Rest ${mmss(state.rest!.untilMs - Date.now())}.` : ''}`);
  enqueueSet(ex, set, skip);
  void shareProgress();
  if (partner !== -1) {
    state.straight = { step: partner, until: Date.now() + 5000 };
    state.intent = { target: { kind: 'step', index: partner }, cancelled: false };
    followIntent();
    render();
    return;
  }
  if (!nextSet(ex)) {
    state.intent = { target: nextTarget(stepsOf(plan), i), cancelled: false };
    followIntent();
  }
  render();
}

/** Writes the values of an open editor into the plan and saves them again; no rest starts. */
function saveEdit() {
  const e = state.edit;
  const it = e && items()[e.stepIndex];
  if (!e || !it || it.kind !== 'ex' || state.plan?.finished) return;
  const set = it.ex.sets.find((x) => x.id === e.setId);
  if (!set) return;
  writeValues(it.ex, set, e.draft);
  state.edit = null;
  state.editing = null;
  enqueueSet(it.ex, set, false);
  void shareProgress();
  announce(`Saved changes to ${it.ex.name} ${setName(it.ex, set)}: ${setValues(it.ex, set)}.`);
  render();
}

/** Mark as not done, and Undo skip: the set is open again, the rest stops, and the set is the current one. */
function reopenSet(i: number, set: PlannedSet) {
  const it = items()[i];
  const plan = state.plan;
  if (!it || it.kind !== 'ex' || !plan || plan.finished) return;
  const ex = it.ex;
  const d = state.drafts[i]!;
  d.reps = set.reps || set.targetReps;
  d.weight = set.weightKg ?? d.weight;
  d.seconds = set.seconds ?? set.targetSec ?? d.seconds;
  set.done = false;
  delete set.skipped;
  state.rest = null;
  state.intent = null;
  state.restChange = false;
  state.edit = null;
  state.editing = null;
  enqueue(`set:${set.id}:${ex.uid}`, () =>
    call('log_set', {
      workoutId: plan.workoutId,
      setId: set.id,
      reps: 0,
      skip: false,
      reopen: true,
    }),
  );
  void shareProgress();
  announce(`${ex.name} ${setName(ex, set)} is open again.`);
  render();
}

function logCardio(i: number, skip = false) {
  if (locked()) return;
  lock();
  const it = items()[i];
  if (!it || it.kind !== 'cardio' || state.plan!.finished) return;
  const c = it.c;
  const d = state.drafts[i]!;
  const wasClosed = cardioClosed(c);
  const floor = state.cardioEdit?.id === c.id ? state.cardioEdit.kmFloor : 0;
  const km = Math.max(d.km, floor);
  state.cardioEdit = null;
  state.cardioAsk = '';
  if (skip) c.skipped = true;
  else {
    c.done = true;
    c.minutes = clamp(d.minutes, 1, 240);
    if (km > 0) c.distanceKm = km;
    delete c.skipped;
  }
  enqueue(`cardio:${c.id}`, () =>
    call('log_cardio_block', {
      workoutId: state.plan!.workoutId,
      blockId: c.id,
      ...(skip
        ? { skip: true }
        : {
            minutes: c.minutes ?? c.plannedMin,
            ...(c.distanceKm ? { distanceKm: c.distanceKm } : {}),
          }),
    }),
  );
  announce(skip ? `Skipped ${c.name}.` : `${wasClosed ? 'Saved' : 'Logged'} ${c.name}, ${c.minutes} min${c.distanceKm ? `, ${kg(c.distanceKm)} km` : ''}.`);
  void shareProgress();
  if (!wasClosed) {
    state.intent = { target: nextTarget(stepsOf(state.plan!), i), cancelled: false };
    followIntent();
  }
  render();
}

function adjustRest(delta: number) {
  const r = state.rest;
  if (!r) return;
  const now = Date.now();
  if (delta < 0) {
    const until = Math.max(now + 1000, r.untilMs + delta);
    r.totalMs = Math.max(until - now, r.totalMs - (r.untilMs - until));
    r.untilMs = until;
  } else {
    r.untilMs += delta;
    r.totalMs += delta;
  }
  render();
}

function skipRest() {
  if (locked()) return;
  lock();
  state.rest = null;
  state.restChange = false;
  followIntent();
  render();
}

function endRest() {
  state.rest = null;
  state.restChange = false;
  lock();
  announce('Rest over.');
  beep(2);
  try {
    navigator.vibrate?.(200);
  } catch {
    /* not allowed in this frame */
  }
  followIntent();
  render();
}

/** Saved when the person leaves the note field; the text is kept locally at once so a redraw never loses it. */
function saveNote(ex: PlannedExercise) {
  enqueue(`note:${ex.uid}`, () =>
    call('set_exercise_note', {
      workoutId: state.plan!.workoutId,
      exerciseId: ex.uid,
      notes: ex.notes ?? '',
    }),
  );
}

/** Lets Claude know where the workout stands, so "how am I doing?" works mid-workout. */
async function shareProgress() {
  try {
    await app.updateModelContext({
      content: [{ type: 'text', text: `Workout in progress. ${progressText()}` }],
    });
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
  state.rest = null;
  render();
  if (pending.size > 0) await flush(); // what is still unsaved gets one more try before the workout is closed
  let summary: FinishSummary | null = null;
  try {
    const res = await app.callServerTool({
      name: 'finish_workout',
      arguments: { workoutId: state.plan!.workoutId },
    });
    if (!res.isError) summary = res.structuredContent as unknown as FinishSummary;
  } catch {
    /* the summary below is built from the stored plan */
  }
  const reopened = !!state.plan!.finished;
  state.summaryFailed = !summary && reopened;
  state.summaryNote = summary ? '' : reopened ? 'Could not load the full summary. Try again' : 'Could not load the full summary.';
  state.finished = summary ?? summaryFromPlan();
  state.finishing = false;
  render();
  if (reopened) return; // reopened a finished workout: nothing new to tell Claude
  state.plan!.finished = true;
  void sendSummary(summary);
}

/** What the plan itself knows, when the server's summary is not available: time, volume and the sets that were logged. */
function summaryFromPlan(): FinishSummary {
  const plan = state.plan!;
  const lines = plan.exercises.flatMap((ex) => {
    const done = ex.sets.filter((x) => x.done && !x.warmup);
    return done.length ? [{ name: ex.name, done: done.map((x) => setValues(ex, x)).join(', ') }] : [];
  });
  const volumeKg = plan.exercises.reduce((n, ex) => (ex.bodyweight || ex.timed ? n : n + ex.sets.filter((x) => x.done && !x.warmup).reduce((m, x) => m + (x.reps ?? 0) * (x.weightKg ?? 0), 0)), 0);
  return { minutes: Math.round((Date.now() - plan.startedAt) / 60000), volumeKg: Math.round(volumeKg), exercises: lines };
}

async function sendSummary(summary: FinishSummary | null) {
  const prs = summary?.exercises.filter((e) => e.personalRecord).map((e) => `${e.name}: ${e.personalRecord}`) ?? [];
  const unsaved = failed.size > 0 ? ` ${failed.size} change${failed.size === 1 ? ' was' : 's were'} not saved to Fitwell.` : '';
  const text = summary
    ? `I finished my workout "${state.plan!.name}" in ${summary.minutes} min (volume ${summary.volumeKg} kg). ${summary.exercises.map((e) => `${e.name}: ${e.done}${e.notes ? ` (note: ${e.notes})` : ''}`).join('; ')}.${summary.cardio?.length ? ` Cardio: ${summary.cardio.map((c) => `${c.minutes} min ${c.activity}${c.distanceKm ? ` ${kg(c.distanceKm)} km` : ''}`).join('; ')}.` : ''}${prs.length ? ` Personal records: ${prs.join('; ')}.` : ''}${unsaved}`
    : `I finished my workout. ${progressText()}${unsaved}`;
  try {
    const res = await app.sendMessage({
      role: 'user',
      content: [{ type: 'text', text }],
    });
    state.sendFailed = !!res.isError;
  } catch {
    state.sendFailed = true;
  }
  state.note = state.sendFailed ? 'Could not send to Claude.' : 'Sent to Claude. It will reply below.';
  render();
}

// ---------- view ----------
interface StepperSpec {
  label: string;
  noun: string;
  text: (d: Draft) => string;
  change: (d: Draft, dir: 1 | -1) => void;
  set: (d: Draft, n: number) => void;
  raw: (d: Draft) => string;
  decimal: boolean;
}

const STEPPERS: Record<Kind, StepperSpec> = {
  reps: {
    label: 'Reps',
    noun: 'reps',
    text: (d) => String(d.reps),
    change: (d, dir) => void (d.reps = clamp(d.reps + dir, 0, 100)),
    set: (d, n) => void (d.reps = clamp(Math.round(n), 0, 100)),
    raw: (d) => String(d.reps),
    decimal: false,
  },
  weight: {
    label: 'Weight kg',
    noun: 'weight',
    text: (d) => kg(d.weight),
    change: (d, dir) => void (d.weight = clamp(r1(d.weight + dir * d.weightStep), 0, 500)),
    set: (d, n) => void (d.weight = clamp(r1(n), 0, 500)),
    raw: (d) => kg(d.weight),
    decimal: true,
  },
  seconds: {
    label: 'Seconds',
    noun: 'seconds',
    text: (d) => String(d.seconds),
    change: (d, dir) => void (d.seconds = clamp(d.seconds + dir * 5, 0, 3600)),
    set: (d, n) => void (d.seconds = clamp(Math.round(n), 0, 3600)),
    raw: (d) => String(d.seconds),
    decimal: false,
  },
  minutes: {
    label: 'Minutes',
    noun: 'minutes',
    text: (d) => String(d.minutes),
    change: (d, dir) => void (d.minutes = clamp(d.minutes + dir, 1, 240)),
    set: (d, n) => void (d.minutes = clamp(Math.round(n), 1, 240)),
    raw: (d) => String(d.minutes),
    decimal: false,
  },
  km: {
    label: 'Distance km',
    noun: 'distance',
    text: (d) => (d.km > 0 ? kg(d.km) : '–'),
    change: (d, dir) => void (d.km = clamp(r1(d.km + dir * 0.5), state.cardioEdit?.kmFloor ?? 0, 500)),
    set: (d, n) => void (d.km = clamp(r1(n), state.cardioEdit?.kmFloor ?? 0, 500)),
    raw: (d) => (d.km > 0 ? kg(d.km) : ''),
    decimal: true,
  },
};

/** The values a stepper changes: the card's draft, or the editor's copy for a logged set. */
const draftOf = (scope: Scope): Draft | undefined => (scope === 'edit' ? state.edit?.draft : state.drafts[state.pos - 1]);

/**
 * A tap changes the value once, when the finger lifts; holding repeats it. Nothing changes when the finger goes down, so a swipe or a
 * scroll that starts on a button never changes a value, and a repeat that lost its "finger up" (a host page that took over the
 * gesture) stops by itself: on a move, on the page being hidden, or after a few seconds. The output text is updated in place while
 * held, so the button under the finger stays.
 */
function pressable(btn: HTMLButtonElement, kind: Kind, dir: 1 | -1, out: HTMLElement, scope: Scope) {
  const MAX_HOLD_MS = 4000;
  const MOVE_PX = 10;
  let delay: number | undefined;
  let repeat: number | undefined;
  let repeating = false;
  let changed = false;
  let startX = 0;
  let startY = 0;
  const step = () => {
    const d = draftOf(scope);
    if (!d) return;
    // A typed value that was not committed yet (this press blurred the field) counts first, so the step starts from it.
    if (state.editing) {
      const field = root.querySelector<HTMLInputElement>('.value-field');
      const target = draftOf(state.editing.scope);
      if (field && target) {
        const n = Number.parseFloat(field.value.replace(',', '.'));
        if (Number.isFinite(n) && n >= 0) STEPPERS[state.editing.kind].set(target, n);
      }
      state.editing = null;
    }
    STEPPERS[kind].change(d, dir);
    changed = true;
    if (state.straight) {
      state.straight = null;
      root.querySelector('[data-straight]')?.remove();
    }
    out.textContent = STEPPERS[kind].text(d);
    out.parentElement?.setAttribute('aria-label', `${STEPPERS[kind].label}: ${STEPPERS[kind].text(d)}. Tap to type a value.`);
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
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_PX) {
      release();
    }
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
function commitValue(scope: Scope, kind: Kind, raw: string) {
  const n = Number.parseFloat(raw.replace(',', '.'));
  const d = draftOf(scope);
  if (d && Number.isFinite(n) && n >= 0) STEPPERS[kind].set(d, n);
  state.editing = null;
  render();
}

function stepper(kind: Kind, d: Draft, scope: Scope) {
  const spec = STEPPERS[kind];
  const key = `${scope}-${kind}`;
  const out = h('output', { 'data-key': `${key}-value` }, spec.text(d));
  const by = kind === 'weight' ? ` by ${kg(d.weightStep)} kg` : '';
  const dec = h(
    'button',
    {
      type: 'button',
      'aria-label': `Decrease ${spec.noun}${by}`,
      'data-key': `${key}-dec`,
    },
    '−',
  );
  const inc = h(
    'button',
    {
      type: 'button',
      'aria-label': `Increase ${spec.noun}${by}`,
      'data-key': `${key}-inc`,
    },
    '+',
  );
  pressable(dec, kind, -1, out, scope);
  pressable(inc, kind, 1, out, scope);
  let value: HTMLElement;
  if (state.editing?.scope === scope && state.editing.kind === kind) {
    value = h('input', {
      type: 'text',
      inputMode: spec.decimal ? 'decimal' : 'numeric',
      value: spec.raw(d),
      'aria-label': spec.label,
      className: 'value-field',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          state.editing = null;
          render();
        }
      },
      onblur: (e: FocusEvent) => {
        if (state.editing?.scope === scope && state.editing.kind === kind) commitValue(scope, kind, (e.target as HTMLInputElement).value);
      },
    });
  } else {
    value = h(
      'button',
      {
        type: 'button',
        className: 'value',
        'aria-label': `${spec.label}: ${spec.text(d)}. Tap to type a value.`,
        'data-key': `${key}-edit`,
        onclick: () => {
          state.editing = { scope, kind };
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

const EQUIPMENT: Record<string, string> = {
  'body only': 'bodyweight',
  other: 'other',
};
const equipmentName = (e: string) => EQUIPMENT[e.toLowerCase()] ?? e;

/** Scrolls the card in view just far enough to show a panel that opened under the action row; the rows above keep their place in the card. */
function reveal(selector: string) {
  const card = ui?.cards[state.pos];
  const el = card?.querySelector<HTMLElement>(selector);
  if (!card || !el) return;
  const c = card.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const tall = r.height + 8 > c.height;
  const delta = tall ? r.top - c.top : r.bottom - c.bottom + 8;
  if (tall ? Math.abs(delta) > 1 : delta > 8) card.scrollTo({ top: card.scrollTop + delta, behavior: scrollBehavior() });
}

/** The note for one exercise: shown as a line, edited in a panel under the action row. The textarea exists only while editing. */
function notesPanel(ex: PlannedExercise) {
  if (state.noteEditing !== ex.uid) return null;
  let before = ex.notes ?? '';
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
      if ((ex.notes ?? '') === before) return;
      before = ex.notes ?? '';
      saveNote(ex);
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
    const res = await app.callServerTool({
      name: 'get_exercise_guide',
      arguments: { id },
    });
    const g = (res.structuredContent as { guide?: ExerciseGuide } | undefined)?.guide;
    if (res.isError || !g) throw new Error('no guide');
    state.guides.set(id, g);
    state.guideFailed = false;
  } catch {
    state.guideFailed = true;
  }
  render();
  reveal('.guide');
}

/** The animation element for an open guide, created on first use and started once per exercise. */
function animation(g: ExerciseGuide): HTMLElement | null {
  if (!state.guideOpen) return null;
  if (motion === undefined) motion = createMotionPlayer();
  if (!motion) return null;
  if (motionFor !== g.ref) {
    motion.show(g.motion, g.name, {
      primary: g.primary,
      secondary: g.secondary,
    });
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
        ? h(
            'p',
            { className: 'muted small' },
            'Could not load the guide. ',
            h(
              'button',
              {
                type: 'button',
                className: 'link',
                onclick: () => ((state.guideFailed = false), void loadGuide(ex.id), render()),
              },
              'Try again',
            ),
          )
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
  if (state.guideOpen) reveal('.guide');
}

async function loadSwaps(ex: PlannedExercise) {
  try {
    const res = await app.callServerTool({
      name: 'get_substitutes',
      arguments: { workoutId: state.plan!.workoutId, exerciseId: ex.uid },
    });
    const list = (res.structuredContent as { substitutes?: { id: string; name: string; equipment: string }[] } | undefined)?.substitutes;
    if (res.isError || !list) throw new Error('no data');
    state.swaps.set(ex.uid, list);
    state.swapNote = list.length ? '' : 'No similar exercise fits your equipment.';
    state.swapFailed = false;
  } catch {
    state.swapNote = 'Could not load alternatives.';
    state.swapFailed = true;
    state.swapTry = null;
  }
  render();
  reveal('.swapbox');
}

async function swap(ex: PlannedExercise, to: { id: string; name: string }) {
  state.swapNote = `Swapping to ${to.name}…`;
  state.swapFailed = false;
  state.swapTry = to;
  render();
  try {
    const res = await app.callServerTool({
      name: 'swap_exercise',
      arguments: {
        workoutId: state.plan!.workoutId,
        exerciseId: ex.uid,
        newId: to.id,
      },
    });
    const plan = (res.structuredContent as { workout?: WorkoutPlan } | undefined)?.workout;
    const fresh = plan?.exercises.find((x) => x.uid === ex.uid);
    if (res.isError || !plan || !fresh) throw new Error('refused');
    const local = state.plan!;
    const at = local.exercises.findIndex((x) => x.uid === ex.uid);
    // Only this slot comes from the returned plan: sets logged elsewhere may not have reached the server yet.
    local.exercises[at] = fresh;
    const undoing = state.swappedFrom.get(ex.uid)?.id === to.id;
    if (undoing) state.swappedFrom.delete(ex.uid);
    else state.swappedFrom.set(ex.uid, { id: ex.id, name: ex.name });
    state.swaps.delete(ex.uid);
    state.swapOpen = false;
    state.swapAll = false;
    state.swapNote = '';
    state.swapFailed = false;
    state.swapTry = null;
    motion?.stop();
    motionFor = '';
    state.guideOpen = false;
    const step = items().findIndex((it) => it.kind === 'ex' && it.ex.uid === ex.uid);
    state.drafts[step] = draftFor(stepsOf(local)[step]!, local.gym);
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
    shown ? h('div', { className: 'swaps' }, ...shown.map((x) => h('button', { type: 'button', onclick: () => void swap(ex, x) }, h('span', {}, x.name), h('span', { className: 'muted small' }, equipmentName(x.equipment))))) : !state.swapNote && h('p', { className: 'muted small' }, 'Loading…'),
    list &&
      !state.swapAll &&
      list.length > 4 &&
      h(
        'button',
        {
          type: 'button',
          className: 'link',
          onclick: () => ((state.swapAll = true), render(), reveal('.swapbox')),
        },
        `Show ${list.length - 4} more`,
      ),
    state.swapNote &&
      h(
        'p',
        { className: 'muted small' },
        state.swapNote,
        ' ',
        state.swapFailed &&
          h(
            'button',
            {
              type: 'button',
              className: 'link',
              onclick: () => (state.swapTry ? void swap(ex, state.swapTry) : void loadSwaps(ex)),
            },
            'Try again',
          ),
      ),
  );
}

function setDots(step: Item): { text: string; aria: string; node: Node } {
  if (step.kind === 'cardio') {
    const glyph = step.c.done ? '●' : step.c.skipped ? '–' : '○';
    return {
      text: glyph,
      aria: step.c.done ? 'done' : step.c.skipped ? 'skipped' : 'not done',
      node: h(
        'span',
        {
          className: step.c.done || step.c.skipped ? 'dots done' : 'dots',
          'aria-hidden': 'true',
        },
        glyph,
      ),
    };
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
    node: h(
      'span',
      {
        className: itemOpen(step) ? 'dots' : 'dots done',
        'aria-hidden': 'true',
      },
      warm.length > 0 && h('span', { className: 'wdots' }, warm.map(glyph).join('')),
      working.map(glyph).join(''),
    ),
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
/** The card an automatic move is heading for, so settling there is not mistaken for a manual move. */
let autoPos = -1;
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
  const save = h('p', {
    className: 'status-line',
    role: 'status',
    hidden: true,
  });
  const strip = h('button', {
    type: 'button',
    className: 'strip',
    'data-strip': '',
    'data-key': 'strip',
    onclick: () => goTo(0, { focus: true }),
  });
  const counter = h('span', { className: 'muted small counter' });
  const prev = h(
    'button',
    {
      type: 'button',
      className: 'nav',
      'aria-label': 'Previous card',
      'data-key': 'prev',
      onclick: () => goTo(state.pos - 1),
    },
    '‹',
  );
  const next = h(
    'button',
    {
      type: 'button',
      className: 'nav',
      'aria-label': 'Next card',
      'data-key': 'next',
      onclick: () => goTo(state.pos + 1),
    },
    '›',
  );
  const chip = h('div', { className: 'chip', hidden: true });
  const header = h('header', { className: 'head' }, h('div', { className: 'titlebar' }, h('strong', {}, plan.name), clock), save, h('div', { className: 'navrow' }, prev, strip, counter, next), chip);
  const cards = Array.from({ length: cardCount() }, () =>
    h('section', {
      className: 'pcard',
      role: 'group',
      'aria-roledescription': 'card',
    }),
  );
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

window.addEventListener('pointerup', () => (pointerDown = false), {
  capture: true,
});
window.addEventListener('pointercancel', () => (pointerDown = false), {
  capture: true,
});
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
  if (pos !== state.pos) {
    if (pos !== autoPos && state.intent) state.intent.cancelled = true;
    enterCard(pos);
    queueCardAnnouncement(pos);
  }
  autoPos = -1;
  if (pendingFocus === pos) ui.cards[pos]?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  pendingFocus = -1;
}

let cardAnnounceTimer: number | undefined;
let cardAnnounced = -1;

/** Announces the card in view 300 ms after the scroll settled (after any log message), once per settled card. */
function queueCardAnnouncement(pos: number) {
  window.clearTimeout(cardAnnounceTimer);
  cardAnnounceTimer = window.setTimeout(() => {
    if (pos !== state.pos || pos === cardAnnounced) return;
    cardAnnounced = pos;
    const all = items();
    const n = cardCount();
    const step = all[pos - 1];
    if (pos === 0) {
      const ov = buildOverview(state.plan!);
      announce(`Overview, card 1 of ${n}, ${ov.workingDone} of ${ov.workingTotal} sets done`);
    } else if (!step) announce(`End of workout, card ${pos + 1} of ${n}`);
    else announce(`${stepName(step)}, card ${pos + 1} of ${n}, ${setDots(step).aria}`);
  }, 300);
}

function enterCard(pos: number) {
  if (pos !== state.pos) resetSecondary();
  if (state.straight && state.straight.step + 1 !== pos) state.straight = null;
  state.pos = pos;
  render();
}

/** Moves the pager; never while a finger is down on the track (it would fight the swipe). */
function goTo(pos: number, opts: { focus?: boolean; auto?: boolean } = {}) {
  if (!ui || pointerDown) return;
  const target = clamp(pos, 0, ui.cards.length - 1);
  if (opts.auto) autoPos = target;
  else {
    autoPos = -1;
    if (state.intent) state.intent.cancelled = true;
  }
  pendingFocus = opts.focus ? target : -1;
  if (trackPos() === target) {
    settle();
    return;
  }
  ui.cards[target]!.scrollIntoView({
    inline: 'center',
    block: 'nearest',
    behavior: scrollBehavior(),
  });
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
    return h('span', {
      className: `seg ${kind}${pos === state.pos ? ' current' : ''}`,
      'data-seg': kind,
      'aria-hidden': 'true',
    });
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
    ui.save.replaceChildren(
      ...clean(
        failed.size === 0
          ? []
          : [
              `${failed.size === 1 ? '1 change' : `${failed.size} changes`} not saved. `,
              h(
                'button',
                {
                  type: 'button',
                  className: 'link',
                  'data-key': 'retry',
                  onclick: () => void flush(),
                },
                'Try again',
              ),
            ],
      ),
    );
  }
  ui.strip.setAttribute('aria-label', `Card ${state.pos + 1} of ${count}. Go to the overview.`);
  ui.strip.replaceChildren(...stripSegments());
  ui.counter.textContent = `${state.pos + 1} / ${count}`;
  ui.prev.disabled = state.pos === 0;
  ui.next.disabled = state.pos === count - 1;
  const show = restRunning() && state.pos !== 0 && state.pos !== state.rest!.stepIndex + 1;
  ui.chip.hidden = !show;
  if (!show) {
    ui.chip.replaceChildren();
    return;
  }
  const it = items()[state.rest!.stepIndex]!;
  const set = it.kind === 'ex' ? nextSet(it.ex) : undefined;
  ui.chip.replaceChildren(
    h('span', {}, 'Rest ', h('span', { 'data-clock': 'rest' }, mmss(state.rest!.untilMs - Date.now())), ` · ${stepName(it)}${it.kind === 'ex' && set ? ` · ${setNumber(it.ex, set)} next` : ''}`),
    h(
      'button',
      {
        type: 'button',
        'data-key': 'chip-go',
        onclick: () => goTo(state.rest!.stepIndex + 1, { focus: true }),
      },
      'Go',
    ),
  );
}

function overviewBody(): Child[] {
  const plan = state.plan!;
  const ov = buildOverview(plan);
  const rest = restRunning() ? items()[state.rest!.stepIndex] : undefined;
  const restSet = rest?.kind === 'ex' ? nextSet(rest.ex) : undefined;
  return [
    h(
      'div',
      { className: 'card overview' },
      h('p', { className: 'muted small' }, 'Today'),
      h('h1', { tabIndex: -1 }, plan.name),
      h('p', {}, `${ov.workingDone} of ${ov.workingTotal} sets · ${ov.exerciseCount} ${ov.exerciseCount === 1 ? 'exercise' : 'exercises'}`),
      h('progress', {
        className: 'ovprogress',
        max: Math.max(1, ov.workingTotal),
        value: ov.workingDone,
        'aria-label': 'Sets done',
      }),
      rest &&
        h(
          'div',
          { className: 'restrow' },
          h('span', {}, 'Resting ', h('span', { 'data-clock': 'rest' }, mmss(state.rest!.untilMs - Date.now())), rest.kind === 'ex' && restSet ? ` · Next: ${rest.ex.name}, ${setName(rest.ex, restSet)}` : ''),
          h(
            'button',
            {
              type: 'button',
              'aria-label': rest.kind === 'ex' ? `Go to ${rest.ex.name}` : 'Go',
              'data-key': 'rest-go',
              onclick: () => goTo(state.rest!.stepIndex + 1, { focus: true }),
            },
            'Go',
          ),
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
              {
                type: 'button',
                className: 'ovrow',
                'aria-label': label,
                ...(row.superset ? { 'aria-describedby': `ss-${row.index}` } : {}),
                'data-key': `row-${row.index}`,
                onclick: () => goTo(row.index + 1, { focus: true }),
              },
              h('span', { className: 'rowtext' }, h('span', { className: 'name' }, row.name), row.todayTarget && h('span', { className: 'muted small' }, `Today: ${row.todayTarget}`), row.lastTime && h('span', { className: 'muted small' }, row.lastTime)),
              h(
                'span',
                {
                  className: row.open ? 'dots' : 'dots done',
                  'aria-hidden': 'true',
                },
                row.dots,
              ),
              row.superset && h('span', { className: 'sr-only', id: `ss-${row.index}` }, 'Superset'),
            ),
          );
        }),
      ),
      ov.action &&
        !plan.finished &&
        h(
          'button',
          {
            type: 'button',
            className: 'primary',
            'data-key': 'overview-go',
            onclick: () => goTo(ov.action!.stepIndex + 1, { focus: true }),
          },
          ov.action.label,
        ),
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
      bests.length > 0 ? h('div', { className: 'bests' }, h('h2', {}, 'New best'), ...bests.map((e) => h('p', {}, h('strong', {}, e.name), ` · ${(e.personalRecord ?? '').replace(/^new best\s*/i, '')}`))) : !state.summaryNote && h('p', { className: 'muted' }, 'No new bests this time.'),
      ...f.exercises.map((e) => h('p', {}, h('strong', {}, e.name), ` ${e.done}`, e.notes && h('span', { className: 'muted small block' }, `Note: ${e.notes}`))),
      skipped.length > 0 && h('p', {}, h('strong', {}, 'Skipped'), ` ${skipped.join(', ')}`),
      notDone.length > 0 && h('p', {}, h('strong', {}, 'Not done'), ` ${notDone.join(', ')}`),
      ...(f.cardio ?? []).map((c) => h('p', {}, h('strong', {}, c.activity), ` ${c.minutes} min${c.distanceKm ? ` · ${kg(c.distanceKm)} km` : ''}${c.kcal ? ` · about ${c.kcal} kcal` : ''}`)),
      state.summaryNote &&
        h(
          'p',
          { className: 'muted small', role: 'status' },
          state.summaryNote,
          ' ',
          state.summaryFailed && h('button', { type: 'button', className: 'link', 'data-key': 'retry-summary', onclick: () => void finish() }, 'Try again'),
        ),
      state.note &&
        h(
          'p',
          { className: 'muted small' },
          state.note,
          ' ',
          state.sendFailed &&
            h(
              'button',
              {
                type: 'button',
                className: 'link',
                onclick: () => ((state.sendFailed = false), (state.note = ''), void sendSummary(state.finished), render()),
              },
              'Send again',
            ),
        ),
      state.sendFailed && h('p', { className: 'muted small' }, failed.size === 0 ? 'Your workout is saved.' : `${failed.size} change${failed.size === 1 ? ' was' : 's were'} not saved to Fitwell.`),
    ),
  ];
}

function finishBody(): Child[] {
  const plan = state.plan!;
  if (state.finished) return summaryBody();
  if (state.finishing) return [h('div', { className: 'card' }, h('h1', { tabIndex: -1 }, 'End of workout'), h('p', { className: 'muted' }, 'Saving…'))];
  const steps = stepsOf(plan);
  const fs = finishState(steps);
  const counts = workingCounts(steps);
  const first = firstOpenStep(steps);
  return [
    h(
      'div',
      { className: 'card finish' },
      h('h1', { tabIndex: -1 }, 'End of workout'),
      h('p', { className: 'muted' }, h('span', { 'data-clock': 'elapsed' }, mmss(Date.now() - plan.startedAt)), ` elapsed · ${counts.closed} of ${counts.total} working sets`),
      fs.notDone.length > 0 && h('p', {}, h('strong', {}, 'Not done'), ` ${fs.notDone.join(', ')}`),
      fs.skipped.length > 0 && h('p', {}, h('strong', {}, 'Skipped'), ` ${fs.skipped.join(', ')}`),
      fs.canFinishDirectly
        ? h(
            'button',
            {
              type: 'button',
              className: 'primary',
              'data-key': 'finish',
              onclick: () => void finish(),
            },
            'Finish and send to Claude',
          )
        : state.confirmFinish
          ? h(
              'div',
              {
                className: 'confirm',
                role: 'group',
                'aria-label': 'End the workout?',
              },
              h('p', {}, h('strong', {}, 'End the workout now?'), ` ${fs.workingOpen} ${fs.workingOpen === 1 ? 'set is' : 'sets are'} not done.`),
              h(
                'div',
                { className: 'actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    'data-key': 'keep',
                    onclick: () => {
                      if (locked()) return;
                      lock();
                      state.confirmFinish = false;
                      render();
                      if (first !== -1) goTo(first + 1, { focus: true });
                    },
                  },
                  'Keep training',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'primary',
                    onclick: () => void finish(),
                  },
                  'End and send to Claude',
                ),
              ),
            )
          : h(
              'button',
              {
                type: 'button',
                className: 'finish-early',
                'data-key': 'finish-early',
                onclick: () => {
                  if (locked()) return;
                  lock();
                  state.confirmFinish = true;
                  render();
                },
              },
              'Finish early',
            ),
    ),
  ];
}

const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

/** Reps (or seconds) and the load: a bodyweight exercise shows "Bodyweight" instead of the weight stepper. */
function setSteppers(ex: PlannedExercise, d: Draft, scope: Scope): Node {
  return h('div', { className: 'steppers' }, ex.timed ? stepper('seconds', d, scope) : stepper('reps', d, scope), ex.bodyweight ? h('div', { className: 'stepper' }, h('span', { className: 'muted small' }, 'Load'), h('p', { className: 'bodyweight' }, 'Bodyweight')) : stepper('weight', d, scope));
}

function openEditor(i: number, ex: PlannedExercise, set: PlannedSet) {
  if (state.edit?.setId === set.id && state.edit.uid === ex.uid) state.edit = null;
  else {
    const base = state.drafts[i]!;
    state.edit = {
      stepIndex: i,
      uid: ex.uid,
      setId: set.id,
      draft: {
        ...base,
        reps: set.reps || set.targetReps,
        weight: set.weightKg ?? base.weight,
        seconds: set.seconds ?? set.targetSec ?? base.seconds,
      },
    };
  }
  state.editing = null;
  render();
}

function editorRow(i: number, ex: PlannedExercise, set: PlannedSet): Node {
  const draft = state.edit!.draft;
  return h(
    'li',
    {
      className: 'editor',
      role: 'group',
      'aria-label': `Edit ${setName(ex, set)}`,
    },
    setSteppers(ex, draft, 'edit'),
    h(
      'div',
      { className: 'actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'primary',
          'data-key': 'edit-save',
          onclick: saveEdit,
        },
        'Save changes',
      ),
      h(
        'button',
        {
          type: 'button',
          'data-key': 'edit-cancel',
          onclick: () => ((state.edit = null), (state.editing = null), render()),
        },
        'Cancel',
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'link',
        'data-key': 'edit-reopen',
        onclick: () => reopenSet(i, set),
      },
      'Mark as not done',
    ),
  );
}

function setRow(i: number, ex: PlannedExercise, set: PlannedSet, readOnly: boolean): Node[] {
  const name = cap(setName(ex, set));
  if (set.skipped && !set.done) {
    return [
      h(
        'li',
        { className: 'srow skipped', 'data-set-id': set.id },
        h('span', { className: 'mark', 'aria-hidden': 'true' }, '–'),
        h('span', { className: 'sname' }, `${name} · skipped`),
        !readOnly &&
          h(
            'button',
            {
              type: 'button',
              className: 'link',
              'data-key': `undo-${set.id}`,
              onclick: () => reopenSet(i, set),
            },
            'Undo skip',
          ),
      ),
    ];
  }
  if (set.done) {
    const values = setValues(ex, set);
    const editing = state.edit?.setId === set.id && state.edit.uid === ex.uid;
    const body = [h('span', { className: 'mark', 'aria-hidden': 'true' }, '✓'), h('span', { className: 'sname' }, name), h('span', { className: 'svalues' }, values)];
    if (readOnly) return [h('li', { className: 'srow logged', 'data-set-id': set.id }, ...body)];
    return [
      h(
        'li',
        { className: 'srow logged', 'data-set-id': set.id },
        h(
          'button',
          {
            type: 'button',
            className: 'rowbtn',
            'aria-expanded': String(editing),
            'aria-label': `${name}, ${values}, done. Tap to edit.`,
            'data-key': `row-${set.id}`,
            onclick: () => openEditor(i, ex, set),
          },
          ...body,
        ),
      ),
      ...(editing ? [editorRow(i, ex, set)] : []),
    ];
  }
  const target = setValues(ex, {
    reps: set.targetReps,
    weightKg: set.weightKg,
    seconds: set.targetSec,
  });
  return [h('li', { className: 'srow open muted', 'data-set-id': set.id }, h('span', { className: 'mark', 'aria-hidden': 'true' }, '○'), h('span', { className: 'sname' }, name), h('span', { className: 'svalues' }, target))];
}

function holdControls(i: number, d: Draft): Node {
  const mine = state.timerStep === i;
  const holding = mine && state.holdUntil > Date.now();
  const ready = mine && state.readyUntil > Date.now();
  return h(
    'div',
    { className: 'hold' },
    ready && h('p', { className: 'time', role: 'timer', 'data-clock': 'ready' }, `Get ready ${Math.max(1, Math.ceil((state.readyUntil - Date.now()) / 1000))}`),
    holding && h('p', { className: 'time', role: 'timer', 'data-clock': 'hold' }, mmss(state.holdUntil - Date.now())),
    ready
      ? h(
          'div',
          { className: 'actions' },
          h(
            'button',
            {
              type: 'button',
              onclick: () => {
                if (locked()) return;
                lock();
                state.readyUntil = 0;
                startHold(i);
                render();
              },
            },
            'Start now',
          ),
          h(
            'button',
            {
              type: 'button',
              onclick: () => {
                if (locked()) return;
                lock();
                state.readyUntil = 0;
                render();
              },
            },
            'Cancel',
          ),
        )
      : h(
          'button',
          {
            type: 'button',
            onclick: () => {
              if (locked()) return;
              lock();
              if (holding) {
                d.seconds = clamp(d.seconds - Math.ceil((state.holdUntil - Date.now()) / 1000), 0, 3600); // stopped early: log what was held
                state.holdUntil = 0;
              } else {
                state.timerStep = i;
                state.readyUntil = Date.now() + 5000;
              }
              render();
            },
          },
          holding ? 'Stop the timer' : `Start a ${d.seconds} s timer (5 s to get ready)`,
        ),
  );
}

/** The current-set zone: fixed height, in place of the first open row. */
function setZone(i: number, ex: PlannedExercise, set: PlannedSet, d: Draft): Node {
  const warm = ex.sets.filter((x) => x.warmup);
  const working = ex.sets.filter((x) => !x.warmup);
  const which = set.warmup ? `Warm-up ${warm.indexOf(set) + 1} of ${warm.length}` : `Set ${working.indexOf(set) + 1} of ${working.length}`;
  const target = ex.timed ? `target ${set.targetSec ?? 0} s` : `target ${set.targetReps} reps`;
  const plates = plateText(ex, d.weight);
  return h(
    'div',
    { className: set.warmup ? 'zone warmup' : 'zone', 'data-zone': '' },
    h('p', { className: 'setline' }, set.warmup && h('span', { className: 'pill' }, 'Warm-up'), set.warmup && ' ', `${which} · ${target}`),
    setSteppers(ex, d, 'zone'),
    plates && h('p', { className: 'muted small plates' }, plates),
    ex.timed && holdControls(i, d),
    h(
      'button',
      {
        type: 'button',
        className: 'primary',
        'aria-label': 'Log set',
        'data-key': 'log',
        onclick: () => logSet(i),
      },
      `Log set · ${setValues(ex, { reps: d.reps, seconds: d.seconds, weightKg: d.weight })}`,
    ),
    h(
      'div',
      { className: 'more' },
      h(
        'button',
        {
          type: 'button',
          className: 'link',
          'data-key': 'skip',
          onclick: () => logSet(i, true),
        },
        'Skip set',
      ),
    ),
  );
}

/** The rest in the zone: label, time, progress and the next set; Change shows its steppers without stopping the timer. */
function restZone(i: number, ex: PlannedExercise, set: PlannedSet, d: Draft): Node {
  const rest = state.rest!;
  return h(
    'div',
    { className: 'zone rest', 'data-zone': '' },
    h('p', { className: 'muted' }, 'Rest'),
    h('p', { className: 'time', role: 'timer', 'data-clock': 'rest' }, mmss(rest.untilMs - Date.now())),
    h('div', { className: 'bar', 'aria-hidden': 'true' }, h('span', { 'data-restbar': '' })),
    h(
      'div',
      { className: 'next' },
      h('p', {}, h('strong', {}, 'Next:'), ` ${setName(ex, set)} · ${setValues(ex, { reps: d.reps, seconds: d.seconds, weightKg: d.weight })}`),
      h(
        'button',
        {
          type: 'button',
          className: 'link',
          'aria-expanded': String(state.restChange),
          'data-key': 'rest-change',
          onclick: () => ((state.restChange = !state.restChange), render()),
        },
        state.restChange ? 'Done' : 'Change',
      ),
    ),
    state.restChange && setSteppers(ex, d, 'zone'),
    state.restChange &&
      h(
        'button',
        {
          type: 'button',
          className: 'primary',
          'aria-label': 'Log set',
          'data-key': 'log',
          onclick: () => logSet(i),
        },
        `Log set · ${setValues(ex, { reps: d.reps, seconds: d.seconds, weightKg: d.weight })}`,
      ),
  );
}

/** Pinned to the bottom of the card while its rest runs: progress, time, -15 s, +15 s, Skip rest. */
function restBar(): Node {
  return h(
    'div',
    { className: 'restbar', role: 'group', 'aria-label': 'Rest controls' },
    h('div', { className: 'bar', 'aria-hidden': 'true' }, h('span', { 'data-restbar': '' })),
    h(
      'div',
      { className: 'restbtns' },
      h('span', { className: 'restclock', 'data-clock': 'rest' }, mmss(state.rest!.untilMs - Date.now())),
      h(
        'button',
        {
          type: 'button',
          'data-key': 'rest-less',
          onclick: () => adjustRest(-15_000),
        },
        '−15 s',
      ),
      h(
        'button',
        {
          type: 'button',
          'data-key': 'rest-more',
          onclick: () => adjustRest(15_000),
        },
        '+15 s',
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'primary',
          'data-key': 'rest-skip',
          onclick: skipRest,
        },
        'Skip rest',
      ),
    ),
  );
}

/** Nothing left to do on this exercise: where it stands and the way to the next step. */
function doneZone(i: number, ex: PlannedExercise): Node {
  const steps = stepsOf(state.plan!);
  const working = ex.sets.filter((x) => !x.warmup);
  const target = nextTarget(steps, i);
  const label = target.kind === 'step' ? `Go to ${stepName(steps[target.index]!)}` : 'Go to the end of the workout';
  const pos = target.kind === 'step' ? target.index + 1 : steps.length + 1;
  return h(
    'div',
    { className: 'zone done-zone', 'data-zone': '' },
    h('p', { className: 'setline' }, `${ex.name} done · ${working.filter(closed).length} of ${working.length} sets`),
    h(
      'button',
      {
        type: 'button',
        className: 'primary',
        'data-key': 'go-next',
        onclick: () => {
          if (locked()) return;
          lock();
          goTo(pos, { focus: true });
        },
      },
      label,
    ),
  );
}

function exerciseBody(i: number, ex: PlannedExercise): Child[] {
  const plan = state.plan!;
  const d = state.drafts[i]!;
  const readOnly = !!plan.finished;
  /** The panels (note editor, swap list, guide) belong to the card in view; the other cards are drawn without them. */
  const current = i === state.pos - 1;
  const first = nextSet(ex);
  const started = ex.sets.some(closed);
  const canSwap = !started && !readOnly;
  const swappedFrom = state.swappedFrom.get(ex.uid);
  const resting = !!first && !readOnly && restRunning() && state.rest!.stepIndex === i;
  const zone = readOnly ? null : first ? (resting ? restZone(i, ex, first, d) : setZone(i, ex, first, d)) : doneZone(i, ex);
  const rows = [...ex.sets.filter((x) => x.warmup), ...ex.sets.filter((x) => !x.warmup)].flatMap((set) => (set === first && zone ? [h('li', { className: 'zonerow' }, zone)] : setRow(i, ex, set, readOnly)));
  return [
    h(
      'div',
      { className: 'card exercise' },
      h('p', { className: 'muted small' }, `Exercise ${plan.exercises.indexOf(ex) + 1} of ${plan.exercises.length} · ${equipmentName(ex.equipment)}`),
      h('h1', { tabIndex: -1 }, ex.name),
      ex.supersetId && h('p', { className: 'small ss' }, supersetLabel(ex), state.straight?.step === i && h('span', { 'data-straight': '' }, ' · Straight on, no rest')),
      ex.lastTime && h('p', { className: 'muted small' }, formatLastTime(ex.lastTime)),
      h('ol', { className: 'sets', 'aria-label': 'Sets' }, ...rows, !first && zone && h('li', { className: 'zonerow' }, zone)),
      !started && !readOnly && !ex.bodyweight && !ex.timed && d.weightStep !== WEIGHT_STEP && h('p', { className: 'muted small' }, `Weight moves in ${kg(d.weightStep)} kg steps. Tap the number to type another value.`),
      ex.lastNotes && !ex.notes && h('p', { className: 'muted small' }, `Last note: ${ex.lastNotes}`),
      ex.note && h('p', { className: 'muted small' }, ex.note),
      (ex.notes || state.noteSaved === ex.uid) && h('p', { className: 'small' }, ex.notes ? `Note: ${ex.notes}` : 'Note removed', state.noteSaved === ex.uid && h('span', { className: 'muted' }, ' · saved')),
      swappedFrom &&
        !started &&
        h(
          'p',
          { className: 'small' },
          `Swapped from ${swappedFrom.name} · `,
          h(
            'button',
            {
              type: 'button',
              className: 'link',
              onclick: () => void swap(ex, swappedFrom),
            },
            'Undo',
          ),
        ),
      !readOnly &&
        h(
          'div',
          { className: 'more' },
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
                root.querySelector<HTMLTextAreaElement>('.notes textarea')?.focus({ preventScroll: true });
                reveal('.notes');
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
                'aria-expanded': String(current && state.swapOpen),
                'data-key': 'swap',
                onclick: () => {
                  state.swapOpen = !state.swapOpen;
                  if (state.swapOpen && !state.swaps.has(ex.uid)) void loadSwaps(ex);
                  render();
                  if (state.swapOpen) reveal('.swapbox');
                },
              },
              'Swap',
            ),
          h(
            'button',
            {
              type: 'button',
              className: 'link',
              'aria-expanded': String(current && state.guideOpen),
              'data-key': 'guide',
              onclick: () => toggleGuide(ex),
            },
            'How to do it',
          ),
        ),
      current && !readOnly && notesPanel(ex),
      current && canSwap && swapPanel(ex),
      current && guidePanel(ex),
      resting && restBar(),
    ),
  ];
}

/** One step's card: every card is drawn in full, so a swipe never shows an empty card on its way in. */
function stepCardBody(i: number): Child[] {
  const all = items();
  const it = all[i]!;
  if (it.kind === 'ex') return exerciseBody(i, it.ex);
  return cardioBody(i, it.c);
}

function cardioBody(i: number, c: PlannedCardio): Child[] {
  const d = state.drafts[i]!;
  const readOnly = !!state.plan!.finished;
  const isClosed = cardioClosed(c);
  const editing = state.cardioEdit?.id === c.id;
  const heading = [h('p', { className: 'muted small' }, c.when === 'before' ? 'Warm-up' : 'Finisher'), h('h1', { tabIndex: -1 }, c.name)];
  const planned = h('p', {}, `Planned ${c.plannedMin} min${c.plannedKm ? ` · ${kg(c.plannedKm)} km` : ''}`);
  if (readOnly || (isClosed && !editing && c.done)) {
    return [
      h(
        'div',
        { className: 'card' },
        ...heading,
        c.done ? h('p', {}, `${c.minutes ?? c.plannedMin} min${c.distanceKm ? ` · ${kg(c.distanceKm)} km` : ''}`) : h('p', { className: 'muted' }, 'Skipped'),
        c.done &&
          !readOnly &&
          h(
            'button',
            {
              type: 'button',
              className: 'primary',
              'data-key': 'cardio-edit',
              onclick: () => {
                if (locked()) return;
                lock();
                state.drafts[i] = draftFor({ kind: 'cardio', c }, state.plan!.gym);
                state.cardioEdit = { id: c.id, kmFloor: c.distanceKm ?? 0 };
                render();
              },
            },
            'Edit',
          ),
      ),
    ];
  }
  const asking = state.cardioAsk === c.id;
  return [
    h(
      'div',
      { className: 'card' },
      ...heading,
      isClosed && !editing && h('p', { className: 'muted' }, 'Skipped'),
      planned,
      h('div', { className: 'steppers' }, stepper('minutes', d, 'zone'), stepper('km', d, 'zone')),
      h('button', { type: 'button', className: 'primary', 'data-key': 'log', onclick: () => logCardio(i) }, editing ? 'Save' : 'Log cardio'),
      editing &&
        h(
          'div',
          { className: 'more' },
          h(
            'button',
            {
              type: 'button',
              className: 'link',
              'data-key': 'cancel-edit',
              onclick: () => {
                state.cardioEdit = null;
                render();
              },
            },
            'Cancel',
          ),
        ),
      !isClosed &&
        (asking
          ? h(
              'div',
              { className: 'more', role: 'group', 'aria-label': 'Skip cardio?' },
              h('span', {}, 'Skip cardio?'),
              h('button', { type: 'button', className: 'link', 'data-key': 'skip-yes', onclick: () => logCardio(i, true) }, 'Skip'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'link',
                  'data-key': 'skip-keep',
                  onclick: () => {
                    state.cardioAsk = '';
                    render();
                  },
                },
                'Keep',
              ),
            )
          : h(
              'div',
              { className: 'more' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'link',
                  'data-key': 'skip',
                  onclick: () => {
                    state.cardioAsk = c.id;
                    render();
                  },
                },
                'Skip this',
              ),
            )),
    ),
  ];
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
        el.textContent = mmss(state.rest ? state.rest.untilMs - now : 0);
        break;
    }
  }
  const rest = state.rest;
  if (rest) for (const bar of document.querySelectorAll<HTMLElement>('[data-restbar]')) bar.style.width = `${clamp(((rest.untilMs - now) / rest.totalMs) * 100, 0, 100)}%`;
}

// Once a second: update the clocks, and notice a rest or a hold that ran out. Times are absolute, so a throttled tab catches up.
function tick() {
  if (!state.plan || state.finished) return;
  const now = Date.now();
  if (failed.size > 0 && now - lastFlushAt > 15_000) void flush();
  if (state.straight && state.straight.until <= now) {
    state.straight = null;
    render();
  }
  if (state.rest && state.rest.untilMs <= now) return endRest();
  if (state.readyUntil && state.readyUntil <= now) {
    state.readyUntil = 0;
    startHold(state.timerStep);
    announce('Go.');
    beep(1);
    render();
    return;
  }
  if (state.holdUntil && state.holdUntil <= now) {
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
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

await app.connect();
applyHost(app.getHostContext());
render();
