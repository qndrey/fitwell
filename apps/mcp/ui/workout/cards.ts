import { platesFor, STANDARD_GYM, type Gym } from '@fitwell/core/domain/plates';
import type { PlannedCardio, PlannedExercise, PlannedSet, WorkoutPlan } from '../../src/workout/plan';

/** One step of the workout in plan order: cardio "before", exercises, cardio "after". */
export type Step = { kind: 'ex'; ex: PlannedExercise } | { kind: 'cardio'; c: PlannedCardio };

/** A card in the pager: position 0 is the Overview, the last is Finish. */
export type CardRef = { kind: 'overview' } | { kind: 'step'; index: number } | { kind: 'finish' };

/** Values being edited for one step; one per step, kept while the view is open. */
export interface Draft {
  reps: number;
  weight: number;
  seconds: number;
  minutes: number;
  km: number;
  /** Plain weight step for the weight stepper, by equipment. */
  weightStep: number;
}

/** The one running rest of the workout (not owned by a card). */
export interface Rest {
  /** Index of the step whose card holds the rest bar. */
  stepIndex: number;
  untilMs: number;
  totalMs: number;
}

/** Why the pager was not moved automatically. */
export interface PagerIntent {
  /** Step index the view will move to when the rest ends (or at once), or "finish". */
  target: { kind: 'step'; index: number } | { kind: 'finish' } | null;
  /** Set to true by any manual move after the log that created the intent. */
  cancelled: boolean;
}

export interface OverviewRow {
  index: number;
  name: string;
  /** "closed/total" working sets, or cardio state. */
  progress: string;
  dots: string;
  todayTarget?: string;
  lastTime?: string;
  superset: boolean;
  open: boolean;
}

export interface Overview {
  workingDone: number;
  workingTotal: number;
  exerciseCount: number;
  rows: OverviewRow[];
  /** Primary button: nothing logged -> "Start: X"; otherwise "Continue: X"; none when no step is open. */
  action: { label: string; stepIndex: number } | null;
}

export interface FinishState {
  workingOpen: number;
  cardioOpen: number;
  notDone: string[];
  skipped: string[];
  /** True when nothing blocks "Finish and send to Claude" (no open working sets, no open cardio). */
  canFinishDirectly: boolean;
}

/** One tap on the weight stepper: small enough for dumbbells and micro plates. Typing a value works for anything else. */
export const WEIGHT_STEP = 0.5;

export const kg = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const setClosed = (s: PlannedSet) => s.done || !!s.skipped;
export const cardioClosed = (c: PlannedCardio) => c.done || !!c.skipped;
/** The first open set; warm-ups come before working sets whatever the order the plan lists them in. */
export const nextSet = (e: PlannedExercise) => e.sets.find((s) => !setClosed(s) && s.warmup) ?? e.sets.find((s) => !setClosed(s));

/** Plan order: cardio "before" blocks, exercises, cardio "after" blocks. */
export function stepsOf(plan: WorkoutPlan): Step[] {
  const cardio = plan.cardio ?? [];
  return [
    ...cardio.filter((c) => c.when === 'before').map((c): Step => ({ kind: 'cardio', c })),
    ...plan.exercises.map((ex): Step => ({ kind: 'ex', ex })),
    ...cardio.filter((c) => c.when === 'after').map((c): Step => ({ kind: 'cardio', c })),
  ];
}

/** Open while any set (warm-ups included) is neither done nor skipped; a cardio block while neither done nor skipped. */
export function stepOpen(step: Step): boolean {
  return step.kind === 'ex' ? !!nextSet(step.ex) : !cardioClosed(step.c);
}

export const stepName = (step: Step) => (step.kind === 'ex' ? step.ex.name : step.c.name);

export function firstOpenStep(steps: Step[], from = 0): number {
  for (let i = Math.max(0, from); i < steps.length; i++) if (stepOpen(steps[i]!)) return i;
  return -1;
}

const workingSets = (ex: PlannedExercise) => ex.sets.filter((s) => !s.warmup);

/** Working sets only: how many are done (skipped are closed but not done), closed, and in total. */
export function workingCounts(steps: Step[]): { done: number; closed: number; open: number; total: number } {
  let done = 0;
  let closed = 0;
  let total = 0;
  for (const s of steps) {
    if (s.kind !== 'ex') continue;
    for (const set of workingSets(s.ex)) {
      total++;
      if (set.done) done++;
      if (setClosed(set)) closed++;
    }
  }
  return { done, closed, open: total - closed, total };
}

/** Fresh: no set and no cardio block is done or skipped. */
export function isFresh(steps: Step[]): boolean {
  return steps.every((s) => (s.kind === 'ex' ? s.ex.sets.every((x) => !setClosed(x)) : !cardioClosed(s.c)));
}

/** Where the pager starts: Overview when fresh, the first open step when resumed, Finish when finished or nothing is open. */
export function openingCard(plan: WorkoutPlan): CardRef {
  if (plan.finished) return { kind: 'finish' };
  const steps = stepsOf(plan);
  if (isFresh(steps)) return { kind: 'overview' };
  const open = firstOpenStep(steps);
  return open === -1 ? { kind: 'finish' } : { kind: 'step', index: open };
}

/** A finished plan needs its summary fetched once (idempotent) and never sends a message to Claude. */
export const needsSummaryFetch = (plan: WorkoutPlan) => plan.finished;

/** Pager position of a card: Overview 0, step i at i + 1, Finish last. */
export function cardPosition(card: CardRef, stepCount: number): number {
  return card.kind === 'overview' ? 0 : card.kind === 'finish' ? stepCount + 1 : card.index + 1;
}

/** The first open step after `fromIndex`; Finish when none. Forward only. */
export function nextTarget(steps: Step[], fromIndex: number): { kind: 'step'; index: number } | { kind: 'finish' } {
  const i = firstOpenStep(steps, fromIndex + 1);
  return i === -1 ? { kind: 'finish' } : { kind: 'step', index: i };
}

/** Steps of the superset the step at `index` belongs to, in order; empty for an exercise in none. */
export function supersetSteps(steps: Step[], index: number): number[] {
  const step = steps[index];
  if (!step || step.kind !== 'ex' || !step.ex.supersetId) return [];
  const id = step.ex.supersetId;
  return steps.flatMap((s, i) => (s.kind === 'ex' && s.ex.supersetId === id ? [i] : []));
}

/**
 * After a set (warm-up or working) of the exercise at `index` is closed: the next partner after it with an open set takes the
 * pager at once; with none, the rest stays on this card and the pager returns to the first superset exercise with an open set.
 * Null for an exercise in no superset.
 */
export function supersetHandoff(
  steps: Step[],
  index: number,
): { kind: 'partner'; index: number } | { kind: 'rest'; returnTo: number } | null {
  const members = supersetSteps(steps, index);
  if (members.length === 0) return null;
  const open = members.filter((i) => stepOpen(steps[i]!));
  const partner = open.find((i) => i > index);
  return partner !== undefined ? { kind: 'partner', index: partner } : { kind: 'rest', returnTo: open[0] ?? index };
}

export function finishState(steps: Step[]): FinishState {
  const notDone: string[] = [];
  const skipped: string[] = [];
  let workingOpen = 0;
  let cardioOpen = 0;
  for (const s of steps) {
    if (s.kind === 'ex') {
      workingSets(s.ex).forEach((set, k) => {
        const label = `${s.ex.name} set ${k + 1}`;
        if (set.skipped && !set.done) skipped.push(label);
        else if (!set.done) {
          workingOpen++;
          notDone.push(label);
        }
      });
    } else if (s.c.skipped && !s.c.done) skipped.push(s.c.name);
    else if (!s.c.done) {
      cardioOpen++;
      notDone.push(s.c.name);
    }
  }
  return { workingOpen, cardioOpen, notDone, skipped, canFinishDirectly: workingOpen === 0 && cardioOpen === 0 };
}

/** "<n> sets are not done." for the early-finish confirmation. */
export function confirmCount(state: FinishState): number {
  return state.workingOpen;
}

/** "5 × 87.5 kg", "40 s", "8 reps": the values of a set as the person sees them. */
export function setValues(ex: PlannedExercise, set: { reps?: number; weightKg?: number; seconds?: number }): string {
  if (ex.timed) return `${set.seconds ?? 0} s`;
  if (ex.bodyweight) return `${set.reps ?? 0} reps`;
  return `${set.reps ?? 0} × ${kg(set.weightKg ?? 0)} kg`;
}

export function setName(ex: PlannedExercise, set: PlannedSet): string {
  const warm = ex.sets.filter((x) => x.warmup);
  const working = workingSets(ex);
  return set.warmup ? `warm-up ${warm.indexOf(set) + 1}` : `set ${working.indexOf(set) + 1} of ${working.length}`;
}

/**
 * One tap on the weight stepper: what the equipment can actually do (a barbell moves in pairs of the smallest plate, a dumbbell rack
 * in 2 kg, a stack in 2.5 kg). Typing a value, or holding the button, reaches anything else.
 */
export function weightStepFor(ex: PlannedExercise, gym?: Gym): number {
  if (ex.bodyweight) return WEIGHT_STEP;
  const equipment = ex.equipment.toLowerCase();
  if (equipment === 'barbell' || equipment === 'e-z curl bar') {
    const plates = (gym ?? STANDARD_GYM).platesKg;
    return plates.length ? Math.min(...plates) * 2 : 2.5;
  }
  if (equipment === 'dumbbell' || equipment === 'kettlebells') return 2;
  if (equipment === 'machine' || equipment === 'cable') return 2.5;
  return WEIGHT_STEP;
}

/** "Each side: 20 + 5 + 1.25" for a barbell, from the person's bar and plates. */
export function plateText(ex: PlannedExercise, weight: number, gym: Gym = STANDARD_GYM): string | null {
  if (ex.equipment !== 'barbell' || ex.bodyweight) return null;
  const l = platesFor(weight, gym);
  if (!l) return `Lighter than the ${kg(gym.barKg)} kg bar`;
  const plate = (n: number) => String(Math.round(n * 100) / 100); // 1.25, not 1.3
  const side = l.perSide.length ? `Each side: ${l.perSide.map(plate).join(' + ')}` : 'Empty bar';
  return l.shortKg > 0 ? `${side} (${kg(l.totalKg)} kg; your plates can't make ${kg(weight)})` : `${side} · bar ${kg(gym.barKg)} kg`;
}

const LAST_TIME = /^(.*?)\s*\((\d{4})-(\d{2})-(\d{2})\)$/;

/** The server's last-time summary, when it has the "(yyyy-mm-dd)" tail; null otherwise. */
function parseLastTime(raw: string): { text: string; when: string; sets: { reps: number; weight: number | null; raw: string }[] | null } | null {
  const m = LAST_TIME.exec(raw);
  if (!m) return null;
  const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]))));
  const text = (m[1] ?? '').replace(/ kg$/, '');
  const found = [...text.matchAll(/(\d+) @ (BW|[\d.]+)/g)];
  const exact = found.length > 0 && found.map((x) => x[0]).join(', ') === text;
  return {
    text: m[1] ?? '',
    when,
    sets: exact ? found.map((x) => ({ reps: Number(x[1]), weight: x[2] === 'BW' ? null : Number(x[2]), raw: x[2]! })) : null,
  };
}

/** "Last time (9 Oct): 5, 5, 4 × 82.5 kg": the server's summary, with a plain date and one notation. */
export function formatLastTime(raw: string): string {
  const p = parseLastTime(raw);
  if (!p) return raw;
  if (p.sets) {
    const same = p.sets.every((x) => x.raw === p.sets![0]!.raw);
    const unit = (w: string) => (w === 'BW' ? 'bodyweight' : `${w} kg`);
    return same
      ? `Last time (${p.when}): ${p.sets.map((x) => x.reps).join(', ')} ${p.sets[0]!.raw === 'BW' ? 'reps, bodyweight' : `× ${p.sets[0]!.raw} kg`}`
      : `Last time (${p.when}): ${p.sets.map((x) => `${x.reps} × ${unit(x.raw)}`).join(', ')}`;
  }
  return `Last time (${p.when}): ${p.text}`;
}

/** True when `formatLastTime` understands the text (it carries a date). */
export const lastTimeParses = (raw: string) => LAST_TIME.test(raw);

/** "beat last: +1 rep" or "beat last: +2.5 kg" when today's first working set beats the last working set of the last session; both must be numbers. */
export function beatLast(ex: PlannedExercise): string | null {
  const lastTime = ex.lastTime;
  if (!lastTime || ex.timed) return null;
  const today = workingSets(ex)[0];
  const last = parseLastTime(lastTime)?.sets?.at(-1);
  if (!today || !last || !Number.isFinite(today.targetReps)) return null;
  const plusReps = (n: number) => `beat last: +${n} rep${n === 1 ? '' : 's'}`;
  if (ex.bodyweight || last.weight === null) {
    const reps = today.targetReps - last.reps;
    return reps > 0 ? plusReps(reps) : null;
  }
  if (today.weightKg === undefined || !Number.isFinite(today.weightKg)) return null;
  const weight = Math.round((today.weightKg - last.weight) * 100) / 100;
  if (weight > 0) return `beat last: +${kg(weight)} kg`;
  const reps = today.targetReps - last.reps;
  return weight === 0 && reps > 0 ? plusReps(reps) : null;
}

function dotsFor(sets: PlannedSet[]): string {
  return sets.map((s) => (s.done ? '●' : s.skipped ? '–' : '○')).join('');
}

export function buildOverview(plan: WorkoutPlan): Overview {
  const steps = stepsOf(plan);
  const counts = workingCounts(steps);
  const fresh = isFresh(steps);
  const rows = steps.map((step, index): OverviewRow => {
    if (step.kind === 'cardio') {
      const c = step.c;
      return { index, name: c.name, progress: c.done ? 'done' : c.skipped ? 'skipped' : 'not done', dots: c.done ? '●' : c.skipped ? '–' : '○', superset: false, open: stepOpen(step) };
    }
    const ex = step.ex;
    const working = workingSets(ex);
    const first = working[0] ?? ex.sets[0];
    const beat = beatLast(ex);
    const target = first ? setValues(ex, { reps: first.targetReps, weightKg: first.weightKg, seconds: first.targetSec }) : undefined;
    const row: OverviewRow = {
      index,
      name: ex.name,
      progress: `${working.filter(setClosed).length}/${working.length}`,
      dots: dotsFor(working),
      superset: !!ex.supersetId,
      open: stepOpen(step),
    };
    if (target) row.todayTarget = beat ? `${target} · ${beat}` : target;
    if (ex.lastTime && lastTimeParses(ex.lastTime)) row.lastTime = formatLastTime(ex.lastTime);
    return row;
  });
  const open = firstOpenStep(steps);
  const action = open === -1 ? null : { label: `${fresh ? 'Start' : 'Continue'}: ${stepName(steps[open]!)}`, stepIndex: open };
  return { workingDone: counts.done, workingTotal: counts.total, exerciseCount: plan.exercises.length, rows, action };
}

/** Prefill the steppers: the last done set of the same kind (a working set never starts from a warm-up's weight), else the plan. */
export function draftFor(step: Step, gym?: Gym): Draft {
  if (step.kind === 'cardio') {
    return { reps: 0, weight: 0, seconds: 30, minutes: step.c.minutes ?? step.c.plannedMin, km: step.c.distanceKm ?? step.c.plannedKm ?? 0, weightStep: WEIGHT_STEP };
  }
  const ex = step.ex;
  const target = nextSet(ex) ?? ex.sets[ex.sets.length - 1];
  const prev = target ? [...ex.sets].reverse().find((x) => x.done && !!x.warmup === !!target.warmup) : undefined;
  return {
    reps: prev?.reps ?? target?.targetReps ?? 0,
    weight: prev?.weightKg ?? target?.weightKg ?? 0,
    seconds: prev?.seconds ?? target?.targetSec ?? 30,
    minutes: 0,
    km: 0,
    weightStep: weightStepFor(ex, gym),
  };
}

/**
 * Tries every queued change once, including ones added while it runs; failed ones stay queued and are listed in `failed`.
 * `pending` and `failed` are the caller's collections and are updated in place.
 */
export async function drainQueue(pending: Map<string, () => Promise<boolean>>, failed: Set<string>): Promise<void> {
  const tried = new Set<() => Promise<boolean>>();
  const nextEntry = () => [...pending].find(([, run]) => !tried.has(run));
  for (let next = nextEntry(); next; next = nextEntry()) {
    const [key, run] = next;
    tried.add(run);
    let ok: boolean;
    try {
      ok = await run();
    } catch {
      ok = false;
    }
    if (ok && pending.get(key) === run) {
      pending.delete(key);
      failed.delete(key);
    } else if (!ok) failed.add(key);
  }
}
