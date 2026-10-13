import { describe, expect, it } from 'vitest';
import { analysisPrompt, foodSection, workoutRequestPrompt, workoutSection, WORKOUT_JSON_EXAMPLE } from '../../src/ai/prompts';
import { buildExercises, defaultChoice, parseAiReply, suggest } from '../../src/ai/importWorkout';
import { prepareExercises, type Exercise } from '@fitwell/core/data/exercises';
import type { FoodEntry, Workout } from '@fitwell/core/schema';

const base = { id: 'x', createdAt: 1, updatedAt: 1, rev: 1 };
const food = (day: string, slot: FoodEntry['slot'], name: string, grams: number, kcal: number): FoodEntry => ({
  ...base,
  day,
  slot,
  state: 'resolved',
  food: { ref: { source: 'frida', id: name }, name, per100g: { kcal, protein: 10, carbs: 20, fat: 5 }, portions: [] } as unknown as FoodEntry['food'],
  quantity: { amount: grams, unit: 'g' },
  grams,
  nutrition: { kcal, protein: 10, carbs: 20, fat: 5 },
});
const strength = (day: string, exercises: Workout['exercises'], name?: string): Workout => ({ ...base, day, type: 'strength', name, exercises });
const set = (reps: number, weightKg: number, extra = {}) => ({ id: 's', type: 'working' as const, reps, weightKg, ...extra });

describe('analysis prompt', () => {
  const entries = [food('2026-10-10', 'breakfast', 'Oat porridge', 60, 220), food('2026-10-10', 'lunch', 'Rye bread', 80, 200), food('2026-09-01', 'lunch', 'Too old', 10, 10)];
  const workouts = [strength('2026-10-10', [{ exerciseRef: 'ex:a', exerciseName: 'Bench Press', sets: [set(8, 60), set(8, 60), set(8, 60)] }], 'Push')];
  const data = { entries, workouts, weights: [{ ...base, day: '2026-10-09', kg: 80 }] };

  it('lists days with totals and meals, and ignores other periods', () => {
    const t = foodSection(entries, '2026-10-01', '2026-10-31');
    expect(t).toContain('2026-10-10 (Sat): 420 kcal');
    expect(t).toContain('Breakfast: Oat porridge 60 g (220 kcal)');
    expect(t).not.toContain('Too old');
  });
  it('writes workouts the way people read them', () => {
    expect(workoutSection(workouts, '2026-10-01', '2026-10-31', 'metric')).toContain('- Bench Press: 3×8 @ 60 kg');
    expect(workoutSection([], '2026-10-01', '2026-10-31', 'metric')).toBe('No workouts were logged in this period.');
  });
  it('builds a prompt for food, workouts or both, with weight and goals', () => {
    const both = analysisPrompt({ kind: 'both', from: '2026-10-01', to: '2026-10-31', units: 'metric', data, goals: { kcal: 2200, workoutsPerWeek: 3 } });
    expect(both).toContain('FOOD');
    expect(both).toContain('WORKOUTS');
    expect(both).toContain('Body weight (kg): 2026-10-09 80');
    expect(both).toContain('2200 kcal a day');
    expect(analysisPrompt({ kind: 'food', from: '2026-10-01', to: '2026-10-31', units: 'metric', data })).not.toContain('WORKOUTS');
  });
  it('leaves numbers out when only habits are tracked, and never includes deleted entries', () => {
    const gone = [{ ...entries[0]!, deletedAt: 5 }];
    expect(foodSection(entries, '2026-10-01', '2026-10-31', true)).not.toContain('kcal');
    expect(foodSection(gone, '2026-10-01', '2026-10-31')).toBe('No food was logged in this period.');
  });
  it('shows pounds when asked', () => {
    expect(workoutSection(workouts, '2026-10-01', '2026-10-31', 'imperial')).toContain('lb');
  });
  it('asks for a workout in the format the importer reads', () => {
    const p = workoutRequestPrompt({ goal: 'legs, 45 minutes', day: '2026-10-12', units: 'imperial', data, recentDays: 14 });
    expect(p).toContain('2026-10-12: legs, 45 minutes');
    expect(p).toContain(WORKOUT_JSON_EXAMPLE);
    expect(p).toContain('I use lb');
    const example = parseAiReply(WORKOUT_JSON_EXAMPLE);
    expect(example.ok).toBe(true); // the example in the prompt is itself valid
  });
});

describe('reading an AI reply', () => {
  const reply = (obj: unknown, wrap = true) => (wrap ? `Sure! Here you go:\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`\nEnjoy.` : JSON.stringify(obj));
  const ok = { fitwell: 'workout', exercises: [{ name: 'Squat', sets: [{ reps: 5, weight: 100 }] }] };

  it('finds the JSON inside prose and code fences, or bare', () => {
    expect(parseAiReply(reply(ok)).ok).toBe(true);
    expect(parseAiReply(reply(ok, false)).ok).toBe(true);
    expect(parseAiReply(`text before ${JSON.stringify(ok)} text after`).ok).toBe(true);
  });
  it('explains what is wrong', () => {
    expect(parseAiReply('no json here')).toEqual({ ok: false, reason: 'no-json' });
    expect(parseAiReply('{"hello": 1}')).toMatchObject({ ok: false, reason: 'not-fitwell' });
    expect(parseAiReply(reply({ ...ok, day: '12/10/2026' }))).toEqual({ ok: false, reason: 'bad-day' });
    expect(parseAiReply(reply({ ...ok, exercises: [] }))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parseAiReply(reply({ ...ok, exercises: [{ name: 'X', sets: [{ reps: -3 }] }] }))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parseAiReply(reply({ ...ok, exercises: [{ name: 'X', sets: Array.from({ length: 21 }, () => ({ reps: 1 })) }] })).ok).toBe(false);
  });
});

describe('matching exercise names', () => {
  const lib: Exercise[] = ['Pushups', 'Pullups', 'Barbell Squat', 'Barbell Bench Press - Medium Grip', 'Plank'].map((name, i) => ({ ref: `ex:${i}`, name, equipment: 'x', primary: [], secondary: [] }));
  const index = prepareExercises(lib);
  it('treats hyphens, case and plurals as the same name', () => {
    expect(suggest('Push-Up', index, lib).exact?.name).toBe('Pushups');
    expect(suggest('pull-ups', index, lib).exact?.name).toBe('Pullups');
    expect(suggest('barbell squat', index, lib).exact?.name).toBe('Barbell Squat');
  });
  it('prefers the plain version over odd variations', () => {
    const l: Exercise[] = ['Bench Press with Chains', 'Reverse Band Bench Press', 'Barbell Bench Press - Medium Grip'].map((name, i) => ({ ref: `ex:${i}`, name, equipment: 'x', primary: [], secondary: [] }));
    expect(defaultChoice(suggest('Bench Press', prepareExercises(l), l))).toMatchObject({ name: 'Barbell Bench Press - Medium Grip' });
  });
  it('offers the closest ones when there is no exact match, and your own when nothing is close', () => {
    const s = suggest('Bench Press', index, lib);
    expect(s.exact).toBeUndefined();
    expect(defaultChoice(s)).toMatchObject({ kind: 'ref', name: 'Barbell Bench Press - Medium Grip' });
    expect(defaultChoice(suggest('Zzyzx thing', index, lib))).toEqual({ kind: 'own' });
  });
});

describe('building the workout', () => {
  let n = 0;
  const newId = () => `id${++n}`;
  const workout = parseAiReply(
    JSON.stringify({
      fitwell: 'workout',
      units: 'lb',
      exercises: [
        { name: 'Bench', superset: 'A', sets: [{ type: 'warmup', reps: 10, weight: 45 }, { reps: 8, weight: 135 }] },
        { name: 'Plank', mode: 'time', load: 'bodyweight', superset: 'A', sets: [{ seconds: 45 }] },
        { name: 'Skip me', sets: [{ reps: 1, weight: 1 }] },
        { name: 'Dip', load: 'bodyweight', superset: 'B', sets: [{ reps: 6, added: 10 }] },
      ],
    }),
  );
  if (!workout.ok) throw new Error('fixture');
  const built = buildExercises({
    workout: workout.workout,
    choices: [{ kind: 'ref', ref: 'ex:1', name: 'Barbell Bench Press' }, { kind: 'ref', ref: 'ex:2', name: 'Plank' }, { kind: 'skip' }, { kind: 'own' }],
    defaultUnits: 'metric',
    bodyKg: 80,
    newId,
    ownRef: (name) => `cx:${name}`,
  });

  it('converts to kilograms and keeps warm-ups', () => {
    expect(built[0]!.sets[0]).toMatchObject({ type: 'warmup', reps: 10 });
    expect(built[0]!.sets[1]!.weightKg).toBeCloseTo(61.23, 1);
  });
  it('makes timed and bodyweight exercises', () => {
    expect(built[1]).toMatchObject({ mode: 'time', load: 'bodyweight' });
    expect(built[1]!.sets[0]).toMatchObject({ durationSec: 45, reps: 0, bodyweightKg: 80, weightKg: 80 });
    expect(built[2]!.exerciseRef).toBe('cx:Dip');
    expect(built[2]!.sets[0]!.weightKg).toBeCloseTo(80 + 4.54, 1); // body weight + 10 lb
  });
  it('skips what you skipped, links supersets, and drops a lone superset label', () => {
    expect(built).toHaveLength(3);
    expect(built[0]!.supersetId).toBeDefined();
    expect(built[0]!.supersetId).toBe(built[1]!.supersetId);
    expect(built[2]!.supersetId).toBeUndefined(); // "B" has one member
  });
  it('gives everything fresh ids', () => {
    const ids = built.flatMap((e) => [e.uid, ...e.sets.map((s) => s.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
