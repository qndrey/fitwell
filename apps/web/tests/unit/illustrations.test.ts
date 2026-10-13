import { describe, expect, it } from 'vitest';
import { PLATE_R, SIZE, STEP_H, draw, framePoints, keyPoses } from '../../src/illustrations/figure';
import { figureFor, templateIdFor } from '../../src/illustrations/match';
import { figureAt } from '../../src/illustrations/svg';
import { TEMPLATES } from '../../src/illustrations/templates';
import exercises from '@fitwell/core/data/generated/exercises.index.json';

describe('exercise drawings', () => {
  it.each(Object.keys(TEMPLATES))('%s stays inside the picture, start to end', (id) => {
    const tpl = TEMPLATES[id]!;
    for (let i = 0; i <= 20; i++) {
      const d = draw(tpl, i / 20);
      const { frame } = d;
      const reach = d.hold?.kind === 'barbell' ? PLATE_R : 0;
      expect(frame.wrist[1] - reach, `${id} implement at ${i / 20}`).toBeGreaterThan(0);
      expect(frame.head[1] - 3, `${id} head at ${i / 20}`).toBeGreaterThan(0);
      for (const [x, y] of [...framePoints(frame), frame.neck]) {
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
    expect(a.props.some((p) => p.cls === 'fig-prop-bar')).toBe(true);
    expect(a.floor).toBe(false);
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
      const same = keyPoses(tpl).every((p) => JSON.stringify(p) === JSON.stringify(tpl.start));
      expect(same, id).toBe(id === 'plank');
    }
  });

  it('keeps equipment still while the figure moves', () => {
    for (const [id, tpl] of Object.entries(TEMPLATES)) {
      expect(draw(tpl, 0.5).props, id).toEqual(draw(tpl, 0).props);
      expect(draw(tpl, 1).hold?.anchor, id).toEqual(draw(tpl, 0).hold?.anchor);
    }
  });

  const still = (id: string, joint: (d: ReturnType<typeof draw>) => readonly number[]) => {
    const tpl = TEMPLATES[id]!;
    const a = joint(draw(tpl, 0));
    for (const t of [0.5, 1]) {
      const b = joint(draw(tpl, t));
      expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!), `${id} at ${t}`).toBeLessThan(1.5);
    }
  };

  it('keeps hands and feet where they press or hang on', () => {
    still('push-up', (d) => d.frame.wrist);
    still('push-up', (d) => d.frame.toe);
    for (const t of [0, 0.5, 1]) expect(draw(TEMPLATES['push-up']!, t).frame.toe[1], `push-up toes at ${t}`).toBeCloseTo(SIZE.floor, 0);
    still('bench-dip', (d) => d.frame.wrist);
    still('inverted-row', (d) => d.frame.wrist);
    still('hip-thrust', (d) => d.frame.shoulder);
    still('dip', (d) => d.frame.wrist);
    still('mountain-climber', (d) => d.frame.wrist);
  });

  it('puts things on the floor or the box where they belong', () => {
    const dl = draw(TEMPLATES.deadlift!, 0).frame;
    expect(dl.wrist[1] + PLATE_R).toBeCloseTo(SIZE.floor, 0); // the plates touch the floor
    for (const t of [0, 1]) expect(draw(TEMPLATES['ab-rollout']!, t).frame.wrist[1] + 3.8).toBeCloseTo(SIZE.floor, 0);
    for (const t of [0, 1]) expect(draw(TEMPLATES['step-up']!, t).frame.ankle[1]).toBeCloseTo(SIZE.floor - STEP_H, 0);
    expect(draw(TEMPLATES['jump-squat']!, 1).frame.toe[1]).toBeLessThan(SIZE.floor - 4); // off the floor at the top
  });

  it('draws the motion path and a faint copy of the other end when asked', () => {
    const svg = figureAt(TEMPLATES.curl!, 1, { ghost: true, trace: true });
    expect(svg).toContain('fig-ghost');
    expect(svg).toContain('fig-trace');
    expect(figureAt(TEMPLATES.plank!, 1, { ghost: true, trace: true })).not.toContain('fig-ghost');
  });

  it('marks where the figure is on the path while it moves', () => {
    expect(figureAt(TEMPLATES.curl!, 0.5, { trace: true })).toContain('fig-trace-dot');
    expect(figureAt(TEMPLATES.curl!, 0.5)).not.toContain('fig-trace-dot');
    expect(figureAt(TEMPLATES['squat-barbell']!, 0.5, { trace: true })).not.toContain('fig-trace'); // trace: 'none'
  });

  it.each(Object.keys(TEMPLATES))('%s names the body parts doing the work, and only those are highlighted', (id) => {
    const tpl = TEMPLATES[id]!;
    expect(tpl.work?.length, id).toBeGreaterThan(0);
    const svg = figureAt(tpl, 1, { ghost: true });
    const hot = [...svg.matchAll(/class="fig-seg fig-(\w+) hot"/g)].map((m) => m[1]);
    expect(new Set(hot)).toEqual(new Set(tpl.work));
    expect(svg).not.toMatch(/fig-ghost-g">[^]*?hot[^]*?<\/g>/); // the faint copy stays plain
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
    ['Barbell Hip Thrust', 'hip-thrust'],
    ['Butt Lift (Bridge)', 'glute-bridge'],
    ['Front Barbell Squat', 'front-squat'],
    ['Overhead Squat', 'overhead-squat'],
    ['Good Morning', 'good-morning'],
    ['Power Clean', 'clean'],
    ['Push Press', 'push-press'],
    ['Kettlebell Thruster', 'thruster'],
    ['Seated Dumbbell Press', 'seated-press'],
    ['Incline Dumbbell Press', 'incline-press'],
    ['Dips - Triceps Version', 'dip'],
    ['Bench Dips', 'bench-dip'],
    ['Inverted Row', 'inverted-row'],
    ['Upright Barbell Row', 'upright-row'],
    ['Wide-Grip Lat Pulldown', 'lat-pulldown'],
    ['Seated Cable Rows', 'seated-cable-row'],
    ['Straight-Arm Pulldown', 'straight-arm-pulldown'],
    ['Face Pull', 'face-pull'],
    ['Preacher Curl', 'preacher-curl'],
    ['Concentration Curls', 'concentration-curl'],
    ['EZ-Bar Skullcrusher', 'skull-crusher'],
    ['Tricep Dumbbell Kickback', 'kickback'],
    ['Straight-Arm Dumbbell Pullover', 'pullover'],
    ['Barbell Step Ups', 'step-up'],
    ['Freehand Jump Squat', 'jump-squat'],
    ['Knee Tuck Jump', 'tuck-jump'],
    ["Farmer's Walk", 'farmers-walk'],
    ['Mountain Climbers', 'mountain-climber'],
    ['Dead Bug', 'dead-bug'],
    ['Flutter Kicks', 'flutter-kick'],
    ['Reverse Crunch', 'reverse-crunch'],
    ['Flat Bench Lying Leg Raise', 'lying-leg-raise'],
    ['Ab Roller', 'ab-rollout'],
    ['Hyperextensions (Back Extensions)', 'back-extension'],
    ['Glute Kickback', 'glute-kickback'],
    ['Superman', 'superman'],
    ['Standing Toe Touches', 'toe-touch'],
    ["Child's Pose", 'childs-pose'],
    ['Quad Stretch', 'quad-stretch'],
    ['Hug Knees To Chest', 'knee-to-chest'],
    ['Seated Floor Hamstring Stretch', 'seated-hamstring-stretch'],
    ['Front Leg Raises', 'leg-swing'],
    ['Arm Circles', 'arm-circles'],
    ['Knee/Hip Raise On Parallel Bars', 'hanging-knee-raise'],
  ])('%s → %s', (name, id) => {
    expect(templateIdFor(name)?.id).toBe(id);
  });

  it.each(['Leg Press', 'Cable Crossover', 'Ab Crunch Machine', 'Leverage Chest Press', 'Rope Straight-Arm Pulldown', 'Running, Treadmill', 'Cable Crunch', 'Lying Leg Curls', 'Band Good Morning', 'Reverse Hyperextension', 'One-Arm Overhead Kettlebell Squats', 'Dumbbell Flyes'])('%s gets no drawing', (name) => {
    expect(figureFor(name)).toBeUndefined();
  });

  it('uses the right implement for the exercise', () => {
    expect(figureFor('Barbell Curl')?.template.hold).toBe('barbell');
    expect(figureFor('Dumbbell Bicep Curl')?.template.hold).toBe('dumbbell');
    expect(figureFor('Kettlebell Hang Clean')?.template.hold).toBe('kettlebell');
    expect(figureFor('Standing Biceps Cable Curl')?.template.hold).toBe('cable-low');
    expect(figureFor('Hammer Grip Incline DB Bench Press')?.template.hold).toBe('dumbbell');
  });

  it('covers a useful share of the library without guessing', () => {
    const all = (exercises as unknown as { exercises: { name: string }[] }).exercises;
    const covered = all.filter((e) => figureFor(e.name)).length;
    expect(covered).toBeGreaterThan(all.length * 0.15);
    expect(covered).toBeLessThan(all.length * 0.4);
  });
});
