import { platesFor, STANDARD_GYM, type Gym } from '@fitwell/core/domain/plates';
import { estimatedOneRepMax } from '@fitwell/core/domain/workouts';
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

/** The first open step when it lies before `from`: where "Back to ..." goes, with how much is left there ("2 sets left"). Null when nothing earlier is open. */
export function backTarget(steps: Step[], from: number): { index: number; name: string; left: string } | null {
  const index = firstOpenStep(steps, 0);
  const step = steps[index];
  if (index === -1 || index >= from || !step) return null;
  const open = step.kind === 'ex' ? step.ex.sets.filter((x) => !setClosed(x)).length : 1;
  return { index, name: stepName(step), left: step.kind === 'ex' ? `${open} ${open === 1 ? 'set' : 'sets'} left` : 'not done' };
}

/** Steps of the superset the step at `index` belongs to, in order; empty for an exercise in none. */
export function supersetSteps(steps: Step[], index: number): number[] {
  const step = steps[index];
  if (!step || step.kind !== 'ex' || !step.ex.supersetId) return [];
  const id = step.ex.supersetId;
  return steps.flatMap((s, i) => (s.kind === 'ex' && s.ex.supersetId === id ? [i] : []));
}

/**
 * Where an exercise sits in its superset: one round count for the whole group. The round is the earliest working set any member
 * still has open (a member still in its warm-ups counts as round 1), the total is the largest number of working sets among the
 * members, so partners never disagree. An exercise whose next set is a warm-up reads "Warm-up k of n" instead. Null in no superset.
 */
export function supersetRound(steps: Step[], index: number): { text: string; total: number } | null {
  const members = supersetSteps(steps, index);
  if (members.length === 0) return null;
  const exs = members.map((i) => (steps[i] as { kind: 'ex'; ex: PlannedExercise }).ex);
  const total = Math.max(...exs.map((e) => workingSets(e).length));
  const mine = (steps[index] as { kind: 'ex'; ex: PlannedExercise }).ex;
  const next = nextSet(mine);
  if (next?.warmup) {
    const warm = mine.sets.filter((x) => x.warmup);
    return { text: `Warm-up ${warm.indexOf(next) + 1} of ${warm.length}`, total };
  }
  const rounds = exs.flatMap((e) => {
    const n = nextSet(e);
    return n ? [n.warmup ? 1 : workingSets(e).indexOf(n) + 1] : [];
  });
  return { text: `round ${Math.min(...rounds, total)} of ${total}`, total };
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

/**
 * What is not done (or skipped) grouped by exercise, one line each: "Pullups: 2 sets", "Squat: set 3", "Squat: warm-up 2, 2 sets".
 * Warm-ups are listed only with `withWarmups` (they never block finishing); an open cardio block is listed by name.
 */
export function openGroups(steps: Step[], which: 'notDone' | 'skipped', withWarmups: boolean): string[] {
  const lines: string[] = [];
  for (const s of steps) {
    if (s.kind === 'cardio') {
      if (which === 'skipped' ? s.c.skipped && !s.c.done : !s.c.skipped && !s.c.done) lines.push(s.c.name);
      continue;
    }
    const hit = (x: PlannedSet) => (which === 'skipped' ? !!x.skipped && !x.done : !x.done && !x.skipped);
    const working = workingSets(s.ex);
    const warm = s.ex.sets.filter((x) => x.warmup);
    const parts: string[] = [];
    const warmHits = withWarmups ? warm.filter(hit).map((x) => warm.indexOf(x) + 1) : [];
    if (warmHits.length) parts.push(`warm-up${warmHits.length > 1 ? 's' : ''} ${warmHits.join(' and ')}`);
    const hits = working.filter(hit);
    if (hits.length === 1) parts.push(`set ${working.indexOf(hits[0]!) + 1}`);
    else if (hits.length > 1) parts.push(`${hits.length} sets`);
    if (parts.length) lines.push(`${s.ex.name}: ${parts.join(', ')}`);
  }
  return lines;
}

/** What the plan says was logged: working sets done, the weight lifted (loaded, non-timed working sets) and the cardio minutes done. */
export function loggedTotals(steps: Step[]): { sets: number; volumeKg: number; cardioMin: number } {
  let sets = 0;
  let volumeKg = 0;
  let cardioMin = 0;
  for (const s of steps) {
    if (s.kind === 'cardio') {
      if (s.c.done) cardioMin += s.c.minutes ?? s.c.plannedMin;
      continue;
    }
    for (const x of workingSets(s.ex).filter((y) => y.done)) {
      sets++;
      if (!s.ex.bodyweight && !s.ex.timed) volumeKg += (x.reps ?? 0) * (x.weightKg ?? 0);
    }
  }
  return { sets, volumeKg: Math.round(volumeKg), cardioMin };
}

/** "Will send: 3 sets, ~1,075 kg, cardio 10 min": a one-line preview of the message to Claude, from what is logged. */
export function sendPreview(steps: Step[]): string {
  const t = loggedTotals(steps);
  const parts = [`${t.sets} ${t.sets === 1 ? 'set' : 'sets'}`];
  if (t.volumeKg > 0) parts.push(`~${t.volumeKg.toLocaleString('en-US')} kg`);
  if (t.cardioMin > 0) parts.push(`cardio ${t.cardioMin} min`);
  return `Will send: ${parts.join(', ')}`;
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

/**
 * The plates for the next set, while resting, with what changes from the set just done: "Each side: 25 + 15 · no change",
 * "… · add 2.5 a side", "… · take off 5 a side". Null when the exercise has no plate maths (not a barbell).
 */
export function nextPlatesText(ex: PlannedExercise, next: number, prev: number | undefined, gym: Gym = STANDARD_GYM): string | null {
  const text = plateText(ex, next, gym);
  if (!text) return null;
  const head = text.replace(/ · bar [\d.]+ kg$/, '');
  if (prev === undefined || !/^(Each side|Empty bar)/.test(head)) return head;
  const side = Math.round(((next - prev) / 2) * 100) / 100;
  const n = (x: number) => String(Math.round(x * 100) / 100);
  return `${head} · ${side === 0 ? 'no change' : side > 0 ? `add ${n(side)} a side` : `take off ${n(-side)} a side`}`;
}

const LAST_TIME = /^(.*?)\s*\((\d{4})-(\d{2})-(\d{2})\)$/;

/** One set as the server writes it: reps or seconds, with a weight, bodyweight (plus any added kg) or no load. */
interface ParsedSet {
  measure: 'reps' | 'sec';
  n: number;
  load: { kind: 'kg'; kg: number } | { kind: 'bw'; addedKg: number } | { kind: 'none' };
}

// The server (core summarizeSets) writes "3×5 @ 80 kg", "3×45 s", "3×8 @ BW + 10 kg" when every set matches, else "5 @ 80, 5 @ 82.5 kg".
const MEASURE = String.raw`(\d+ s|\d+:\d{2}|\d+)`;
const LOAD = String.raw`(BW(?: \+ [\d.]+)?|[\d.]+)`;
const GROUPED = new RegExp(`^(\\d+)×${MEASURE}(?: @ ${LOAD}(?: kg)?)?$`);
const SINGLE = new RegExp(`^${MEASURE}(?: @ ${LOAD})?$`);

function parseSet(measure: string, load: string | undefined): ParsedSet {
  const colon = /^(\d+):(\d{2})$/.exec(measure);
  const sec = colon ? Number(colon[1]) * 60 + Number(colon[2]) : measure.endsWith(' s') ? parseInt(measure, 10) : null;
  const bw = load?.startsWith('BW') ? { kind: 'bw' as const, addedKg: Number(/\+ ([\d.]+)/.exec(load)?.[1] ?? 0) } : null;
  return {
    measure: sec === null ? 'reps' : 'sec',
    n: sec ?? parseInt(measure, 10),
    load: bw ?? (load ? { kind: 'kg', kg: Number(load) } : { kind: 'none' }),
  };
}

/** The sets in a summary like "3×5 @ 80 kg" or "5 @ 80, 4 @ 82.5 kg", one entry per set; null when the text is anything else. */
function parseSets(text: string): ParsedSet[] | null {
  const g = GROUPED.exec(text);
  if (g) return Array.from({ length: Number(g[1]) }, () => parseSet(g[2]!, g[3]));
  const parts = text.replace(/ kg$/, '').split(', ');
  const sets: ParsedSet[] = [];
  for (const part of parts) {
    const m = SINGLE.exec(part);
    if (!m) return null;
    sets.push(parseSet(m[1]!, m[2]));
  }
  return sets;
}

const num = (n: number) => String(Math.round(n * 100) / 100);
const loadKey = (l: ParsedSet['load']) => (l.kind === 'kg' ? `kg ${l.kg}` : l.kind === 'bw' ? `bw ${l.addedKg}` : 'none');

/**
 * One notation for a list of sets: "5, 5 × 107.5 kg", "5 × 105 kg, 4 × 107.5 kg" (a new weight starts a new group),
 * "8, 8 reps" (bodyweight; "+10 kg" when weighted) and "40, 35 s" (timed). No "@", no "BW".
 */
function formatParsed(sets: ParsedSet[]): string {
  const groups: { measure: ParsedSet['measure']; load: ParsedSet['load']; ns: number[] }[] = [];
  for (const s of sets) {
    const load: ParsedSet['load'] = s.measure === 'sec' ? { kind: 'none' } : s.load; // a hold is told by its time alone
    const last = groups.at(-1);
    if (last && last.measure === s.measure && loadKey(last.load) === loadKey(load)) last.ns.push(s.n);
    else groups.push({ measure: s.measure, load, ns: [s.n] });
  }
  return groups
    .map((g) => {
      const ns = g.ns.join(', ');
      if (g.measure === 'sec') return `${ns} s`;
      if (g.load.kind === 'kg') return `${ns} × ${num(g.load.kg)} kg`;
      return g.load.kind === 'bw' && g.load.addedKg > 0 ? `${ns} reps +${num(g.load.addedKg)} kg` : `${ns} reps`;
    })
    .join(', ');
}

/** The sets of one exercise as the person sees them: "5, 5 × 107.5 kg", "8, 8 reps", "40, 35 s". */
export function formatSets(ex: PlannedExercise, sets: { reps?: number; weightKg?: number; seconds?: number }[]): string {
  return formatParsed(
    sets.map((s): ParsedSet => (ex.timed ? { measure: 'sec', n: s.seconds ?? 0, load: { kind: 'none' } } : { measure: 'reps', n: s.reps ?? 0, load: ex.bodyweight ? { kind: 'bw', addedKg: 0 } : { kind: 'kg', kg: s.weightKg ?? 0 } })),
  );
}

/** The server's summary of the sets of one exercise ("2×5 @ 100 kg", "45 s @ BW, 40 s @ BW") in the on-screen notation; text it cannot read is returned as it came. */
export function formatSetSummary(raw: string): string {
  const sets = parseSets(raw);
  return sets ? formatParsed(sets) : raw;
}

/** The server's last-time summary, when it has the "(yyyy-mm-dd)" tail; null otherwise. */
function parseLastTime(raw: string): { text: string; when: string; sets: ParsedSet[] | null } | null {
  const m = LAST_TIME.exec(raw);
  if (!m) return null;
  const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]))));
  return { text: m[1] ?? '', when, sets: parseSets(m[1] ?? '') };
}

/** "Last time (9 Oct): 5, 5, 4 × 82.5 kg": the server's summary, with a plain date and one notation. */
export function formatLastTime(raw: string): string {
  const p = parseLastTime(raw);
  if (!p) return raw;
  return `Last time (${p.when}): ${p.sets ? formatParsed(p.sets) : p.text}`;
}

/** "5 × 107.5 kg": what the same working set (by its place among the working sets) was last time; null for a warm-up, or when the text or the set is not there. */
export function lastTimeForSet(ex: PlannedExercise, set: PlannedSet): string | null {
  if (set.warmup || !ex.lastTime) return null;
  const last = parseLastTime(ex.lastTime)?.sets?.[workingSets(ex).indexOf(set)];
  return last ? formatParsed([last]) : null;
}

/**
 * How today's best working set compares with last time's best, as good news only: "+2.5 kg vs 19 Oct", "+1 rep vs 19 Oct",
 * "+5 s vs 19 Oct" or "same as 19 Oct". Heavier counts first, then reps (seconds for a timed exercise). A drop (a planned light day,
 * a deload) says nothing: null, like when nothing was logged today or the last-time text cannot be read.
 */
export function compareToLast(ex: PlannedExercise): string | null {
  const last = ex.lastTime ? parseLastTime(ex.lastTime) : null;
  const today = workingSets(ex).filter((x) => x.done);
  if (!last?.sets || today.length === 0) return null;
  const sets = last.sets.filter((x) => x.measure === (ex.timed ? 'sec' : 'reps'));
  if (sets.length === 0) return null;
  const same = `same as ${last.when}`;
  if (ex.timed) {
    const diff = Math.max(...today.map((x) => x.seconds ?? 0)) - Math.max(...sets.map((x) => x.n));
    return diff === 0 ? same : diff > 0 ? `+${num(diff)} s vs ${last.when}` : null;
  }
  const weightOf = (x: ParsedSet) => (x.load.kind === 'kg' ? x.load.kg : 0);
  const bestLast = sets.reduce((a, b) => (weightOf(b) > weightOf(a) || (weightOf(b) === weightOf(a) && b.n > a.n) ? b : a));
  const bestToday = today.reduce((a, b) => ((b.weightKg ?? 0) > (a.weightKg ?? 0) || ((b.weightKg ?? 0) === (a.weightKg ?? 0) && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));
  if (!ex.bodyweight && bestLast.load.kind === 'kg') {
    const w = Math.round(((bestToday.weightKg ?? 0) - bestLast.load.kg) * 100) / 100;
    if (w > 0) return `+${num(w)} kg vs ${last.when}`;
    if (w < 0) return null; // lighter than last time: nothing to say
  }
  const r = (bestToday.reps ?? 0) - bestLast.n;
  return r === 0 ? same : r > 0 ? `+${r} rep${r === 1 ? '' : 's'} vs ${last.when}` : null;
}

/** True when `formatLastTime` understands the text (it carries a date). */
export const lastTimeParses = (raw: string) => LAST_TIME.test(raw);

/** "beat last: +1 rep" or "beat last: +2.5 kg" when today's first working set beats the last working set of the last session; both must be numbers. */
export function beatLast(ex: PlannedExercise): string | null {
  const lastTime = ex.lastTime;
  if (!lastTime || ex.timed) return null;
  const today = workingSets(ex)[0];
  const last = parseLastTime(lastTime)?.sets?.at(-1);
  if (!today || !last || last.measure !== 'reps' || !Number.isFinite(today.targetReps)) return null;
  const plusReps = (n: number) => `beat last: +${n} rep${n === 1 ? '' : 's'}`;
  if (ex.bodyweight || last.load.kind === 'bw') {
    const reps = today.targetReps - last.n;
    return reps > 0 ? plusReps(reps) : null;
  }
  if (last.load.kind !== 'kg' || today.weightKg === undefined || !Number.isFinite(today.weightKg)) return null;
  const weight = Math.round((today.weightKg - last.load.kg) * 100) / 100;
  if (weight > 0) return `beat last: +${kg(weight)} kg`;
  const reps = today.targetReps - last.n;
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

/**
 * Prefill the steppers. A warm-up always starts from its own planned values (the ramp climbs, so the last warm-up's weight is wrong
 * for the next one). A working set carries over the last done working set, else the plan; it never starts from a warm-up's weight.
 */
export function draftFor(step: Step, gym?: Gym): Draft {
  if (step.kind === 'cardio') {
    return { reps: 0, weight: 0, seconds: 30, minutes: step.c.minutes ?? step.c.plannedMin, km: step.c.distanceKm ?? step.c.plannedKm ?? 0, weightStep: WEIGHT_STEP };
  }
  const ex = step.ex;
  const target = nextSet(ex) ?? ex.sets[ex.sets.length - 1];
  const prev = target && !target.warmup ? [...ex.sets].reverse().find((x) => x.done && !x.warmup) : undefined;
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

/**
 * The live record cue for a working set that was just logged, or null. It speaks only when the set beats the best estimated 1RM of
 * every earlier session AND of the sets already logged in this workout (the comparison finishSummary makes on the server, with the
 * same Epley estimate and the same 0.01 margin), so the finish card's "New best" always agrees. The wording says which kind of best
 * it is: heaviest for that rep count, most reps at that weight, or just the estimate. No cue without earlier sessions to compare with,
 * for warm-ups, bodyweight or timed exercises, or a tie.
 */
export function recordCue(ex: PlannedExercise, set: PlannedSet): string | null {
  const bests = ex.bests;
  if (!bests || set.warmup || ex.bodyweight || ex.timed || !set.done || set.reps === undefined || set.weightKg === undefined) return null;
  const e1rm = estimatedOneRepMax(set.weightKg, set.reps);
  if (e1rm === undefined) return null;
  const others = ex.sets.filter((s) => s !== set && s.done && !s.warmup && s.reps !== undefined && s.weightKg !== undefined);
  const before = Math.max(bests.e1rm, ...others.map((s) => estimatedOneRepMax(s.weightKg!, s.reps!) ?? 0));
  if (!(before > 0) || !(e1rm > before + 0.01)) return null;
  const heaviest = Math.max(0, bests.byReps.find(([r]) => r === set.reps)?.[1] ?? 0, ...others.filter((s) => s.reps === set.reps).map((s) => s.weightKg!));
  if (heaviest > 0 && set.weightKg > heaviest) return `Heaviest ${set.reps}-rep set`;
  const mostReps = Math.max(0, bests.atWeight.find(([w]) => w === set.weightKg)?.[1] ?? 0, ...others.filter((s) => s.weightKg === set.weightKg).map((s) => s.reps!));
  if (mostReps > 0 && set.reps > mostReps) return `Most reps at ${kg(set.weightKg)} kg`;
  return `Estimated 1RM ${Math.round(e1rm * 10) / 10} kg`;
}
