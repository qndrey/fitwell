import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { ExerciseGuide } from '../../src/exercises/guide';
import { EFFORT_LABELS, type PlannedCardio, type PlannedExercise, type PlannedSet, type WorkoutPlan } from '../../src/workout/plan';
import { recordCue, backTarget, compareToLast, loggedTotals, openGroups, sendPreview, buildOverview, nextSet, cardPosition, cardioClosed, cardioText, drainQueue, draftFor, finishState, firstOpenStep, supersetRound, formatLastTime, formatSets, formatSetSummary, isFresh, lastTimeForSet, nextPlatesText, kg, nextTarget, openingCard, stepName, stepOpen, stepsOf, supersetHandoff, workingCounts, WEIGHT_STEP, plateText as plateTextFor, setName, setValues, type Draft, type PagerIntent, type Rest, type Step } from './cards';
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
    effort?: string;
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
  /** When the running hold began, for the seconds held so far. */
  holdStart: 0,
  readyUntil: 0,
  timerStep: -1,
  /** The step whose hold ran to zero and has not been logged yet ("Time" shows in its zone). */
  timerDone: -1,
  /** The working set just logged that offers the "How hard?" tap (one at a time; ignoring it logs nothing). */
  effortOffer: null as { uid: string; setId: string; cue: string | null } | null,
  /** The one running rest of the workout. */
  rest: null as Rest | null,
  /** The next set's steppers are shown in the rest zone. */
  restChange: false,
  /** A rest that just ran out: its card says "Rest over" with "Start set n" for 3 s, then shows the set. */
  restOver: null as { stepIndex: number; until: number } | null,
  /** The exercise card that shows the "Weight moves in ..." hint: the first one the person opens; the others carry it as a description of the weight value. */
  hintUid: '',
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

/** "1 set", "2 sets" when only sets failed to save, else "1 change", "3 changes": what the header and the announcement say is not saved. */
function unsavedText(): string {
  const sets = [...failed].every((k) => k.startsWith('set:'));
  const word = sets ? 'set' : 'change';
  return `${failed.size} ${word}${failed.size === 1 ? '' : 's'}`;
}
/** True while the save of this set (logged, skipped or edited) is failing. */
const setUnsaved = (ex: PlannedExercise, set: PlannedSet) => failed.has(`set:${set.id}:${ex.uid}`);
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
  state.holdStart = Date.now();
  state.holdUntil = state.holdStart + state.drafts[i]!.seconds * 1000;
  state.timerDone = -1;
}

/** Whole seconds held so far in the running hold (never more than the target). */
const heldSeconds = () => clamp(Math.floor((Date.now() - state.holdStart) / 1000), 0, state.drafts[state.timerStep]?.seconds ?? 3600);
const timerRunning = (i: number) => state.timerStep === i && (state.holdUntil > Date.now() || state.readyUntil > Date.now());

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
  if (failed.size > 0) announce(`${unsavedText()} not saved.`);
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
  state.effortOffer = null;
  state.rest = null;
  state.restOver = null;
  state.restChange = false;
  state.edit = null;
  state.editing = null;
  state.timerStep = -1;
  state.timerDone = -1;
  state.holdUntil = 0;
  state.readyUntil = 0;
  state.straight = null;
  state.intent = null;
  const card = openingCard(plan);
  const steps = stepsOf(plan);
  state.pos = cardPosition(card, steps.length);
  resumeRest(plan, steps);
  state.drafts = steps.map((step) => draftFor(step, plan.gym));
  resetSecondary();
  buildShell();
  render();
  if (ui) ui.track.scrollLeft = state.pos * ui.track.clientWidth;
  if (plan.finished) {
    // A finished workout opens on its summary at once, from the stored plan; the server's summary fills it in.
    state.finished = summaryFromPlan();
    state.summaryNote = 'Loading the summary…';
    render();
    void finish();
  }
}

/**
 * A rest the server still had running when the plan was read: the time left is the server's (relative to now, so this clock's offset
 * does not matter), the card is the one that held it, and a rest that ended under 3 s ago shows "Rest over" for what is left of the 3 s.
 */
function resumeRest(plan: WorkoutPlan, steps: Step[]) {
  const r = plan.rest;
  if (!r || plan.finished) return;
  const i = steps.findIndex((s) => s.kind === 'ex' && s.ex.uid === r.exerciseUid);
  const step = steps[i];
  if (!step || step.kind !== 'ex' || !nextSet(step.ex)) return;
  const now = Date.now();
  if (r.remainingMs > 0) state.rest = { stepIndex: i, untilMs: now + r.remainingMs, totalMs: Math.max(r.totalMs, r.remainingMs) };
  else state.restOver = { stepIndex: i, until: now + 3000 + r.remainingMs };
  const handoff = step.ex.supersetId ? supersetHandoff(steps, i) : null;
  // Inside a superset the rest follows the round and the pager stays on the exercise that is next; otherwise it opens on the card that holds the rest.
  if (handoff?.kind === 'rest') state.intent = { target: { kind: 'step', index: handoff.returnTo }, cancelled: false };
  else state.pos = i + 1;
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

/** Whole seconds of the running rest of this step for the server (0 when there is none: the new set clears the stored one). */
const restSecFor = (i: number) => (state.rest?.stepIndex === i && restRunning() ? Math.ceil((state.rest.untilMs - Date.now()) / 1000) : 0);

/** Tells the server how the running rest stands (changed, skipped, over); the server stamps its own end time from the seconds left. */
function syncRest() {
  enqueue('rest', () => {
    const r = state.rest;
    const left = r && restRunning() ? Math.ceil((r.untilMs - Date.now()) / 1000) : 0;
    return call('set_rest', { workoutId: state.plan!.workoutId, restSec: left, ...(r && left > 0 ? { totalSec: Math.ceil(r.totalMs / 1000) } : {}) });
  });
}

/** Queues the save of one set; the arguments are read when it runs, so the latest values go out. `rest`: the set was just logged, so the rest it starts goes with it (and a rest that was running and is not any more is cleared). */
function enqueueSet(ex: PlannedExercise, set: PlannedSet, skip: boolean, rest?: { step: number; hadRest: boolean }) {
  enqueue(`set:${set.id}:${ex.uid}`, () => {
    const args = {
      workoutId: state.plan!.workoutId,
      setId: set.id,
      reps: skip ? 0 : (set.reps ?? 0),
      skip,
      ...(ex.bodyweight || skip ? {} : { weightKg: set.weightKg }),
      ...(ex.timed && !skip ? { seconds: set.seconds ?? 0 } : {}),
      ...(set.effort && !skip && !set.warmup ? { effort: set.effort } : {}),
      ...(rest && !skip && (rest.hadRest || restSecFor(rest.step) > 0) ? { restSec: restSecFor(rest.step) } : {}),
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
  const hadRest = restRunning();
  if (state.timerStep === i) {
    state.holdUntil = 0;
    state.readyUntil = 0;
  }
  if (state.timerDone === i) state.timerDone = -1;
  state.swappedFrom.delete(ex.uid);
  state.restOver = null;
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
  state.effortOffer = !skip && !set.warmup ? { uid: ex.uid, setId: set.id, cue: recordCue(ex, set) } : null;
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
  announce(skip ? `Skipped ${setName(ex, set)}.` : `Logged ${setValues(ex, set)}.${state.effortOffer?.cue ? ` New best: ${state.effortOffer.cue}.` : ''}${restRunning() ? ` Rest ${mmss(state.rest!.untilMs - Date.now())}.` : ''}`);
  enqueueSet(ex, set, skip, { step: i, hadRest });
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

/** The "How hard?" tap: saved at once with the set, nothing else changes (no rest, no move). */
function setEffort(ex: PlannedExercise, set: PlannedSet, effort: number) {
  if (state.plan?.finished || !set.done || set.warmup) return;
  set.effort = effort;
  enqueueSet(ex, set, false);
  announce(`${EFFORT_LABELS[effort - 1]} noted for ${setName(ex, set)}.`);
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
  delete set.effort;
  if (state.effortOffer?.setId === set.id) state.effortOffer = null;
  state.rest = null;
  state.restOver = null;
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
  // The server's estimate is linear in minutes: carry its rate over to the new minutes until the stored figure comes back.
  const kcalPerMin = c.estKcal ? c.estKcal / c.plannedMin : c.kcal && c.minutes ? c.kcal / c.minutes : 0;
  if (skip) c.skipped = true;
  else {
    c.done = true;
    c.minutes = clamp(d.minutes, 1, 240);
    if (kcalPerMin) c.kcal = Math.round(kcalPerMin * c.minutes);
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
  syncRest();
  render();
}

function skipRest() {
  if (locked()) return;
  lock();
  state.rest = null;
  state.restChange = false;
  syncRest();
  followIntent();
  render();
}

function endRest() {
  const ended = state.rest!;
  state.rest = null;
  state.restChange = false;
  // Counted from the moment the rest ran out, so a rest that ended while the page was in the background shows the set at once.
  const until = ended.untilMs + 3000;
  state.restOver = until > Date.now() ? { stepIndex: ended.stepIndex, until } : null;
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
  const reopened = !!state.plan!.finished;
  state.confirmFinish = false;
  state.rest = null;
  if (reopened) {
    // Reopened or retried: the summary stays on screen while it loads (no "Saving…").
    state.summaryNote = 'Loading the summary…';
    state.summaryFailed = false;
  } else state.finishing = true;
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
  state.summaryFailed = !summary && reopened;
  state.summaryNote = summary ? '' : 'Could not load the full summary.'; // the Try again button follows it, so the text does not say it
  state.finished = summary ?? summaryFromPlan();
  state.finishing = false;
  render();
  if (reopened) return; // reopened a finished workout: nothing new to tell Claude
  state.plan!.finished = true;
  void sendSummary(summary);
}

/** What the plan itself knows, when the server's summary is not available (or not here yet): time, volume, the sets that were logged and the cardio. */
function summaryFromPlan(): FinishSummary {
  const plan = state.plan!;
  const lines = plan.exercises.flatMap((ex) => {
    const done = ex.sets.filter((x) => x.done && !x.warmup);
    return done.length ? [{ name: ex.name, done: formatSets(ex, done) }] : [];
  });
  const cardio = plan.cardio.filter((c) => c.done).map((c) => ({ activity: c.name, when: c.when, minutes: c.minutes ?? c.plannedMin, ...(c.distanceKm ? { distanceKm: c.distanceKm } : {}) }));
  const minutes = Math.round((Date.now() - plan.startedAt) / 60000);
  return { minutes, volumeKg: loggedTotals(stepsOf(plan)).volumeKg, exercises: lines, ...(cardio.length ? { cardio } : {}) };
}

async function sendSummary(summary: FinishSummary | null) {
  const prs = summary?.exercises.filter((e) => e.personalRecord).map((e) => `${e.name}: ${e.personalRecord}`) ?? [];
  const unsaved = failed.size > 0 ? ` ${failed.size} change${failed.size === 1 ? ' was' : 's were'} not saved to Fitwell.` : '';
  const text = summary
    ? `I finished my workout "${state.plan!.name}" in ${summary.minutes} min (volume ${summary.volumeKg} kg). ${summary.exercises.map((e) => `${e.name}: ${e.done}${e.effort ? ` (effort: ${e.effort})` : ''}${e.notes ? ` (note: ${e.notes})` : ''}`).join('; ')}.${summary.cardio?.length ? ` Cardio: ${summary.cardio.map((c) => `${c.minutes} min ${c.activity}${c.distanceKm ? ` ${kg(c.distanceKm)} km` : ''}`).join('; ')}.` : ''}${prs.length ? ` Personal records: ${prs.join('; ')}.` : ''}${unsaved}`
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
      const cue = root.querySelector('[data-straight]'); // the line keeps its place, so nothing moves
      cue?.removeAttribute('data-straight');
      if (cue) cue.textContent = '';
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

/** `description` (the weight stepper only): read out with the value, in place of a visible hint. */
function stepper(kind: Kind, d: Draft, scope: Scope, description?: string) {
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
        ...(description ? { 'aria-description': description } : {}),
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

/** "Superset with Triceps Pushdown · round 1 of 2": where an exercise sits in its superset (one round count for the group; warm-ups read "Warm-up 1 of 4"). */
function supersetLabel(ex: PlannedExercise): string | null {
  if (!ex.supersetId) return null;
  const others = supersetSteps(ex)
    .map((i) => items()[i]!)
    .flatMap((x) => (x.kind === 'ex' && x.ex !== ex ? [x.ex.name] : []));
  const at = supersetRound(stepsOf(state.plan!), items().findIndex((x) => x.kind === 'ex' && x.ex === ex));
  return `Superset with ${others.join(' and ')}${at ? ` · ${at.text}` : ''}`;
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
  // The dock is pinned over the bottom of the card: what can be seen ends where the dock begins.
  const bottom = card.querySelector('.dock')?.getBoundingClientRect().top ?? c.bottom;
  // The exercise name is pinned over the top of the card: what can be seen begins where it ends.
  const top = card.querySelector('.exercise > h1')?.getBoundingClientRect().bottom ?? c.top;
  const tall = r.height + 8 > bottom - top;
  const delta = tall ? r.top - top : r.bottom - bottom + 8;
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
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  clock: HTMLElement;
  save: HTMLElement;
  strip: HTMLButtonElement;
  counter: HTMLElement;
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
let saveShown = '';
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
  const clock = h('span', { className: 'clock' });
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
  const counter = h('span', { className: 'counter' });
  const chip = h('div', { className: 'chip', hidden: true });
  const prev = h('button', { type: 'button', className: 'navbtn', 'data-key': 'prev', onclick: () => stepBy(-1) }, '‹');
  const next = h('button', { type: 'button', className: 'navbtn', 'data-key': 'next', onclick: () => stepBy(1) }, '›');
  const header = h('header', { className: 'head' }, h('div', { className: 'titlebar' }, prev, h('strong', { title: plan.name }, plan.name), counter, clock, next), strip, save, chip);
  const cards = Array.from({ length: cardCount() }, () =>
    h('section', {
      className: 'pcard',
      role: 'group',
      'aria-roledescription': 'card',
      // The pinned exercise name gets a hairline under it once the card has scrolled.
      onscroll: (e: Event) => (e.currentTarget as HTMLElement).toggleAttribute('data-scrolled', (e.currentTarget as HTMLElement).scrollTop > 0),
    }),
  );
  const track = h(
    'div',
    {
      className: 'track',
      'aria-roledescription': 'carousel',
      'aria-label': 'Workout cards',
      'aria-keyshortcuts': 'ArrowLeft ArrowRight Home End',
      onscroll: () => {
        swipeEffect();
        if (hasScrollEnd) return;
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(settle, 120);
      },
      onscrollend: () => settle(),
      onpointerdown: () => {
        scrollTarget = -1;
        pointerDown = true;
      },
    },
    // The slide is what snaps; the card inside it is what tilts while dragged, so the snap position never moves with the effect.
    ...cards.map((card) => h('div', { className: 'slide' }, card)),
  );
  ui = { header, prev, next, clock, save, strip, counter, chip, track, cards };
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
/**
 * While the track is being dragged, each card tilts, shrinks and fades by how far it is from the middle, pivoting from below
 * like a card being thrown: the one leaving turns away, the one coming in straightens up. A card at rest has no transform at all.
 */
let fxFrame = 0;
/** The card the strip and the counter show while a scroll is under way: the one nearest the middle, or the one a jump is heading to. */
let shownPos = -1;
/** The card a button, key or tap is scrolling to; set until the scroll comes to rest. */
let scrollTarget = -1;
const stripAt = () => (shownPos >= 0 ? shownPos : state.pos);

/** Moves the highlight in the strip and the counter now, without waiting for the scroll to settle. */
function previewPos(pos: number) {
  if (!ui || pos === stripAt()) return;
  shownPos = pos;
  const count = ui.cards.length;
  ui.strip.replaceChildren(...stripSegments());
  ui.strip.setAttribute('aria-label', `Card ${pos + 1} of ${count}. Show the overview.`);
  ui.counter.textContent = `${pos + 1} of ${count}`;
  updateNav(pos);
}

/** ‹ and ›: they name the card they go to; at either end they stay in place, `aria-disabled`, and do nothing. */
function updateNav(pos: number) {
  if (!ui) return;
  const last = ui.cards.length - 1;
  for (const [btn, to, word] of [[ui.prev, pos - 1, 'Previous'], [ui.next, pos + 1, 'Next']] as const) {
    const end = to < 0 || to > last;
    btn.setAttribute('aria-label', end ? `${word} card` : `${word} card: ${cardName(to)}`);
    btn.setAttribute('aria-disabled', String(end));
  }
}

/** The ‹ and › buttons: one card on from where the pager is heading (so two quick taps go two cards), focus on the new card's heading. */
function stepBy(dir: -1 | 1) {
  if (!ui) return;
  const here = scrollTarget >= 0 ? scrollTarget : stripAt();
  const to = here + dir;
  if (to < 0 || to > ui.cards.length - 1) return;
  goTo(to, { focus: true });
}
function swipeEffect() {
  if (scrollTarget < 0) previewPos(trackPos());
  if (fxFrame || !ui) return;
  fxFrame = window.requestAnimationFrame(() => {
    fxFrame = 0;
    if (!ui) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const w = ui.track.clientWidth;
    ui.cards.forEach((card, i) => {
      const d = w > 0 && !reduced ? clamp((i * w - ui!.track.scrollLeft) / w, -1, 1) : 0;
      const a = Math.abs(d);
      if (a < 0.002 || a > 0.998) {
        card.style.transform = '';
        card.style.opacity = '';
        return;
      }
      card.style.transformOrigin = '50% 140%';
      card.style.transform = `rotate(${(d * 7).toFixed(2)}deg) scale(${(1 - 0.08 * a).toFixed(3)})`;
      card.style.opacity = String((1 - 0.55 * a).toFixed(3));
    });
  });
}

function settle() {
  if (!ui) return;
  const pos = trackPos();
  const previewed = shownPos;
  shownPos = -1;
  scrollTarget = -1;
  // A hard fling can come to rest between two snap points: bring the card to the middle.
  const w = ui.track.clientWidth;
  if (w > 0 && Math.abs(ui.track.scrollLeft - pos * w) > 2 && !pointerDown) ui.track.scrollTo({ left: pos * w, behavior: scrollBehavior() });
  if (pos !== state.pos) {
    if (pos !== autoPos && state.intent) state.intent.cancelled = true;
    enterCard(pos);
    queueCardAnnouncement(pos);
  }
  if (previewed >= 0 && previewed !== pos) updateHeader();
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
  scrollTarget = target;
  previewPos(target);
  ui.cards[target]!.parentElement!.scrollIntoView({
    inline: 'center',
    block: 'nearest',
    behavior: scrollBehavior(),
  });
}

document.addEventListener('keydown', (e) => {
  if (!ui || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  // From the card the pager is heading to, so two quick key presses go two cards.
  const here = scrollTarget >= 0 ? scrollTarget : stripAt();
  const to = e.key === 'ArrowLeft' ? here - 1 : e.key === 'ArrowRight' ? here + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ui.cards.length - 1 : null;
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
    bar.style.setProperty('--pos', String((stripAt() / (count - 1)) * 100));
    return [bar];
  }
  const overview = isFresh(steps) ? 'empty' : 'full';
  const end = plan.finished || state.finished ? 'full' : steps.every((s) => !stepOpen(s)) ? 'half' : 'empty';
  return Array.from({ length: count }, (_, pos) => {
    const kind = pos === 0 ? overview : pos === count - 1 ? end : stepState(steps[pos - 1]!);
    return h('span', {
      className: `seg ${kind}${pos === stripAt() ? ' current' : ''}`,
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
  if (failed.size === 0 ? saveShown !== '' : saveShown !== unsavedText()) {
    saveShown = failed.size === 0 ? '' : unsavedText();
    ui.save.hidden = failed.size === 0;
    ui.save.replaceChildren(
      ...clean(
        failed.size === 0
          ? []
          : [
              `${unsavedText()} not saved. `,
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
  ui.strip.setAttribute('aria-label', `Card ${stripAt() + 1} of ${count}. Show the overview.`);
  ui.strip.replaceChildren(...stripSegments());
  ui.counter.textContent = `${stripAt() + 1} of ${count}`;
  updateNav(stripAt());
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
      { className: 'body overview' },
      h(
        'div',
        { className: 'ovhead' },
        h('h1', { tabIndex: -1 }, 'Today', h('span', { className: 'sr-only' }, ` · ${plan.name}`)),
        h('p', { className: 'muted' }, `${ov.workingDone} of ${ov.workingTotal} sets · ${ov.exerciseCount} ${ov.exerciseCount === 1 ? 'exercise' : 'exercises'}`),
      ),
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
              h('span', { className: 'rowtext' }, h('span', { className: 'name' }, row.name), row.superset && h('span', { className: 'sub', id: `ss-${row.index}` }, 'Superset'), (row.todayTarget || row.lastTime) && h('span', { className: 'sub' }, [row.todayTarget ? `Today: ${row.todayTarget}` : '', row.lastTime ?? ''].filter(Boolean).join(' · '))),
              h(
                'span',
                {
                  className: row.open ? 'dots' : 'dots done',
                  'aria-hidden': 'true',
                },
                row.dots,
              ),
            ),
          );
        }),
      ),
      h('p', { className: 'muted small' }, 'Ask Claude to change the plan.', h('span', { className: 'hint' }, ' Arrow keys move between cards.')),
    ),
    ov.action &&
      !plan.finished &&
      dock(
        '',
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
      ),
  ];
}

function summaryBody(): Child[] {
  const plan = state.plan!;
  const steps = stepsOf(plan);
  const f = state.finished;
  if (!f) return [];
  const doneWorking = loggedTotals(steps).sets;
  const bests = f.exercises.filter((e) => e.personalRecord);
  const compared = new Set<PlannedExercise>();
  // The comparison with last time is read from the plan's exercise of the same name (the same exercise twice takes them in turn).
  const comparison = (name: string) => {
    const ex = plan.exercises.find((x) => x.name === name && !compared.has(x));
    if (ex) compared.add(ex);
    return ex ? compareToLast(ex) : null;
  };
  const loading = state.summaryNote === 'Loading the summary…';
  return [
    h(
      'div',
      { className: 'body summary' },
      h('h1', { tabIndex: -1 }, 'Workout finished'),
      h('p', { className: 'muted' }, `${loading ? '' : `${f.minutes} min · `}${doneWorking} working ${doneWorking === 1 ? 'set' : 'sets'}${f.volumeKg ? ` · ${f.volumeKg.toLocaleString()} kg lifted` : ''}`),
      // New bests get their own block with a text heading, above the exercise lines.
      bests.length > 0
        ? h('div', { className: 'bests' }, h('h2', {}, 'New best'), ...bests.map((e) => h('p', {}, h('strong', {}, e.name), ` · ${(e.personalRecord ?? '').replace(/^new best\s*/i, '')}`)))
        : loading
          ? null
          : h('p', { className: 'muted' }, state.summaryNote ? 'New bests could not be checked.' : 'No new bests this time.'),
      ...f.exercises.map((e) => {
        const versus = comparison(e.name);
        return h('p', {}, h('strong', {}, e.name), ` ${formatSetSummary(e.done)}`, versus && h('span', { className: 'muted small block' }, versus), e.notes && h('span', { className: 'muted small block' }, `Note: ${e.notes}`));
      }),
      groupedLines('Skipped', openGroups(steps, 'skipped', false)),
      groupedLines('Not done', openGroups(steps, 'notDone', false)),
      ...(f.cardio ?? []).map((c) => h('p', {}, h('strong', {}, c.activity), ` ${c.minutes} min${c.distanceKm ? ` · ${kg(c.distanceKm)} km` : ''}${c.kcal ? ` · ~${c.kcal} kcal` : ''}`)),
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

/** A heading and one line per exercise ("Pullups: 2 sets"); nothing when there are none. */
const groupedLines = (title: string, lines: string[]) => lines.length > 0 && h('p', {}, h('strong', {}, title), ...lines.map((l) => h('span', { className: 'block' }, l)));

function finishBody(): Child[] {
  const plan = state.plan!;
  if (state.finished) return summaryBody();
  if (state.finishing) return [h('div', { className: 'body' }, h('h1', { tabIndex: -1 }, 'End of workout'), h('p', { className: 'muted' }, 'Saving…'))];
  const steps = stepsOf(plan);
  const fs = finishState(steps);
  const counts = workingCounts(steps);
  const first = firstOpenStep(steps);
  const keepTraining = () => {
    if (locked()) return;
    lock();
    state.confirmFinish = false;
    render();
    if (first !== -1) goTo(first + 1, { focus: true });
  };
  return [
    h(
      'div',
      { className: 'body finish' },
      h('h1', { tabIndex: -1 }, 'End of workout'),
      h('p', { className: 'muted' }, h('span', { 'data-clock': 'elapsed' }, mmss(Date.now() - plan.startedAt)), ` elapsed · ${counts.closed} of ${counts.total} working sets`),
      groupedLines('Not done', openGroups(steps, 'notDone', true)),
      groupedLines('Skipped', openGroups(steps, 'skipped', true)),
      h('p', { className: 'muted' }, sendPreview(steps)),
      !fs.canFinishDirectly && state.confirmFinish && h('p', {}, h('strong', {}, 'End the workout now?'), ` ${fs.workingOpen} ${fs.workingOpen === 1 ? 'set is' : 'sets are'} not done.`),
    ),
    fs.canFinishDirectly
      ? dock('', h('button', { type: 'button', className: 'primary', 'data-key': 'finish', onclick: () => void finish() }, 'Finish and send to Claude'))
      : state.confirmFinish
        ? // The confirm pair is stacked at full width: a thumb cannot hit the wrong one by a small miss.
          h(
            'div',
            { className: 'dock stack', role: 'group', 'aria-label': 'End the workout?' },
            h('button', { type: 'button', className: 'primary', 'data-key': 'end', onclick: () => void finish() }, 'End and send to Claude'),
            h('button', { type: 'button', 'data-key': 'keep', onclick: keepTraining }, 'Keep training'),
          )
        : dock(
            '',
            h(
              'button',
              {
                type: 'button',
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

/** The dock: pinned to the bottom of its card, the one fixed place for the card's main action. `split` is a secondary button (1/3) beside the primary (2/3). */
const dock = (kind: '' | 'split' | 'stack', ...children: Child[]) => h('div', { className: `dock ${kind}`.trim() }, ...children);

const stepsHint = (d: Draft) => `Weight moves in ${kg(d.weightStep)} kg steps. Tap the number to type another value.`;

const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

/** Reps (or seconds) and the load: a bodyweight exercise shows "Bodyweight" instead of the weight stepper. */
function setSteppers(ex: PlannedExercise, d: Draft, scope: Scope): Node {
  return h('div', { className: 'steppers' }, ex.timed ? stepper('seconds', d, scope) : stepper('reps', d, scope), ex.bodyweight ? h('div', { className: 'stepper' }, h('span', { className: 'muted small' }, 'Load'), h('p', { className: 'bodyweight' }, 'Bodyweight')) : stepper('weight', d, scope, ex.uid !== state.hintUid && d.weightStep !== WEIGHT_STEP ? stepsHint(d) : undefined));
}

/** "How hard? Easy · Solid · Hard · Max": four text buttons for a logged working set; the chosen one is pressed. */
function effortGroup(ex: PlannedExercise, set: PlannedSet): Node {
  return h(
    'div',
    { className: 'effort', role: 'group', 'aria-label': `How hard was ${setName(ex, set)}?` },
    h('span', { className: 'muted small' }, 'How hard?'),
    ...EFFORT_LABELS.map((label, k) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(set.effort === k + 1),
          'data-key': `effort-${k + 1}`,
          onclick: () => setEffort(ex, set, k + 1),
        },
        label,
      ),
    ),
  );
}

/** The offer under the set list: the set just logged, until the next set is logged or this one is being edited. */
function effortRow(ex: PlannedExercise): Node | null {
  const offer = state.effortOffer;
  const set = offer?.uid === ex.uid ? ex.sets.find((x) => x.id === offer.setId) : undefined;
  if (!offer || !set || !set.done || set.warmup) return null;
  const editing = state.edit?.uid === ex.uid && state.edit.setId === set.id;
  // The record cue is plain text (announced once, with the log); it stays with the set until the next one is logged.
  return h('div', { className: 'afterset' }, offer.cue && h('p', { className: 'cue', 'data-cue': '' }, `New best: ${offer.cue}`), !editing && effortGroup(ex, set));
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
    !set.warmup && effortGroup(ex, set),
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
        h('span', { className: 'sname' }, `${name} · skipped`, setUnsaved(ex, set) && h('span', { className: 'unsaved' }, ' · not saved')),
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
    const unsaved = setUnsaved(ex, set);
    // A set that did not reach the server says so in words, next to its ✓: it must not look like a saved row.
    const body = [h('span', { className: 'mark', 'aria-hidden': 'true' }, '✓'), h('span', { className: 'sname' }, name, unsaved && h('span', { className: 'unsaved' }, ' · not saved')), h('span', { className: 'svalues' }, values)];
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
            'aria-label': `${name}, ${values}, done${unsaved ? ', not saved' : ''}. Tap to edit.`,
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

/**
 * The timer line of a timed set's zone: one slot of fixed height for every phase (the Start button, "Get ready 3", the time left,
 * "Time"), so the zone never changes height. The buttons of a running timer are in the dock (timerDock).
 */
function holdSlot(i: number, d: Draft): Node {
  const mine = state.timerStep === i;
  const holding = mine && state.holdUntil > Date.now();
  const ready = mine && state.readyUntil > Date.now();
  return h(
    'div',
    { className: 'holdslot' },
    ready && h('p', { className: 'time', role: 'timer', 'data-clock': 'ready' }, `Get ready ${Math.max(1, Math.ceil((state.readyUntil - Date.now()) / 1000))}`),
    holding && h('p', { className: 'time', role: 'timer', 'data-clock': 'hold' }, mmss(state.holdUntil - Date.now())),
    !ready && !holding && state.timerDone === i && h('p', { className: 'time' }, 'Time'),
    !ready &&
      !holding &&
      state.timerDone !== i &&
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            if (locked()) return;
            lock();
            state.timerStep = i;
            state.timerDone = -1;
            state.readyUntil = Date.now() + 5000;
            render();
          },
        },
        `Start a ${d.seconds} s timer (5 s to get ready)`,
      ),
  );
}

/** The dock while a timer runs: Cancel (logs nothing) beside Start now (get-ready) or Stop · log m:ss (the seconds held so far, live). */
function timerDock(i: number): Node {
  const holding = state.holdUntil > Date.now();
  return dock(
    'split',
    h(
      'button',
      {
        type: 'button',
        'data-key': 'timer-cancel',
        onclick: () => {
          if (locked()) return;
          lock();
          state.readyUntil = 0;
          state.holdUntil = 0;
          render();
        },
      },
      'Cancel',
    ),
    holding
      ? h(
          'button',
          {
            type: 'button',
            className: 'primary log',
            'data-key': 'timer-go',
            onclick: () => {
              if (locked()) return;
              const held = heldSeconds();
              state.holdUntil = 0;
              if (held < 1) {
                lock();
                render();
                return;
              }
              state.drafts[i]!.seconds = held; // stopped early: log the time actually held
              logSet(i);
            },
          },
          'Stop · log ',
          h('span', { 'data-clock': 'held' }, mmss(heldSeconds() * 1000)),
        )
      : h(
          'button',
          {
            type: 'button',
            className: 'primary log',
            'data-key': 'timer-go',
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
  );
}

/** The current-set zone: fixed height, in place of the first open row. */
function setZone(i: number, ex: PlannedExercise, set: PlannedSet, d: Draft): Node {
  const warm = ex.sets.filter((x) => x.warmup);
  const working = ex.sets.filter((x) => !x.warmup);
  const which = set.warmup ? `Warm-up ${warm.indexOf(set) + 1} of ${warm.length}` : `Set ${working.indexOf(set) + 1} of ${working.length}`;
  const target = ex.timed ? `target ${set.targetSec ?? 0} s` : `target ${set.targetReps} reps`;
  const plates = plateText(ex, d.weight);
  const lastForSet = lastTimeForSet(ex, set);
  return h(
    'div',
    { className: set.warmup ? 'zone warmup' : 'zone', 'data-zone': '' },
    // The cue for a partner reached with no rest: the zone's first line (its place is kept in a superset, so nothing moves when it goes).
    ex.supersetId && h('p', { className: 'straight', ...(state.straight?.step === i ? { 'data-straight': '' } : {}) }, state.straight?.step === i ? 'Straight on · no rest' : ''),
    h('p', { className: 'setline' }, set.warmup && h('span', { className: 'pill' }, 'Warm-up'), set.warmup && ' ', `${which} · ${target}`),
    setSteppers(ex, d, 'zone'),
    plates && h('p', { className: 'muted small plates' }, plates),
    lastForSet && h('p', { className: 'muted small' }, `Last time: ${lastForSet}`),
    !set.warmup && ex.note && h('p', { className: 'muted small' }, ex.note),
    ex.timed && holdSlot(i, d),
  );
}

/** Log set, with the values being logged: the primary button of the dock. */
function logButton(i: number, ex: PlannedExercise, d: Draft): Node {
  return h(
    'button',
    {
      type: 'button',
      className: 'primary log',
      'aria-label': 'Log set',
      'data-key': 'log',
      onclick: () => logSet(i),
    },
    `Log set · ${setValues(ex, { reps: d.reps, seconds: d.seconds, weightKg: d.weight })}`,
  );
}

/** The dock of a card with a set open: Skip set beside Log set, always at the same place at the bottom of the card. */
function setDock(i: number, ex: PlannedExercise, d: Draft): Node {
  return dock(
    'split',
    h(
      'button',
      {
        type: 'button',
        'data-key': 'skip',
        onclick: () => logSet(i, true),
      },
      'Skip set',
    ),
    logButton(i, ex, d),
  );
}

/** The previous set's weight (the last one logged), for what changes on the bar. */
const lastWeight = (ex: PlannedExercise) => [...ex.sets].reverse().find((x) => x.done && x.weightKg !== undefined)?.weightKg;

/**
 * The rest in the zone, the only clock of the rest: label, the time (or "Rest over" for 3 s once it ran out), the next set with its
 * plates and what changes; Change shows its steppers without stopping the timer.
 */
function restZone(ex: PlannedExercise, set: PlannedSet, d: Draft, over: boolean): Node {
  const rest = state.rest;
  const plates = nextPlatesText(ex, d.weight, lastWeight(ex), state.plan?.gym);
  return h(
    'div',
    { className: 'zone rest', 'data-zone': '' },
    !over && h('p', { className: 'muted' }, 'Rest'), // "Rest over" says it all, so the small label goes
    over || !rest ? h('p', { className: 'time over' }, 'Rest over') : h('p', { className: 'time', role: 'timer', 'data-clock': 'rest' }, mmss(rest.untilMs - Date.now())),
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
    plates && h('p', { className: 'muted small plates' }, plates),
    state.restChange && setSteppers(ex, d, 'zone'),
  );
}

/** The dock while the card's rest runs: the progress line, -15 s, +15 s, Skip rest (the time is the zone's); with Change open, Log set above them. */
function restDock(i: number, ex: PlannedExercise, d: Draft): Node {
  return h(
    'div',
    { className: 'dock resting', role: 'group', 'aria-label': 'Rest controls' },
    state.restChange && logButton(i, ex, d),
    h('div', { className: 'bar', 'aria-hidden': 'true' }, h('span', { 'data-restbar': '' })),
    h(
      'div',
      { className: 'restbtns' },
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

/** The dock for the 3 s after a rest ran out: "Start set 2" goes to the set at once (the set zone comes by itself after 3 s). */
function restOverDock(set: PlannedSet, ex: PlannedExercise): Node {
  const n = ex.sets.filter((x) => !!x.warmup === !!set.warmup).indexOf(set) + 1;
  return dock(
    '',
    h(
      'button',
      {
        type: 'button',
        className: 'primary log',
        'data-key': 'rest-start',
        onclick: () => {
          if (locked()) return;
          lock();
          state.restOver = null;
          syncRest();
          render();
          ui?.cards[state.pos]?.querySelector<HTMLElement>('[data-key="log"]')?.focus({ preventScroll: true });
        },
      },
      `Start ${set.warmup ? 'warm-up' : 'set'} ${n}`,
    ),
  );
}

/** Nothing left to do on this exercise: where it stands (the way on is in the dock). */
function doneZone(ex: PlannedExercise): Node {
  const working = ex.sets.filter((x) => !x.warmup);
  return h('div', { className: 'zone auto', 'data-zone': '' }, h('p', { className: 'setline' }, `${ex.name} done · ${working.filter(closed).length} of ${working.length} sets`));
}

/** The dock of a finished exercise: the way to the next step. */
function doneDock(i: number): Node {
  const steps = stepsOf(state.plan!);
  const target = nextTarget(steps, i);
  const label = target.kind === 'step' ? `Go to ${stepName(steps[target.index]!)}` : 'Go to the end of the workout';
  const pos = target.kind === 'step' ? target.index + 1 : steps.length + 1;
  // An earlier step with sets still open: a way back above the forward button.
  const back = backTarget(steps, i);
  return dock(
    back ? 'stack' : '',
    back &&
      h(
        'button',
        {
          type: 'button',
          'data-key': 'go-back',
          onclick: () => {
            if (locked()) return;
            lock();
            goTo(back.index + 1, { focus: true });
          },
        },
        `Back to ${back.name} · ${back.left}`,
      ),
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
  // The steps hint is shown once per session, on the first card the person opens; on the others the weight value carries it.
  if (current && !state.hintUid && !started && !readOnly && !ex.bodyweight && !ex.timed && d.weightStep !== WEIGHT_STEP) state.hintUid = ex.uid;
  const showHint = state.hintUid === ex.uid && !started && !readOnly;
  const swappedFrom = state.swappedFrom.get(ex.uid);
  const resting = !!first && !readOnly && restRunning() && state.rest!.stepIndex === i;
  const over = !!first && !readOnly && !resting && state.restOver?.stepIndex === i && state.restOver.until > Date.now();
  const zone = readOnly ? null : first ? (resting || over ? restZone(ex, first, d, over) : setZone(i, ex, first, d)) : doneZone(ex);
  const bottom = readOnly ? null : first ? (resting ? restDock(i, ex, d) : over ? restOverDock(first, ex) : timerRunning(i) ? timerDock(i) : setDock(i, ex, d)) : doneDock(i);
  const rows = [...ex.sets.filter((x) => x.warmup), ...ex.sets.filter((x) => !x.warmup)].flatMap((set) => (set === first && zone ? [h('li', { className: 'zonerow' }, zone)] : setRow(i, ex, set, readOnly)));
  return [
    h(
      'div',
      { className: 'body exercise' },
      h('h1', { tabIndex: -1 }, ex.name),
      ex.supersetId && h('p', { className: 'small ss' }, supersetLabel(ex)),
      h('p', { className: 'muted small' }, [equipmentName(ex.equipment), ex.lastTime ? formatLastTime(ex.lastTime) : ''].filter(Boolean).join(' · ')),
      h('ol', { className: 'sets', 'aria-label': 'Sets' }, ...rows, !first && zone && h('li', { className: 'zonerow' }, zone)),
      !readOnly && effortRow(ex),
      showHint && h('p', { className: 'muted small' }, stepsHint(d)),
      ex.lastNotes && !ex.notes && h('p', { className: 'muted small' }, `Last note: ${ex.lastNotes}`),
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
    ),
    bottom,
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
  const heading = [h('h1', { tabIndex: -1 }, c.name), h('p', { className: 'muted small' }, c.when === 'before' ? 'Warm-up' : 'Finisher')];
  const planned = h('p', {}, `Planned ${c.plannedMin} min${c.plannedKm ? ` · ${kg(c.plannedKm)} km` : ''}`);
  if (readOnly || (isClosed && !editing && c.done)) {
    return [
      h(
        'div',
        { className: 'body' },
        ...heading,
        c.done ? h('p', { className: 'cardio-done' }, `✓ Logged ${cardioText(c)}${c.kcal ? ` · ~${c.kcal} kcal` : ''}`, failed.has(`cardio:${c.id}`) && h('span', { className: 'unsaved' }, ' · not saved')) : h('p', { className: 'muted' }, 'Skipped'),
        c.done &&
          !readOnly &&
          h(
            'button',
            {
              type: 'button',
              className: 'link',
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
  // The dock: Skip beside Log cardio; Cancel beside Save while a logged block is edited; a skipped block offers Log cardio alone.
  const logCardioButton = h('button', { type: 'button', className: 'primary log', 'data-key': 'log', onclick: () => logCardio(i) }, editing ? 'Save' : 'Log cardio');
  const bottom = asking
    ? h(
        'div',
        { className: 'dock stack', role: 'group', 'aria-label': 'Skip cardio?' },
        h('p', { className: 'center-text' }, 'Skip cardio?'),
        h(
          'div',
          { className: 'actions' },
          h(
            'button',
            {
              type: 'button',
              'data-key': 'skip-keep',
              onclick: () => {
                state.cardioAsk = '';
                render();
              },
            },
            'Keep',
          ),
          h('button', { type: 'button', 'data-key': 'skip-yes', onclick: () => logCardio(i, true) }, 'Skip'),
        ),
      )
    : editing
      ? dock(
          'split',
          h(
            'button',
            {
              type: 'button',
              'data-key': 'cancel-edit',
              onclick: () => {
                state.cardioEdit = null;
                render();
              },
            },
            'Cancel',
          ),
          logCardioButton,
        )
      : isClosed
        ? dock('', logCardioButton)
        : dock(
            'split',
            h(
              'button',
              {
                type: 'button',
                'data-key': 'skip',
                onclick: () => {
                  state.cardioAsk = c.id;
                  render();
                },
              },
              'Skip this',
            ),
            logCardioButton,
          );
  return [
    h(
      'div',
      { className: 'body' },
      ...heading,
      isClosed && !editing && h('p', { className: 'muted' }, 'Skipped'),
      planned,
      c.last && h('p', { className: 'muted small' }, `Last time: ${c.last}`),
      !!c.estKcal && h('p', { className: 'muted small' }, `~${c.estKcal} kcal`),
      h('div', { className: 'zone auto' }, h('div', { className: 'steppers' }, stepper('minutes', d, 'zone'), stepper('km', d, 'zone'))),
    ),
    bottom,
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
    card.toggleAttribute('data-scrolled', top > 0);
  });
  // Focus and scrolling into view must stop above the dock, which covers the bottom of the card.
  const shown = ui.cards[state.pos];
  if (shown) {
    shown.style.scrollPaddingBottom = `${shown.querySelector<HTMLElement>('.dock')?.offsetHeight ?? 0}px`;
    shown.style.scrollPaddingTop = `${shown.querySelector<HTMLElement>('.exercise > h1')?.offsetHeight ?? 0}px`;
  }
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
      case 'held':
        el.textContent = mmss(heldSeconds() * 1000);
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
  if (state.restOver && state.restOver.until <= now) {
    state.restOver = null;
    render();
    return;
  }
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
    state.timerDone = state.timerStep;
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
