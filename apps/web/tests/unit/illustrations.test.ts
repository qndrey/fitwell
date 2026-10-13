import { describe, expect, it } from 'vitest';
import { SIZE, draw } from '../../src/illustrations/figure';
import { figureFor, templateIdFor } from '../../src/illustrations/match';
import { figureAt } from '../../src/illustrations/svg';
import { TEMPLATES } from '../../src/illustrations/templates';
import exercises from '../../src/data/generated/exercises.index.json';

describe('exercise drawings', () => {
  it.each(Object.keys(TEMPLATES))('%s stays inside the picture, start to end', (id) => {
    const tpl = TEMPLATES[id]!;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const { frame } = draw(tpl, t);
      const pts = [frame.head, frame.neck, frame.shoulder, frame.elbow, frame.wrist, frame.hip, frame.knee, frame.ankle, frame.toe, ...(frame.far ? [frame.far.knee, frame.far.ankle, frame.far.toe] : [])];
      for (const [x, y] of pts) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThan(2);
        expect(x).toBeLessThan(SIZE.w - 2);
        expect(y).toBeGreaterThan(4);
        expect(y).toBeLessThan(SIZE.h);
      }
    }
  });

  it('keeps the feet on the floor and the pinned joint still', () => {
    const a = draw(TEMPLATES['squat-bodyweight']!, 0).frame;
    const b = draw(TEMPLATES['squat-bodyweight']!, 1).frame;
    expect(Math.max(a.toe[1], a.ankle[1])).toBeCloseTo(SIZE.floor, 5);
    expect(Math.max(b.toe[1], b.ankle[1])).toBeCloseTo(SIZE.floor, 5);
    expect(b.ankle[0]).toBeCloseTo(a.ankle[0], 5);
    expect(b.hip[1]).toBeGreaterThan(a.hip[1]); // hips go down in a squat
  });

  it('hangs from the bar for pull-ups', () => {
    const a = draw(TEMPLATES['pull-up']!, 0);
    const b = draw(TEMPLATES['pull-up']!, 1);
    expect(a.bar).toBeDefined();
    expect(a.frame.wrist[1]).toBeCloseTo(b.frame.wrist[1], 5);
    expect(b.frame.head[1]).toBeLessThan(a.frame.head[1]); // chin goes up
  });

  it('draws markup for every template and nothing unsafe', () => {
    for (const tpl of Object.values(TEMPLATES)) {
      const svg = figureAt(tpl, 0.5);
      expect(svg).toContain('fig-torso');
      expect(svg).not.toMatch(/<script|on\w+=|href=/i);
    }
  });

  it('every motion actually moves, except holds', () => {
    for (const [id, tpl] of Object.entries(TEMPLATES)) {
      const same = JSON.stringify(tpl.start) === JSON.stringify(tpl.end);
      expect(same, id).toBe(id === 'plank');
    }
  });
});

describe('matching exercises to drawings', () => {
  it.each([
    ['Barbell Bench Press - Medium Grip', 'bench-press'],
    ['Dumbbell Bench Press', 'bench-press'],
    ['Barbell Full Squat', 'squat-barbell'],
    ['Goblet Squat', 'squat-goblet'],
    ['Bodyweight Squat', 'squat-bodyweight'],
    ['Barbell Deadlift', 'deadlift'],
    ['Romanian Deadlift', 'romanian-deadlift'],
    ['Pushups', 'push-up'],
    ['Pullups', 'pull-up'],
    ['Chin-Up', 'pull-up'],
    ['Plank', 'plank'],
    ['Crunches', 'crunch'],
    ['Barbell Curl', 'curl'],
    ['Bent Over Barbell Row', 'row'],
    ['Standing Dumbbell Press', 'overhead-press'],
    ['Triceps Pushdown - Rope Attachment', 'triceps-pushdown'],
    ['Standing Calf Raises', 'calf-raise'],
    ['Dumbbell Lunges', 'lunge'],
    ['Barbell Hip Thrust', 'glute-bridge'],
  ])('%s → %s', (name, id) => {
    expect(templateIdFor(name)?.id).toBe(id);
  });

  it.each(['Leg Press', 'Cable Crossover', 'Ab Crunch Machine', 'Leverage Chest Press', 'Wide-Grip Lat Pulldown', 'Running, Treadmill', 'Seated Cable Rows', 'Lying Leg Curls'])('%s gets no drawing', (name) => {
    expect(figureFor(name)).toBeUndefined();
  });

  it('uses the right implement for the exercise', () => {
    expect(figureFor('Barbell Curl')?.template.hold).toBe('barbell');
    expect(figureFor('Dumbbell Bicep Curl')?.template.hold).toBe('dumbbell');
  });

  it('covers a useful share of the library without guessing', () => {
    const all = (exercises as unknown as { exercises: { name: string }[] }).exercises;
    const covered = all.filter((e) => figureFor(e.name)).length;
    expect(covered).toBeGreaterThan(all.length * 0.15);
    expect(covered).toBeLessThan(all.length * 0.4);
  });
});
