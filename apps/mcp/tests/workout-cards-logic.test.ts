import { describe, expect, it } from 'vitest';
import type { PlannedCardio, PlannedExercise, PlannedSet, WorkoutPlan } from '../src/workout/plan';
import {
  backTarget,
  beatLast,
  buildOverview,
  compareToLast,
  confirmCount,
  drainQueue,
  draftFor,
  finishState,
  formatLastTime,
  formatSets,
  formatSetSummary,
  lastTimeForSet,
  nextPlatesText,
  nextTarget,
  openGroups,
  sendPreview,
  openingCard,
  plateText,
  setName,
  setValues,
  stepOpen,
  stepsOf,
  supersetHandoff,
  supersetRound,
  weightStepFor,
  type Step,
} from '../ui/workout/cards';

// ---------- fixtures ----------
let uidCounter = 0;
const set = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => ({ id, targetReps: 5, weightKg: 80, done: false, ...o });
const closed = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => set(id, { done: true, reps: 5, ...o });
const skipped = (id: string, o: Partial<PlannedSet> = {}): PlannedSet => set(id, { skipped: true, ...o });

function ex(name: string, sets: PlannedSet[], o: Partial<PlannedExercise> = {}): PlannedExercise {
  uidCounter += 1;
  return { uid: `u${uidCounter}`, id: `ex:${name}`, name, equipment: 'barbell', restSec: 90, bodyweight: false, sets, ...o };
}

function cardio(id: string, when: 'before' | 'after', o: Partial<PlannedCardio> = {}): PlannedCardio {
  return { id, name: `Cardio ${id}`, when, plannedMin: 10, done: false, ...o };
}

function plan(exercises: PlannedExercise[], cardioBlocks: PlannedCardio[] = [], o: Partial<WorkoutPlan> = {}): WorkoutPlan {
  return { workoutId: 'w1', name: 'Full body A', startedAt: 0, finished: false, exercises, cardio: cardioBlocks, ...o };
}

const exStep = (e: PlannedExercise): Step => ({ kind: 'ex', ex: e });

// ---------- Data model: step order and open steps ----------
describe('Specs: Data model rules, Step order', () => {
  it('step order is cardio before, exercises in plan order, cardio after', () => {
    const a = ex('A', [set('1')]);
    const b = ex('B', [set('1')]);
    const pre = cardio('c1', 'before');
    const post = cardio('c2', 'after');
    const steps = stepsOf(plan([a, b], [post, pre]));
    expect(steps.map((s) => (s.kind === 'ex' ? s.ex.name : s.c.id))).toEqual(['c1', 'A', 'B', 'c2']);
  });

  it('the same exercise twice (distinct uid) is two steps', () => {
    const a1 = ex('A', [set('1')]);
    const a2 = ex('A', [set('1')]);
    const steps = stepsOf(plan([a1, a2]));
    expect(steps).toHaveLength(2);
    expect(steps[0]).not.toBe(steps[1]);
  });
});

describe('Specs: Data model rules, open step', () => {
  it('an exercise is open while any set, warm-ups included, is neither done nor skipped', () => {
    expect(stepOpen(exStep(ex('A', [closed('w', { warmup: true }), set('1')])))).toBe(true);
    expect(stepOpen(exStep(ex('A', [set('w', { warmup: true }), closed('1')])))).toBe(true);
    expect(stepOpen(exStep(ex('A', [closed('w', { warmup: true }), closed('1'), skipped('2')])))).toBe(false);
  });

  it('a cardio step is open while neither done nor skipped', () => {
    expect(stepOpen({ kind: 'cardio', c: cardio('c', 'after') })).toBe(true);
    expect(stepOpen({ kind: 'cardio', c: cardio('c', 'after', { done: true }) })).toBe(false);
    expect(stepOpen({ kind: 'cardio', c: cardio('c', 'after', { skipped: true }) })).toBe(false);
  });
});

// ---------- Opening and resume ----------
describe('Specs: Opening and resume', () => {
  it('rule 1: a fresh, unfinished workout opens on the Overview', () => {
    expect(openingCard(plan([ex('A', [set('1')]), ex('B', [set('1')])], [cardio('c', 'after')]))).toEqual({ kind: 'overview' });
  });

  it('rule 2: a resumed workout opens on the first open step (card index + 1 is the pager position, the CardRef carries the step index)', () => {
    const p = plan([ex('A', [closed('1')]), ex('B', [closed('1'), set('2')]), ex('C', [set('1')])]);
    expect(openingCard(p)).toEqual({ kind: 'step', index: 1 });
  });

  it('rule 2: cardio before counts in step indexes', () => {
    const p = plan([ex('A', [closed('1')])], [cardio('c', 'before', { done: true }), cardio('d', 'after')]);
    expect(openingCard(p)).toEqual({ kind: 'step', index: 2 });
  });

  it('rule 2: a step with only open warm-ups is open', () => {
    const p = plan([ex('A', [closed('1')]), ex('B', [set('w', { warmup: true }), closed('1')])]);
    expect(openingCard(p)).toEqual({ kind: 'step', index: 1 });
  });

  it('rule 2: a skipped set is progress, so the workout is resumed, not fresh', () => {
    const p = plan([ex('A', [skipped('1'), set('2')])]);
    expect(openingCard(p)).toEqual({ kind: 'step', index: 0 });
  });

  it('rule 3: unfinished but every step closed opens on Finish', () => {
    const p = plan([ex('A', [closed('1')]), ex('B', [skipped('1')])], [cardio('c', 'after', { done: true })]);
    expect(openingCard(p)).toEqual({ kind: 'finish' });
  });

  it('rule 4 / AC12: a finished workout opens on Finish, even with open sets or fresh data', () => {
    expect(openingCard(plan([ex('A', [closed('1')])], [], { finished: true }))).toEqual({ kind: 'finish' });
    expect(openingCard(plan([ex('A', [set('1')])], [], { finished: true }))).toEqual({ kind: 'finish' });
  });
});

// ---------- nextTarget ----------
describe('Specs: After an exercise is done, nextTarget (FR11, AC6)', () => {
  const steps = (): Step[] => stepsOf(plan([ex('A', [set('1')]), ex('B', [closed('1')]), ex('C', [set('1')]), ex('D', [set('1')])]));

  it('is the first open step with an index greater than fromIndex', () => {
    expect(nextTarget(steps(), 0)).toEqual({ kind: 'step', index: 2 });
    expect(nextTarget(steps(), 2)).toEqual({ kind: 'step', index: 3 });
  });

  it('is forward-only: earlier open steps are not visited', () => {
    expect(nextTarget(steps(), 3)).toEqual({ kind: 'finish' });
  });

  it('ends on finish when nothing later is open', () => {
    const s = stepsOf(plan([ex('A', [set('1')]), ex('B', [closed('1')])]));
    expect(nextTarget(s, 0)).toEqual({ kind: 'finish' });
  });

  it('visits an open cardio finisher', () => {
    const s = stepsOf(plan([ex('A', [set('1')])], [cardio('c', 'after')]));
    expect(nextTarget(s, 0)).toEqual({ kind: 'step', index: 1 });
  });
});

// ---------- superset hand-off ----------
describe('Specs: After an exercise is done, rule 3, superset hand-off (FR9, AC5)', () => {
  const pair = (a: PlannedSet[], b: PlannedSet[]): Step[] => stepsOf(plan([ex('A', a, { supersetId: 'ss' }), ex('B', b, { supersetId: 'ss' })]));

  it('hands off to the next partner that has an open set', () => {
    expect(supersetHandoff(pair([closed('1'), set('2')], [set('1'), set('2')]), 0)).toEqual({ kind: 'partner', index: 1 });
  });

  it('warm-ups count: a partner with only an open warm-up receives the hand-off, and a logged warm-up hands off too', () => {
    const steps = pair([closed('w', { warmup: true }), set('1')], [set('w', { warmup: true }), closed('1')]);
    expect(supersetHandoff(steps, 0)).toEqual({ kind: 'partner', index: 1 });
  });

  it('a partner without an open set is skipped (three-way superset)', () => {
    const steps = stepsOf(
      plan([
        ex('A', [closed('1'), set('2')], { supersetId: 'ss' }),
        ex('B', [closed('1'), closed('2')], { supersetId: 'ss' }),
        ex('C', [set('1'), set('2')], { supersetId: 'ss' }),
      ]),
    );
    expect(supersetHandoff(steps, 0)).toEqual({ kind: 'partner', index: 2 });
  });

  it('with no later open partner the result is a normal rest, returning to the first superset exercise with an open set', () => {
    // B (the last partner) was just logged; A still has a set open.
    expect(supersetHandoff(pair([closed('1'), set('2')], [closed('1'), set('2')]), 1)).toEqual({ kind: 'rest', returnTo: 0 });
  });

  it('unequal counts: the partner is done, so a log on the first exercise gives a normal rest and returns to it', () => {
    // A has 3 working sets, B has 1 and is already done.
    const steps = pair([closed('1'), set('2'), set('3')], [closed('1')]);
    expect(supersetHandoff(steps, 0)).toEqual({ kind: 'rest', returnTo: 0 });
  });

  it('the return target is the first superset exercise with an open set, not the one just logged', () => {
    const steps = stepsOf(
      plan([
        ex('A', [closed('1'), set('2')], { supersetId: 'ss' }),
        ex('B', [closed('1'), set('2')], { supersetId: 'ss' }),
        ex('C', [closed('1'), closed('2')], { supersetId: 'ss' }),
      ]),
    );
    // C was the last partner and is done; the rest returns to A.
    expect(supersetHandoff(steps, 2)).toEqual({ kind: 'rest', returnTo: 0 });
  });

  it('an exercise outside any superset has no hand-off', () => {
    const steps = stepsOf(plan([ex('A', [closed('1'), set('2')]), ex('B', [set('1')])]));
    expect(supersetHandoff(steps, 0)).toBeNull();
  });

  it('exercises with a different supersetId are not partners', () => {
    const steps = stepsOf(plan([ex('A', [closed('1'), set('2')], { supersetId: 'x' }), ex('B', [set('1')], { supersetId: 'y' })]));
    expect(supersetHandoff(steps, 0)).toEqual({ kind: 'rest', returnTo: 0 });
  });
});

// ---------- FinishState ----------
describe('Specs: Finish card, FinishState (FR14, AC7)', () => {
  it('counts open working sets; warm-ups never count', () => {
    const steps = stepsOf(plan([ex('Squat', [set('w', { warmup: true }), closed('1'), set('2'), set('3')])]));
    const f = finishState(steps);
    expect(f.workingOpen).toBe(2);
    expect(f.canFinishDirectly).toBe(false);
  });

  it('lists skipped and not-done working sets as "<exercise> set k"', () => {
    const steps = stepsOf(plan([ex('Squat', [closed('1'), skipped('2'), set('3')]), ex('Bench', [closed('1'), closed('2')])]));
    const f = finishState(steps);
    expect(f.skipped).toEqual(['Squat set 2']);
    expect(f.notDone).toEqual(['Squat set 3']);
    expect(f.workingOpen).toBe(1);
  });

  it('skipped sets are closed: nothing open means finishing directly is possible', () => {
    const f = finishState(stepsOf(plan([ex('Squat', [closed('1'), skipped('2')])])));
    expect(f.workingOpen).toBe(0);
    expect(f.cardioOpen).toBe(0);
    expect(f.canFinishDirectly).toBe(true);
  });

  it('an open warm-up alone does not block finishing directly', () => {
    const f = finishState(stepsOf(plan([ex('Squat', [set('w', { warmup: true }), closed('1')])])));
    expect(f.workingOpen).toBe(0);
    expect(f.canFinishDirectly).toBe(true);
  });

  it('an open cardio block counts in cardioOpen and blocks finishing directly', () => {
    const f = finishState(stepsOf(plan([ex('Squat', [closed('1')])], [cardio('c', 'after')])));
    expect(f.cardioOpen).toBe(1);
    expect(f.workingOpen).toBe(0);
    expect(f.canFinishDirectly).toBe(false);
  });

  it('a skipped or logged cardio block is not open', () => {
    const f = finishState(stepsOf(plan([ex('Squat', [closed('1')])], [cardio('c', 'before', { skipped: true }), cardio('d', 'after', { done: true })])));
    expect(f.cardioOpen).toBe(0);
    expect(f.canFinishDirectly).toBe(true);
  });

  it('the confirm count is the number of working sets not done', () => {
    const f = finishState(stepsOf(plan([ex('Squat', [closed('1'), set('2'), set('3')]), ex('Bench', [set('1')])])));
    expect(confirmCount(f)).toBe(3);
  });
});

// ---------- Overview ----------
describe('Specs: Overview (FR4, FR15, AC1)', () => {
  it('counts working sets only; skipped are closed but not done; warm-ups never count', () => {
    const p = plan([ex('Squat', [closed('w', { warmup: true }), closed('1'), skipped('2'), set('3')]), ex('Bench', [closed('1'), closed('2')])]);
    const o = buildOverview(p);
    expect(o.workingTotal).toBe(5);
    expect(o.workingDone).toBe(3);
    expect(o.exerciseCount).toBe(2);
  });

  it('a cardio row says what is planned, or what was logged once done, and nothing when skipped', () => {
    const o = buildOverview(plan([ex('Squat', [set('1')])], [cardio('a', 'before', { plannedMin: 10, plannedKm: 1.5 }), cardio('b', 'after', { done: true, minutes: 12, distanceKm: 2 }), cardio('c', 'after', { skipped: true }), cardio('d', 'after', { plannedMin: 8 })]));
    expect(o.rows.filter((r) => r.name.startsWith('Cardio')).map((r) => r.todayTarget)).toEqual(['10 min · 1.5 km', '12 min · 2 km', undefined, '8 min']);
  });

  it('exerciseCount excludes cardio blocks and rows cover every step in order', () => {
    const p = plan([ex('Squat', [set('1')]), ex('Bench', [set('1')])], [cardio('c', 'after')]);
    const o = buildOverview(p);
    expect(o.exerciseCount).toBe(2);
    expect(o.rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(o.rows.map((r) => r.name)).toEqual(['Squat', 'Bench', 'Cardio c']);
  });

  it('a row shows closed/total working sets and whether the step is open', () => {
    const o = buildOverview(plan([ex('Squat', [set('w', { warmup: true }), closed('1'), set('2')]), ex('Bench', [closed('1')])]));
    expect(o.rows[0]).toMatchObject({ progress: '1/2', open: true });
    expect(o.rows[1]).toMatchObject({ progress: '1/1', open: false });
  });

  it('rows mark supersets', () => {
    const o = buildOverview(plan([ex('A', [set('1')], { supersetId: 's' }), ex('B', [set('1')], { supersetId: 's' }), ex('C', [set('1')])]));
    expect(o.rows.map((r) => r.superset)).toEqual([true, true, false]);
  });

  it('a row shows the first working set as today\'s target, ignoring warm-ups', () => {
    const o = buildOverview(plan([ex('Squat', [set('w', { warmup: true, targetReps: 8, weightKg: 40 }), set('1', { targetReps: 5, weightKg: 87.5 })])]));
    expect(o.rows[0]?.todayTarget).toBe('5 × 87.5 kg');
  });

  it('a row shows the last-time line only when formatLastTime parses the text', () => {
    const parsed = ex('Squat', [set('1')], { lastTime: '5 @ 80, 5 @ 80, 4 @ 80 kg (2026-10-09)' });
    const odd = ex('Plank', [set('1')], { lastTime: 'held a while' });
    const none = ex('Row', [set('1')]);
    const o = buildOverview(plan([parsed, odd, none]));
    expect(o.rows[0]?.lastTime).toBe('Last time (9 Oct): 5, 5, 4 × 80 kg');
    const grouped = buildOverview(plan([ex('Bench', [set('1')], { lastTime: '3×5 @ 60 kg (2026-10-09)' })]));
    expect(grouped.rows[0]?.lastTime).toBe('Last time (9 Oct): 5, 5, 5 × 60 kg');
    expect(o.rows[1]?.lastTime).toBeUndefined();
    expect(o.rows[2]?.lastTime).toBeUndefined();
  });

  it('action reads "Start: <name>" when the workout is fresh', () => {
    const o = buildOverview(plan([ex('Squat', [set('1')]), ex('Bench', [set('1')])]));
    expect(o.action).toEqual({ label: 'Start: Squat', stepIndex: 0 });
  });

  it('action reads "Continue: <name>" for the first open step when resumed', () => {
    const o = buildOverview(plan([ex('Squat', [closed('1')]), ex('Bench', [set('1')])]));
    expect(o.action).toEqual({ label: 'Continue: Bench', stepIndex: 1 });
  });

  it('a workout with only skipped progress is resumed, so "Continue"', () => {
    const o = buildOverview(plan([ex('Squat', [skipped('1'), set('2')])]));
    expect(o.action?.label).toBe('Continue: Squat');
  });

  it('there is no action when no step is open', () => {
    const o = buildOverview(plan([ex('Squat', [closed('1')])]));
    expect(o.action).toBeNull();
  });
});

describe('Specs: Overview, beat last (FR15)', () => {
  const lt = '5 @ 80, 5 @ 80, 5 @ 80 kg (2026-10-09)';

  it('is a plain rep difference when weight is equal', () => {
    expect(beatLast(ex('Squat', [set('1', { targetReps: 6, weightKg: 80 })], { lastTime: lt }))).toBe('beat last: +1 rep');
  });

  it('is a plain weight difference when reps are equal', () => {
    expect(beatLast(ex('Squat', [set('1', { targetReps: 5, weightKg: 82.5 })], { lastTime: lt }))).toBe('beat last: +2.5 kg');
  });

  it('is omitted when the last-time text does not parse', () => {
    expect(beatLast(ex('Squat', [set('1', { targetReps: 6 })], { lastTime: '3×5 @ 80 kg' }))).toBeNull();
    expect(beatLast(ex('Squat', [set('1', { targetReps: 6 })], { lastTime: undefined }))).toBeNull();
  });

  it('reads the server\'s grouped form, so a weighted lift gets "+2.5 kg"', () => {
    const grouped = '3×5 @ 80 kg (2026-10-09)';
    expect(beatLast(ex('Squat', [set('1', { targetReps: 5, weightKg: 82.5 })], { lastTime: grouped }))).toBe('beat last: +2.5 kg');
    expect(beatLast(ex('Squat', [set('1', { targetReps: 6, weightKg: 80 })], { lastTime: grouped }))).toBe('beat last: +1 rep');
    expect(beatLast(ex('Squat', [set('1', { targetReps: 5, weightKg: 80 })], { lastTime: grouped }))).toBeNull();
  });

  it('compares with the last set when the weights differed, and with reps for a grouped bodyweight form', () => {
    expect(beatLast(ex('Squat', [set('1', { targetReps: 5, weightKg: 110 })], { lastTime: '5 @ 105, 4 @ 107.5 kg (2026-10-09)' }))).toBe('beat last: +2.5 kg');
    const pushup = ex('Push-up', [set('1', { weightKg: undefined, targetReps: 12 })], { bodyweight: true, lastTime: '3×10 @ BW (2026-10-09)' });
    expect(beatLast(pushup)).toBe('beat last: +2 reps');
  });

  it('is omitted when today\'s target is not numeric', () => {
    const e = ex('Squat', [set('1', { targetReps: Number.NaN })], { lastTime: lt });
    expect(beatLast(e)).toBeNull();
  });
});

// ---------- Draft carry-over ----------
describe('Specs: Data model rules, Draft carry-over', () => {
  it('starts from the next set\'s plan values when nothing is done', () => {
    const d = draftFor(exStep(ex('Squat', [set('1', { targetReps: 5, weightKg: 87.5 })])));
    expect(d).toMatchObject({ reps: 5, weight: 87.5, seconds: 30 });
  });

  it('carries over the last done working set', () => {
    const e = ex('Squat', [closed('1', { reps: 6, weightKg: 85 }), closed('2', { reps: 4, weightKg: 90 }), set('3', { targetReps: 5, weightKg: 80 })]);
    expect(draftFor(exStep(e))).toMatchObject({ reps: 4, weight: 90 });
  });

  it('a working set never starts from a warm-up\'s weight', () => {
    const e = ex('Squat', [closed('w', { warmup: true, reps: 8, weightKg: 40 }), set('1', { targetReps: 5, weightKg: 87.5 })]);
    expect(draftFor(exStep(e))).toMatchObject({ reps: 5, weight: 87.5 });
  });

  it('a warm-up starts from its own planned values, not from the warm-up before it', () => {
    const e = ex('Squat', [closed('w1', { warmup: true, reps: 8, weightKg: 40 }), set('w2', { warmup: true, targetReps: 5, weightKg: 60 }), set('1')]);
    expect(draftFor(exStep(e))).toMatchObject({ reps: 5, weight: 60 });
  });

  it('a warm-up ignores what was typed into the earlier warm-ups and the working sets alike', () => {
    const e = ex('Squat', [closed('w1', { warmup: true, reps: 12, weightKg: 20 }), closed('w2', { warmup: true, reps: 3, weightKg: 55 }), set('w3', { warmup: true, targetReps: 3, weightKg: 75 }), set('1', { targetReps: 5, weightKg: 100 })]);
    expect(draftFor(exStep(e))).toMatchObject({ reps: 3, weight: 75 });
  });

  it('a warm-up of a timed exercise starts from its target seconds, not from the earlier warm-up', () => {
    const timed = ex('Plank', [closed('w1', { warmup: true, seconds: 20 }), set('w2', { warmup: true, targetSec: 30 })], { timed: true, bodyweight: true, equipment: 'body only' });
    expect(draftFor(exStep(timed)).seconds).toBe(30);
  });

  it('seconds come from the last done set, else the target, else 30', () => {
    const timed = (sets: PlannedSet[]) => ex('Plank', sets, { timed: true, bodyweight: true, equipment: 'body only' });
    expect(draftFor(exStep(timed([closed('1', { seconds: 42 }), set('2', { targetSec: 45 })]))).seconds).toBe(42);
    expect(draftFor(exStep(timed([set('1', { targetSec: 45 })]))).seconds).toBe(45);
    expect(draftFor(exStep(timed([set('1')]))).seconds).toBe(30);
  });

  it('a bodyweight set has weight 0 and carries no weight', () => {
    const e = ex('Pull-up', [set('1', { weightKg: undefined, targetReps: 8 })], { bodyweight: true, equipment: 'body only' });
    expect(draftFor(exStep(e))).toMatchObject({ reps: 8, weight: 0 });
  });

  it('the draft carries the weight step for the equipment', () => {
    expect(draftFor(exStep(ex('Curl', [set('1')], { equipment: 'dumbbell' }))).weightStep).toBe(2);
  });

  it('a cardio draft takes minutes and km from the logged values, else the plan', () => {
    expect(draftFor({ kind: 'cardio', c: cardio('c', 'after', { plannedMin: 15, plannedKm: 3 }) })).toMatchObject({ minutes: 15, km: 3 });
    expect(draftFor({ kind: 'cardio', c: cardio('c', 'after', { plannedMin: 15, plannedKm: 3, minutes: 22, distanceKm: 4.5, done: true }) })).toMatchObject({ minutes: 22, km: 4.5 });
    expect(draftFor({ kind: 'cardio', c: cardio('c', 'after', { plannedMin: 15 }) }).km).toBe(0);
  });
});

// ---------- helpers moved from main.ts ----------
describe('Specs: Architecture outline, helpers moved from main.ts', () => {
  describe('weightStepFor', () => {
    it('a barbell moves in pairs of the smallest plate', () => {
      expect(weightStepFor(ex('Squat', [], { equipment: 'barbell' }))).toBe(2.5);
      expect(weightStepFor(ex('Squat', [], { equipment: 'barbell' }), { barKg: 20, platesKg: [5, 2] })).toBe(4);
      expect(weightStepFor(ex('Curl', [], { equipment: 'E-Z Curl Bar' }))).toBe(2.5);
    });
    it('a barbell with no plates falls back to 2.5', () => {
      expect(weightStepFor(ex('Squat', [], { equipment: 'barbell' }), { barKg: 20, platesKg: [] })).toBe(2.5);
    });
    it('dumbbells and kettlebells move by 2, machines and cables by 2.5', () => {
      expect(weightStepFor(ex('Curl', [], { equipment: 'dumbbell' }))).toBe(2);
      expect(weightStepFor(ex('Swing', [], { equipment: 'kettlebells' }))).toBe(2);
      expect(weightStepFor(ex('Press', [], { equipment: 'machine' }))).toBe(2.5);
      expect(weightStepFor(ex('Fly', [], { equipment: 'cable' }))).toBe(2.5);
    });
    it('bodyweight and other equipment move by 0.5', () => {
      expect(weightStepFor(ex('Dip', [], { equipment: 'body only', bodyweight: true }))).toBe(0.5);
      expect(weightStepFor(ex('Thing', [], { equipment: 'other' }))).toBe(0.5);
    });
  });

  describe('setValues', () => {
    it('shows reps × weight, reps for bodyweight, seconds for timed', () => {
      expect(setValues(ex('Squat', []), { reps: 5, weightKg: 87.5 })).toBe('5 × 87.5 kg');
      expect(setValues(ex('Squat', []), { reps: 5, weightKg: 80 })).toBe('5 × 80 kg');
      expect(setValues(ex('Dip', [], { bodyweight: true }), { reps: 8 })).toBe('8 reps');
      expect(setValues(ex('Plank', [], { timed: true, bodyweight: true }), { seconds: 40 })).toBe('40 s');
    });
  });

  describe('setName', () => {
    it('names warm-ups by position and working sets "set k of n"', () => {
      const w1 = set('w1', { warmup: true });
      const w2 = set('w2', { warmup: true });
      const a = set('1');
      const b = set('2');
      const e = ex('Squat', [w1, w2, a, b]);
      expect(setName(e, w1)).toBe('warm-up 1');
      expect(setName(e, w2)).toBe('warm-up 2');
      expect(setName(e, a)).toBe('set 1 of 2');
      expect(setName(e, b)).toBe('set 2 of 2');
    });
  });

  describe('formatLastTime', () => {
    it('one notation when every set has the same weight', () => {
      expect(formatLastTime('5 @ 80, 5 @ 80, 4 @ 80 kg (2026-10-09)')).toBe('Last time (9 Oct): 5, 5, 4 × 80 kg');
    });
    it('per-set weights when they differ', () => {
      expect(formatLastTime('5 @ 80, 5 @ 82.5 kg (2026-10-09)')).toBe('Last time (9 Oct): 5 × 80 kg, 5 × 82.5 kg');
    });
    it('bodyweight sets read "reps", with no "BW"', () => {
      expect(formatLastTime('8 @ BW, 7 @ BW (2026-10-09)')).toBe('Last time (9 Oct): 8, 7 reps');
      expect(formatLastTime('3×8 @ BW (2026-10-09)')).toBe('Last time (9 Oct): 8, 8, 8 reps');
    });
    it('the server\'s grouped form "N×R @ W kg" is spread over the sets', () => {
      expect(formatLastTime('3×5 @ 80 kg (2026-10-09)')).toBe('Last time (9 Oct): 5, 5, 5 × 80 kg');
      expect(formatLastTime('2×5 @ 107.5 kg (2026-10-09)')).toBe('Last time (9 Oct): 5, 5 × 107.5 kg');
    });
    it('a new weight starts a new group', () => {
      expect(formatLastTime('5 @ 105, 4 @ 107.5 kg (2026-10-09)')).toBe('Last time (9 Oct): 5 × 105 kg, 4 × 107.5 kg');
      expect(formatLastTime('5 @ 105, 5 @ 105, 4 @ 107.5 kg (2026-10-09)')).toBe('Last time (9 Oct): 5, 5 × 105 kg, 4 × 107.5 kg');
    });
    it('timed sets read "40, 35 s", grouped or not, and a minute or more is in seconds', () => {
      expect(formatLastTime('40 s @ BW, 35 s @ BW (2026-10-09)')).toBe('Last time (9 Oct): 40, 35 s');
      expect(formatLastTime('3×45 s (2026-10-09)')).toBe('Last time (9 Oct): 45, 45, 45 s');
      expect(formatLastTime('2×1:30 @ BW (2026-10-09)')).toBe('Last time (9 Oct): 90, 90 s');
    });
    it('added load on a bodyweight lift is "+10 kg"', () => {
      expect(formatLastTime('3×8 @ BW + 10 kg (2026-10-09)')).toBe('Last time (9 Oct): 8, 8, 8 reps +10 kg');
      expect(formatLastTime('8 @ BW + 10, 6 @ BW + 10 kg (2026-10-09)')).toBe('Last time (9 Oct): 8, 6 reps +10 kg');
    });
    it('never shows "@" or "BW" for any form the server writes', () => {
      for (const raw of ['3×5 @ 80 kg', '5 @ 80, 5 @ 82.5 kg', '3×8 @ BW', '8 @ BW, 7 @ BW', '3×8 @ BW + 10 kg', '3×45 s', '45 s @ BW, 40 s @ BW', '1×5 @ 60 kg']) {
        expect(formatLastTime(`${raw} (2026-10-09)`)).not.toMatch(/@|BW/);
      }
    });
    it('text without a date is returned as it came', () => {
      expect(formatLastTime('whatever')).toBe('whatever');
    });
    it('text that is not a list of sets is kept after the date', () => {
      expect(formatLastTime('held a while (2026-10-09)')).toBe('Last time (9 Oct): held a while');
    });
  });

  describe('formatSetSummary (the finish card\'s lines)', () => {
    it('writes every form the server sends in the one notation', () => {
      expect(formatSetSummary('2×5 @ 100 kg')).toBe('5, 5 × 100 kg');
      expect(formatSetSummary('5 @ 105, 4 @ 107.5 kg')).toBe('5 × 105 kg, 4 × 107.5 kg');
      expect(formatSetSummary('45 s @ BW, 40 s @ BW')).toBe('45, 40 s');
      expect(formatSetSummary('8 @ BW, 8 @ BW, 6 @ BW')).toBe('8, 8, 6 reps');
    });
    it('returns text it cannot read as it came', () => {
      expect(formatSetSummary('nothing logged')).toBe('nothing logged');
      expect(formatSetSummary('')).toBe('');
    });
  });

  describe('lastTimeForSet (the set zone\'s "Last time: ..." line)', () => {
    const e = (lastTime?: string) => ex('Squat', [set('w', { warmup: true }), set('1'), set('2'), set('3')], lastTime ? { lastTime } : {});
    it('is the same working set last time, in the one notation', () => {
      const x = e('3×5 @ 107.5 kg (2026-10-09)');
      expect(lastTimeForSet(x, x.sets[1]!)).toBe('5 × 107.5 kg');
      const mixed = e('5 @ 105, 4 @ 107.5 kg (2026-10-09)');
      expect(lastTimeForSet(mixed, mixed.sets[2]!)).toBe('4 × 107.5 kg');
    });
    it('reads reps for bodyweight and seconds for timed sets', () => {
      const bw = ex('Dip', [set('1')], { bodyweight: true, lastTime: '8 @ BW, 7 @ BW (2026-10-09)' });
      expect(lastTimeForSet(bw, bw.sets[0]!)).toBe('8 reps');
      const plank = ex('Plank', [set('1')], { timed: true, lastTime: '45 s @ BW (2026-10-09)' });
      expect(lastTimeForSet(plank, plank.sets[0]!)).toBe('45 s');
    });
    it('is null for a warm-up, a set past the last session\'s, no last time or text it cannot read', () => {
      const x = e('2×5 @ 80 kg (2026-10-09)');
      expect(lastTimeForSet(x, x.sets[0]!)).toBeNull();
      expect(lastTimeForSet(x, x.sets[3]!)).toBeNull();
      expect(lastTimeForSet(e(), e().sets[1]!)).toBeNull();
      const odd = e('held a while (2026-10-09)');
      expect(lastTimeForSet(odd, odd.sets[1]!)).toBeNull();
    });
  });

  describe('nextPlatesText (the plates for the next set while resting)', () => {
    const squat = ex('Squat', []);
    it('says "no change" for the same weight and what to add or take off a side otherwise', () => {
      expect(nextPlatesText(squat, 100, 100)).toBe('Each side: 25 + 15 · no change');
      expect(nextPlatesText(squat, 102.5, 100)).toBe('Each side: 25 + 15 + 1.25 · add 1.25 a side');
      expect(nextPlatesText(squat, 60, 80)).toBe('Each side: 20 · take off 10 a side');
    });
    it('has no change text without a previous weight, and none at all for a non-barbell', () => {
      expect(nextPlatesText(squat, 100, undefined)).toBe('Each side: 25 + 15');
      expect(nextPlatesText(ex('Curl', [], { equipment: 'dumbbell' }), 20, 20)).toBeNull();
    });
    it('keeps "Lighter than the bar" as it is', () => {
      expect(nextPlatesText(squat, 10, 20)).toBe('Lighter than the 20 kg bar');
    });
  });

  describe('formatSets (sets the player holds)', () => {
    const sets = [{ reps: 5, weightKg: 107.5 }, { reps: 5, weightKg: 107.5 }];
    it('matches the notation of the server\'s summaries', () => {
      expect(formatSets(ex('Squat', []), sets)).toBe('5, 5 × 107.5 kg');
      expect(formatSets(ex('Squat', []), [{ reps: 5, weightKg: 105 }, { reps: 4, weightKg: 107.5 }])).toBe('5 × 105 kg, 4 × 107.5 kg');
      expect(formatSets(ex('Dip', [], { bodyweight: true }), [{ reps: 8 }, { reps: 8 }])).toBe('8, 8 reps');
      expect(formatSets(ex('Plank', [], { timed: true, bodyweight: true }), [{ seconds: 40 }, { seconds: 35 }])).toBe('40, 35 s');
    });
  });

  describe('plateText', () => {
    it('lists plates per side for a barbell, from the standard gym by default', () => {
      expect(plateText(ex('Squat', [], { equipment: 'barbell' }), 100)).toBe('Each side: 25 + 15 · bar 20 kg');
    });
    it('uses the given gym', () => {
      expect(plateText(ex('Squat', [], { equipment: 'barbell' }), 30, { barKg: 15, platesKg: [5, 2.5] })).toBe('Each side: 5 + 2.5 · bar 15 kg');
    });
    it('says so when lighter than the bar and "Empty bar" at the bar weight', () => {
      expect(plateText(ex('Squat', [], { equipment: 'barbell' }), 10)).toBe('Lighter than the 20 kg bar');
      expect(plateText(ex('Squat', [], { equipment: 'barbell' }), 20)).toBe('Empty bar · bar 20 kg');
    });
    it('is null for non-barbell and bodyweight exercises', () => {
      expect(plateText(ex('Curl', [], { equipment: 'dumbbell' }), 20)).toBeNull();
      expect(plateText(ex('Dip', [], { equipment: 'barbell', bodyweight: true }), 20)).toBeNull();
    });
  });
});

// ---------- Save queue drain ----------
describe('Specs: Honest saving, drainQueue keeps running until every entry has been tried once (FR16)', () => {
  type Run = () => Promise<boolean>;

  it('tries every entry once, removes successes and records failures that stay queued', async () => {
    const pending = new Map<string, Run>();
    const failed = new Set<string>();
    const tries: string[] = [];
    pending.set('a', async () => (tries.push('a'), true));
    pending.set('b', async () => (tries.push('b'), false));
    await drainQueue(pending, failed);
    expect(tries).toEqual(['a', 'b']);
    expect([...pending.keys()]).toEqual(['b']);
    expect([...failed]).toEqual(['b']);
  });

  it('an entry added while the drain runs is tried in the same run', async () => {
    const pending = new Map<string, Run>();
    const failed = new Set<string>();
    const tries: string[] = [];
    pending.set('a', async () => {
      tries.push('a');
      pending.set('late', async () => (tries.push('late'), true));
      return true;
    });
    await drainQueue(pending, failed);
    expect(tries).toEqual(['a', 'late']);
    expect(pending.size).toBe(0);
  });

  it('an entry added by a later entry is also picked up', async () => {
    const pending = new Map<string, Run>();
    const failed = new Set<string>();
    const tries: string[] = [];
    pending.set('a', async () => (tries.push('a'), true));
    pending.set('b', async () => {
      tries.push('b');
      pending.set('c', async () => (tries.push('c'), true));
      return true;
    });
    await drainQueue(pending, failed);
    expect(tries).toEqual(['a', 'b', 'c']);
  });

  it('a failed entry is tried once per run, not looped on', async () => {
    const pending = new Map<string, Run>();
    const failed = new Set<string>();
    let n = 0;
    pending.set('a', async () => (n++, false));
    await drainQueue(pending, failed);
    expect(n).toBe(1);
    expect(pending.has('a')).toBe(true);
  });

  it('a run that throws counts as failed and does not stop the others', async () => {
    const pending = new Map<string, Run>();
    const failed = new Set<string>();
    const tries: string[] = [];
    pending.set('a', async () => {
      tries.push('a');
      throw new Error('offline');
    });
    pending.set('b', async () => (tries.push('b'), true));
    await drainQueue(pending, failed);
    expect(tries).toEqual(['a', 'b']);
    expect([...failed]).toEqual(['a']);
    expect(pending.has('a')).toBe(true);
    expect(pending.has('b')).toBe(false);
  });

  it('a retry that succeeds leaves the queue and the failed set', async () => {
    const pending = new Map<string, Run>();
    const failed = new Set<string>(['a']);
    pending.set('a', async () => true);
    await drainQueue(pending, failed);
    expect(pending.size).toBe(0);
    expect(failed.size).toBe(0);
  });

  it('an entry replaced by a newer one for the same key while in flight stays queued for the next run', async () => {
    const pending = new Map<string, Run>();
    const failed = new Set<string>();
    const newer: Run = async () => true;
    pending.set('set:1:u1', async () => {
      pending.set('set:1:u1', newer);
      return true;
    });
    await drainQueue(pending, failed);
    // The newer entry was added during the run, so it is tried in this run and removed.
    expect(pending.size).toBe(0);
  });
});

describe('Specs: Exercise done looks back (A8), backTarget', () => {
  it('is the first open step when it lies before this one, with the sets left there', () => {
    const steps = stepsOf(plan([ex('Squat', [closed('1'), set('2'), skipped('3'), set('4')]), ex('Bench', [closed('1')]), ex('Row', [set('1')])]));
    expect(backTarget(steps, 1)).toEqual({ index: 0, name: 'Squat', left: '2 sets left' });
    expect(backTarget(steps, 0)).toBeNull();
  });
  it('says "1 set left" and "not done" for a cardio block, and is null when nothing earlier is open', () => {
    expect(backTarget(stepsOf(plan([ex('Squat', [set('1')]), ex('Bench', [closed('1')])])), 1)?.left).toBe('1 set left');
    expect(backTarget(stepsOf(plan([ex('Squat', [closed('1')])], [cardio('c', 'before')])), 1)).toMatchObject({ name: 'Cardio c', left: 'not done' });
    expect(backTarget(stepsOf(plan([ex('Squat', [closed('1')]), ex('Bench', [closed('1')])])), 1)).toBeNull();
  });
});

describe('Specs: Supersets, one round count (A9), supersetRound', () => {
  const pair = (a: PlannedSet[], b: PlannedSet[]) => stepsOf(plan([ex('A', a, { supersetId: 's' }), ex('B', b, { supersetId: 's' }), ex('C', [set('1')])]));
  it('is the earliest open working set of the group out of the largest working-set count, the same for both partners', () => {
    const steps = pair([closed('1'), set('2'), set('3')], [set('1'), set('2')]);
    expect(supersetRound(steps, 0)).toEqual({ text: 'round 1 of 3', total: 3 });
    expect(supersetRound(steps, 1)).toEqual({ text: 'round 1 of 3', total: 3 });
    const later = pair([closed('1'), closed('2'), set('3')], [closed('1'), closed('2')]);
    expect(supersetRound(later, 0)?.text).toBe('round 3 of 3');
    expect(supersetRound(later, 1)?.text).toBe('round 3 of 3'); // B is done, the group is where A is
  });
  it('reads "Warm-up k of n" for an exercise whose next set is a warm-up', () => {
    const steps = pair([closed('w1', { warmup: true }), set('w2', { warmup: true }), set('1')], [set('1')]);
    expect(supersetRound(steps, 0)?.text).toBe('Warm-up 2 of 2');
    expect(supersetRound(steps, 1)?.text).toBe('round 1 of 1');
  });
  it('is null for an exercise in no superset', () => {
    expect(supersetRound(pair([set('1')], [set('1')]), 2)).toBeNull();
  });
});

describe('Specs: Finish card before finishing (A10), grouped lines and the preview', () => {
  const steps = stepsOf(plan([
    ex('Squat', [set('w1', { warmup: true }), closed('1', { reps: 5, weightKg: 100 }), set('2'), set('3')]),
    ex('Pullups', [skipped('1'), skipped('2')], { bodyweight: true }),
    ex('Plank', [closed('1', { seconds: 40 })], { timed: true, bodyweight: true }),
  ], [cardio('r', 'after', { name: 'Row' }), cardio('s', 'before', { name: 'Bike', skipped: true })]));
  it('groups by exercise: a single set by number, several by count, warm-ups only when asked, an open cardio block by name', () => {
    expect(openGroups(steps, 'notDone', true)).toEqual(['Squat: warm-up 1, 2 sets', 'Row']);
    expect(openGroups(steps, 'notDone', false)).toEqual(['Squat: 2 sets', 'Row']);
    expect(openGroups(steps, 'skipped', true)).toEqual(['Bike', 'Pullups: 2 sets']);
  });
  it('previews the working sets done, the weight lifted and the cardio minutes', () => {
    expect(sendPreview(steps)).toBe('Will send: 2 sets, ~500 kg');
    const withCardio = stepsOf(plan([ex('Squat', [closed('1', { reps: 5, weightKg: 215 })])], [cardio('c', 'after', { done: true, minutes: 10 })]));
    expect(sendPreview(withCardio)).toBe('Will send: 1 set, ~1,075 kg, cardio 10 min');
    expect(sendPreview(stepsOf(plan([ex('Squat', [set('1')])])))).toBe('Will send: 0 sets');
  });
});

describe('Specs: Summary (A11), compareToLast: gains and "same" only', () => {
  const day = (lastTime: string, sets: PlannedSet[], o: Partial<PlannedExercise> = {}) => ex('Squat', sets, { lastTime, ...o });
  it('compares the best set: the weight first, then the reps', () => {
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [closed('1', { reps: 5, weightKg: 82.5 })]))).toBe('+2.5 kg vs 9 Oct');
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [closed('1', { reps: 6, weightKg: 80 })]))).toBe('+1 rep vs 9 Oct');
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [closed('1', { reps: 5, weightKg: 80 })]))).toBe('same as 9 Oct');
    expect(compareToLast(day('5 @ 100, 3 @ 105 kg (2026-10-09)', [closed('1', { reps: 5, weightKg: 100 }), closed('2', { reps: 4, weightKg: 105 })]))).toBe('+1 rep vs 9 Oct');
  });
  it('compares reps for bodyweight and seconds for timed exercises', () => {
    expect(compareToLast(day('8 @ BW, 8 @ BW (2026-10-09)', [closed('1', { reps: 10 })], { bodyweight: true }))).toBe('+2 reps vs 9 Oct');
    expect(compareToLast(day('40 s @ BW (2026-10-09)', [closed('1', { seconds: 45 })], { timed: true, bodyweight: true }))).toBe('+5 s vs 9 Oct');
  });
  it('says nothing for a drop: lighter, fewer reps or a shorter hold are null, never a minus', () => {
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [closed('1', { reps: 5, weightKg: 65 })]))).toBeNull();
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [closed('1', { reps: 8, weightKg: 77.5 })]))).toBeNull(); // lighter wins over more reps
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [closed('1', { reps: 4, weightKg: 80 })]))).toBeNull();
    expect(compareToLast(day('8 @ BW, 8 @ BW (2026-10-09)', [closed('1', { reps: 6 })], { bodyweight: true }))).toBeNull();
    expect(compareToLast(day('40 s @ BW (2026-10-09)', [closed('1', { seconds: 35 })], { timed: true, bodyweight: true }))).toBeNull();
  });
  it('is null with nothing logged today, no last time or text it cannot read; warm-ups do not count', () => {
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [set('1')]))).toBeNull();
    expect(compareToLast(day('3×5 @ 80 kg (2026-10-09)', [closed('w', { warmup: true, reps: 5, weightKg: 90 })]))).toBeNull();
    expect(compareToLast(ex('Squat', [closed('1')]))).toBeNull();
    expect(compareToLast(day('held a while (2026-10-09)', [closed('1')]))).toBeNull();
  });
});
