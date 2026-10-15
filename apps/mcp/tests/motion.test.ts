import { loadExercises } from '@fitwell/core/data/exercises';
import { describe, expect, it } from 'vitest';
import { ARM, BAR_RADIUS, BENCH_HEIGHT, BODY, distance, JOINTS, LOOP_SECONDS, MOTIONS, PLATE_RADIUS, motionFor, progressAt, skeletonAt, standing, type MotionSpec, type Skeleton, type Vec3 } from '../src/exercises/motion';

const SAMPLES = Array.from({ length: 21 }, (_, i) => i / 20);
const DEG = 180 / Math.PI;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const angleAt = (a: Vec3, mid: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(sub(a, mid), sub(b, mid)) / (len(sub(a, mid)) * len(sub(b, mid)))))) * DEG;
/** Joint flexion: 0 for a straight limb. */
const flexion = (a: Vec3, mid: Vec3, b: Vec3) => 180 - angleAt(a, mid, b);
/** Distance from a point to a segment, ignoring the sideways direction. */
function nearestOnSegmentXY(p: Vec3, a: Vec3, b: Vec3) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y)));
  return { d: Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t)), t };
}
const spec = (name: string): MotionSpec => MOTIONS[name]!;
const each = (names: string[], f: (k: Skeleton, p: number, name: string) => void) => {
  for (const name of names) for (const p of SAMPLES) f(skeletonAt(spec(name), p), p, name);
};
const ALL = Object.keys(MOTIONS);
const SQUATS = ALL.filter((n) => MOTIONS[n]!.pattern === 'squat');
const BARBELL_SQUATS = ['Barbell Squat', 'Barbell Full Squat', 'Wide Stance Barbell Squat', 'Front Barbell Squat'];

describe('the figure', () => {
  it('is 1.75 m tall standing, within 2 cm', () => {
    expect(standing().headTop.y).toBeGreaterThan(1.73);
    expect(standing().headTop.y).toBeLessThan(1.77);
    expect(BODY.shoulderHalf * 2).toBeCloseTo(0.4, 5);
  });

  it('keeps every segment at its length in every pose', () => {
    each(ALL, (k, p, name) => {
      const where = `${name} p=${p}`;
      for (const s of ['L', 'R'] as const) {
        expect(Math.abs(distance(k[`hip${s}`], k[`knee${s}`]) - BODY.thigh), `thigh ${where}`).toBeLessThan(0.001);
        expect(Math.abs(distance(k[`knee${s}`], k[`ankle${s}`]) - BODY.shin), `shin ${where}`).toBeLessThan(0.001);
        expect(Math.abs(distance(k[`shoulder${s}`], k[`elbow${s}`]) - BODY.upperArm), `upper arm ${where}`).toBeLessThan(0.001);
        expect(Math.abs(distance(k[`elbow${s}`], k[`wrist${s}`]) - BODY.forearm), `forearm ${where}`).toBeLessThan(0.001);
        expect(Math.abs(distance(k[`wrist${s}`], k[`grip${s}`]) - BODY.hand), `hand ${where}`).toBeLessThan(0.001);
      }
      expect(Math.abs(distance(k.pelvis, k.lumbar) - BODY.pelvis), `pelvis ${where}`).toBeLessThan(0.001);
      expect(Math.abs(distance(k.lumbar, k.chest) - BODY.lumbar), `lumbar ${where}`).toBeLessThan(0.001);
      expect(Math.abs(distance(k.chest, k.neckBase) - BODY.chest), `chest ${where}`).toBeLessThan(0.001);
      expect(Math.abs(distance(k.neckBase, k.headTop) - (BODY.neck + BODY.head)), `head ${where}`).toBeLessThan(0.001);
      for (const j of JOINTS) for (const c of ['x', 'y', 'z'] as const) expect(Number.isFinite(k[j][c]), `${j}.${c} ${where}`).toBe(true);
    });
  });

  it('keeps the joints within human ranges', () => {
    each(ALL, (k, p, name) => {
      const where = `${name} p=${p}`;
      for (const s of ['L', 'R'] as const) {
        const knee = flexion(k[`hip${s}`], k[`knee${s}`], k[`ankle${s}`]);
        expect(knee, `knee ${where}`).toBeGreaterThan(-1);
        expect(knee, `knee ${where}`).toBeLessThan(150);
        const elbow = flexion(k[`shoulder${s}`], k[`elbow${s}`], k[`wrist${s}`]);
        expect(elbow, `elbow ${where}`).toBeGreaterThan(-1);
        expect(elbow, `elbow ${where}`).toBeLessThan(165);
      }
    });
  });
});

describe('squat', () => {
  it('keeps the feet planted on the floor', () => {
    const start = skeletonAt(spec('Barbell Squat'), 0);
    each(SQUATS, (k, _p, name) => {
      for (const s of ['L', 'R'] as const) {
        expect(Math.abs(k[`heel${s}`].y), name).toBeLessThan(0.01);
        expect(Math.abs(k[`toe${s}`].y), name).toBeLessThan(0.01);
        expect(distance(k[`ankle${s}`], skeletonAt(spec(name), 0)[`ankle${s}`]), name).toBeLessThan(0.01);
      }
      expect(start.ankleL.y).toBeCloseTo(BODY.ankleHeight, 3);
    });
  });

  it('keeps a barbell over the mid-foot all the way down', () => {
    each(BARBELL_SQUATS, (k, p, name) => expect(Math.abs(k.bar.x - k.midfoot.x), `${name} p=${p}`).toBeLessThan(0.05));
  });

  it('goes to full depth with a sensible trunk lean', () => {
    for (const name of BARBELL_SQUATS) {
      const k = skeletonAt(spec(name), 1);
      expect(flexion(k.hipL, k.kneeL, k.ankleL), name).toBeGreaterThan(100);
      const lean = Math.atan2(k.shoulderL.x - k.hipL.x, k.shoulderL.y - k.hipL.y) * DEG;
      expect(lean, name).toBeLessThan(60);
      expect(lean, name).toBeGreaterThan(0);
      expect(k.hipL.y, `${name} hip near knee height`).toBeLessThan(k.kneeL.y + 0.06);
    }
    // The front squat stays more upright than the back squat.
    const lean = (n: string) => { const k = skeletonAt(spec(n), 1); return Math.atan2(k.shoulderL.x - k.hipL.x, k.shoulderL.y - k.hipL.y); };
    expect(lean('Front Barbell Squat')).toBeLessThan(lean('Barbell Squat'));
  });

  it('puts the knees outward and the feet wider in the wide stance', () => {
    const normal = skeletonAt(spec('Barbell Squat'), 0.5);
    const wide = skeletonAt(spec('Wide Stance Barbell Squat'), 0.5);
    expect(wide.ankleL.z - wide.ankleR.z).toBeGreaterThan(normal.ankleL.z - normal.ankleR.z + 0.1);
    expect(wide.kneeL.z).toBeGreaterThan(normal.kneeL.z);
  });
});

describe('hip hinge', () => {
  it('starts the conventional deadlift with the bar on the floor and the arms vertical', () => {
    const k = skeletonAt(spec('Barbell Deadlift'), 1);
    expect(Math.abs(k.bar.y - PLATE_RADIUS)).toBeLessThan(0.02);
    const arm = sub(k.gripL, k.shoulderL);
    expect(Math.atan2(Math.hypot(arm.x, arm.z), -arm.y) * DEG).toBeLessThan(8);
    expect(Math.abs(k.bar.x - k.midfoot.x)).toBeLessThan(0.05);
  });

  it('never moves the bar into the legs', () => {
    each(['Barbell Deadlift', 'Romanian Deadlift', 'Stiff-Legged Barbell Deadlift'], (k, p, name) => {
      const where = `${name} p=${p}`;
      // The thigh tapers from 8.5 cm at the hip to 5.5 cm at the knee, the shin from 5.5 cm to 4 cm.
      const thigh = nearestOnSegmentXY(k.bar, k.kneeL, k.hipL);
      expect(thigh.d, `thigh ${where}`).toBeGreaterThan(0.055 + 0.03 * thigh.t + BAR_RADIUS - 0.003);
      const shin = nearestOnSegmentXY(k.bar, k.ankleL, k.kneeL);
      expect(shin.d, `shin ${where}`).toBeGreaterThan(0.04 + 0.015 * shin.t + BAR_RADIUS - 0.003);
      expect(Math.abs(k.bar.x - k.midfoot.x), `over the foot ${where}`).toBeLessThan(0.08);
    });
  });

  it('hinges further for the stiff-legged version with straighter knees than the Romanian', () => {
    const rdl = skeletonAt(spec('Romanian Deadlift'), 1);
    const stiff = skeletonAt(spec('Stiff-Legged Barbell Deadlift'), 1);
    expect(flexion(stiff.hipL, stiff.kneeL, stiff.ankleL)).toBeLessThan(flexion(rdl.hipL, rdl.kneeL, rdl.ankleL));
    const conv = skeletonAt(spec('Barbell Deadlift'), 1);
    expect(flexion(conv.hipL, conv.kneeL, conv.ankleL)).toBeGreaterThan(60);
  });

  it('holds the bar with straight arms at the thighs at the top', () => {
    const k = skeletonAt(spec('Barbell Deadlift'), 0);
    expect(distance(k.shoulderL, k.gripL)).toBeGreaterThan(ARM - 0.03);
    expect(k.bar.y).toBeLessThan(k.hipL.y);
  });
});

describe('bench press', () => {
  const BENCHES = ALL.filter((n) => MOTIONS[n]!.pattern === 'bench');

  it('lies on the bench with the feet flat on the floor', () => {
    each(BENCHES, (k, p, name) => {
      for (const j of ['pelvis', 'chest'] as const) {
        expect(k[j].y - BENCH_HEIGHT, `${j} ${name} p=${p}`).toBeGreaterThan(0.08);
        expect(k[j].y - BENCH_HEIGHT, `${j} ${name} p=${p}`).toBeLessThan(0.14);
      }
      for (const s of ['L', 'R'] as const) {
        expect(Math.abs(k[`heel${s}`].y), name).toBeLessThan(0.01);
        expect(Math.abs(k[`toe${s}`].y), name).toBeLessThan(0.01);
      }
    });
  });

  it('starts with the bar over the shoulders and the arms nearly straight', () => {
    for (const name of BENCHES) {
      const k = skeletonAt(spec(name), 0);
      expect(Math.abs(k.bar.x - k.shoulderL.x), name).toBeLessThan(0.05);
      expect(distance(k.shoulderL, k.gripL), name).toBeGreaterThan(ARM - 0.05);
    }
  });

  it('touches the chest at the bottom with vertical forearms and level hands', () => {
    for (const name of BENCHES) {
      const k = skeletonAt(spec(name), 1);
      const chestTop = k.chest.y + 0.12;
      expect(k.bar.y - chestTop, `${name} not inside the chest`).toBeGreaterThan(0);
      expect(k.bar.y - chestTop, `${name} touching`).toBeLessThan(0.03);
      const forearm = sub(k.wristL, k.elbowL);
      expect(Math.atan2(Math.hypot(forearm.x, forearm.z), forearm.y) * DEG, `${name} forearm`).toBeLessThan(15);
      expect(Math.abs(k.gripL.y - k.gripR.y), name).toBeLessThan(0.01);
    }
  });

  it('holds the bar wider with a wider grip', () => {
    const w = (n: string) => skeletonAt(spec(n), 0.5).gripL.z - skeletonAt(spec(n), 0.5).gripR.z;
    expect(w('Close-Grip Barbell Bench Press')).toBeLessThan(w('Barbell Bench Press - Medium Grip'));
    expect(w('Barbell Bench Press - Medium Grip')).toBeLessThan(w('Wide-Grip Barbell Bench Press'));
  });
});

describe('loop and mapping', () => {
  it('runs a repeating loop between the top and the bottom, and starts the conventional deadlift at the bottom', () => {
    const squatSpec = spec('Barbell Squat');
    expect(progressAt(0, squatSpec)).toBe(0);
    expect(progressAt(LOOP_SECONDS, squatSpec)).toBeCloseTo(0, 6);
    const values = Array.from({ length: 200 }, (_, i) => progressAt((i / 200) * LOOP_SECONDS, squatSpec));
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(1);
    expect(progressAt(0, spec('Barbell Deadlift'))).toBe(1);
    expect(progressAt(0, spec('Romanian Deadlift'))).toBe(0);
    for (const n of [-3.2, 17.9]) expect(progressAt(n, squatSpec)).toBeGreaterThanOrEqual(0);
  });

  it('only maps exercises of the bundled library, and none that does not fit a pattern', async () => {
    const lib = await loadExercises();
    const names = new Set(lib.exercises.map((e) => e.name));
    for (const n of ALL) expect(names.has(n), n).toBe(true);
    expect(motionFor('Leg Press')).toBeNull();
    expect(motionFor('Hack Squat')).toBeNull();
    expect(motionFor('Barbell Hack Squat')).toBeNull();
    expect(motionFor('Barbell Bench Press - Medium Grip')?.pattern).toBe('bench');
  });
});
