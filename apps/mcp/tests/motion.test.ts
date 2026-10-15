import { loadExercises } from '@fitwell/core/data/exercises';
import { describe, expect, it } from 'vitest';
import { ARM, BAR_RADIUS, BREATH_SECONDS, relaxed, BENCH_HEIGHT, BODY, distance, type Body, JOINTS, LOOP_SECONDS, MOTIONS, PLATE_RADIUS, PULLUP_BAR_HEIGHT, motionFor, progressAt, skeletonAt, standing, type MotionSpec, type Skeleton, type Vec3 } from '../src/exercises/motion';

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

  it('puts the elbows where each hold needs them', () => {
    for (const p of SAMPLES) {
      // Front squat: the elbows point forward at about shoulder height, never up beside the head.
      const front = skeletonAt(spec('Front Barbell Squat'), p);
      for (const side of ['L', 'R'] as const) {
        const rise = front[`elbow${side}`].y - front[`shoulder${side}`].y;
        expect(front[`elbow${side}`].x - front[`shoulder${side}`].x, `front squat elbow forward p=${p}`).toBeGreaterThan(0.12);
        expect(rise, `front squat elbow height p=${p}`).toBeLessThan(0.15);
        expect(rise, `front squat elbow height p=${p}`).toBeGreaterThan(-0.15);
        expect(front[`wrist${side}`].y, `front squat wrist under the bar p=${p}`).toBeLessThan(front.bar.y);
      }
      // Back squat, goblet and bodyweight: the elbows hang below the shoulders.
      for (const name of ['Barbell Squat', 'Goblet Squat', 'Bodyweight Squat']) {
        const k = skeletonAt(spec(name), p);
        for (const side of ['L', 'R'] as const) expect(k[`shoulder${side}`].y - k[`elbow${side}`].y, `${name} elbow below shoulder p=${p}`).toBeGreaterThan(0.12);
      }
    }
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

const tilt = (a: Vec3, b: Vec3) => { const d = sub(b, a); return Math.atan2(Math.hypot(d.x, d.z), Math.abs(d.y)) * DEG; };
const OF = (pattern: string) => ALL.filter((n) => MOTIONS[n]!.pattern === pattern);

describe('overhead press', () => {
  const PRESSES = OF('press');
  it('locks out with the bar straight over the shoulders, and over the mid-foot when standing', () => {
    for (const name of PRESSES) {
      const k = skeletonAt(spec(name), 0);
      expect(Math.abs(k.bar.x - k.shoulderL.x), name).toBeLessThan(0.03);
      expect(tilt(k.elbowL, k.wristL), `${name} forearm`).toBeLessThan(12);
      if (!MOTIONS[name]!.variant.seated) expect(Math.abs(k.bar.x - k.midfoot.x), `${name} over the foot`).toBeLessThan(0.05);
    }
  });

  it('starts at the shoulders and never moves the bar through the face', () => {
    for (const name of PRESSES.filter((n) => MOTIONS[n]!.variant.load === 'barbell-front')) {
      const rack = skeletonAt(spec(name), 1);
      expect(rack.bar.y - rack.shoulderL.y, `${name} rack`).toBeLessThan(0.05);
      for (const p of SAMPLES) {
        const k = skeletonAt(spec(name), p);
        const up = sub(k.headTop, k.neckBase);
        const headCentre = { x: k.neckBase.x + up.x * 0.62, y: k.neckBase.y + up.y * 0.62, z: 0 };
        const outside = ((k.bar.x - headCentre.x) / 0.1) ** 2 + ((k.bar.y - headCentre.y) / 0.115) ** 2;
        expect(outside, `${name} p=${p} bar vs head`).toBeGreaterThan(1);
      }
    }
  });

  it('sits with the thighs level and the shins vertical when seated, on a bench at seat height', () => {
    for (const name of PRESSES.filter((n) => MOTIONS[n]!.variant.seated)) {
      const k = skeletonAt(spec(name), 0.5);
      expect(Math.abs(k.hipL.y - k.kneeL.y), `${name} thigh`).toBeLessThan(0.04);
      expect(tilt(k.kneeL, k.ankleL), `${name} shin`).toBeLessThan(6);
      expect(k.hipL.y - BENCH_HEIGHT, `${name} on the seat`).toBeGreaterThan(0.05);
      expect(k.hipL.y - BENCH_HEIGHT, `${name} on the seat`).toBeLessThan(0.1);
    }
  });
});

describe('bent-over row', () => {
  const ROWS = OF('row');
  it('hangs the arms straight down at the bottom and lifts the bar to the lower ribs, with the trunk held still', () => {
    for (const name of ROWS) {
      const bottom = skeletonAt(spec(name), 1);
      const top = skeletonAt(spec(name), 0);
      expect(Math.atan2(Math.abs(bottom.gripL.x - bottom.shoulderL.x), Math.abs(bottom.gripL.y - bottom.shoulderL.y)) * DEG, `${name} arm`).toBeLessThan(5);
      expect(top.bar.y, `${name} lifted`).toBeGreaterThan(bottom.bar.y + 0.3);
      // The bar ends up against the trunk, between the hips and the shoulders.
      const t = nearestOnSegmentXY(top.bar, top.pelvis, top.shoulderL);
      expect(t.d, `${name} bar near the trunk`).toBeLessThan(0.18);
      expect(t.t, `${name} lower ribs`).toBeGreaterThan(0.3);
      expect(t.t, `${name} lower ribs`).toBeLessThan(0.8);
      for (const p of SAMPLES) {
        const k = skeletonAt(spec(name), p);
        expect(Math.abs(Math.atan2(k.shoulderL.x - k.hipL.x, k.shoulderL.y - k.hipL.y) * DEG - 50), `${name} trunk p=${p}`).toBeLessThan(3);
        // The bar passes in front of the knees.
        expect(k.bar.x - k.kneeL.x, `${name} p=${p} clear of the knees`).toBeGreaterThan(0.06);
      }
    }
  });
});

describe('curl', () => {
  it('curls from straight arms to the shoulders with the elbows kept near the sides', () => {
    for (const name of OF('curl')) {
      const bottom = skeletonAt(spec(name), 1);
      const top = skeletonAt(spec(name), 0);
      expect(flexion(bottom.shoulderL, bottom.elbowL, bottom.wristL), `${name} extended`).toBeLessThan(20);
      expect(flexion(top.shoulderL, top.elbowL, top.wristL), `${name} curled`).toBeGreaterThan(120);
      expect(Math.abs(top.bar.y - top.shoulderL.y), `${name} bar at the shoulders`).toBeLessThan(0.1);
      for (const p of SAMPLES) {
        const k = skeletonAt(spec(name), p);
        expect(Math.abs(k.elbowL.x - k.shoulderL.x), `${name} p=${p} elbow`).toBeLessThan(0.12);
        expect(k.shoulderL.y - k.elbowL.y, `${name} p=${p} elbow below the shoulder`).toBeGreaterThan(0.2);
        expect(Math.abs(k.gripL.y - k.gripR.y), `${name} p=${p} level`).toBeLessThan(0.01);
      }
    }
  });
});

describe('pull-up and lat pulldown', () => {
  const HANGS = OF('pull').filter((n) => !MOTIONS[n]!.variant.seated);
  const PULLDOWNS = OF('pull').filter((n) => MOTIONS[n]!.variant.seated);
  it('hangs with straight arms and the feet off the floor, and pulls the chin over the bar', () => {
    for (const name of HANGS) {
      const hang = skeletonAt(spec(name), 1);
      expect(flexion(hang.shoulderL, hang.elbowL, hang.wristL), `${name} hang`).toBeLessThan(15);
      expect(Math.min(hang.toeL.y, hang.toeR.y), `${name} feet`).toBeGreaterThan(0.1);
      const top = skeletonAt(spec(name), 0);
      expect(top.neckTop.y + 0.02, `${name} chin over the bar`).toBeGreaterThanOrEqual(PULLUP_BAR_HEIGHT - 0.005);
      for (const p of SAMPLES) {
        const k = skeletonAt(spec(name), p);
        expect(k.gripL.y, `${name} hands on the bar`).toBeCloseTo(PULLUP_BAR_HEIGHT, 2);
        expect(Math.abs(k.gripL.x), `${name} hands on the bar`).toBeLessThan(0.02);
      }
    }
  });

  it('holds the grip at the width the exercise asks for', () => {
    const w = (n: string) => skeletonAt(spec(n), 0.5).gripL.z - skeletonAt(spec(n), 0.5).gripR.z;
    expect(w('Chin-Up')).toBeLessThan(w('Pullups'));
    expect(w('Close-Grip Front Lat Pulldown')).toBeLessThan(w('Wide-Grip Lat Pulldown'));
  });

  it('pulls the pulldown bar from overhead to the upper chest while seated, thighs under the pad', () => {
    for (const name of PULLDOWNS) {
      const top = skeletonAt(spec(name), 1);
      const bottom = skeletonAt(spec(name), 0);
      expect(top.bar.y - top.shoulderL.y, `${name} overhead`).toBeGreaterThan(0.4);
      expect(flexion(top.shoulderL, top.elbowL, top.wristL), `${name} arms stretched`).toBeLessThan(25);
      expect(bottom.bar.y, `${name} below the chin`).toBeLessThan(bottom.neckTop.y);
      expect(bottom.bar.y, `${name} not below the chest`).toBeGreaterThan(bottom.chest.y - 0.15);
      expect(bottom.bar.x - bottom.shoulderL.x, `${name} in front of the chest`).toBeGreaterThan(0.05);
      for (const p of SAMPLES) {
        const k = skeletonAt(spec(name), p);
        expect(Math.abs(k.hipL.y - k.kneeL.y), `${name} thigh`).toBeLessThan(0.04);
        expect(tilt(k.kneeL, k.ankleL), `${name} shin`).toBeLessThan(6);
        expect(distance(k.gripL, { x: k.bar.x, y: k.bar.y, z: k.gripL.z }), `${name} p=${p} hands on the bar`).toBeLessThan(0.01);
      }
    }
  });
});

describe('lunge and split squat', () => {
  const LUNGES = OF('lunge');
  it('keeps both feet planted, the back foot on its toes, and the back knee off the floor', () => {
    for (const name of LUNGES) {
      const start = skeletonAt(spec(name), 0);
      for (const p of SAMPLES) {
        const k = skeletonAt(spec(name), p);
        for (const s of ['L', 'R'] as const) {
          expect(distance(k[`ankle${s}`], start[`ankle${s}`]), `${name} p=${p} ${s} foot`).toBeLessThan(0.005);
          expect(k[`toe${s}`].y, `${name} toe`).toBeLessThan(0.01);
        }
        expect(Math.min(k.kneeL.y, k.kneeR.y), `${name} p=${p} knee`).toBeGreaterThan(0.03);
        expect(k.ankleL.x - k.ankleR.x, `${name} stride`).toBeGreaterThan(0.6);
      }
    }
  });

  it('goes down until the front thigh is level over a vertical shin', () => {
    for (const name of LUNGES) {
      const k = skeletonAt(spec(name), 1);
      expect(Math.abs(k.hipL.y - k.kneeL.y), `${name} thigh`).toBeLessThan(0.06);
      expect(tilt(k.kneeL, k.ankleL), `${name} shin`).toBeLessThan(10);
      expect(k.kneeR.y, `${name} back knee close to the floor`).toBeLessThan(0.15);
      const top = skeletonAt(spec(name), 0);
      expect(flexion(top.hipL, top.kneeL, top.ankleL), `${name} tall`).toBeLessThan(25);
    }
  });
});

describe('push-up', () => {
  const PUSHUPS = OF('pushup');
  it('keeps the hands and toes where they are and the body in one straight line', () => {
    for (const name of PUSHUPS) {
      const start = skeletonAt(spec(name), 0);
      for (const p of SAMPLES) {
        const k = skeletonAt(spec(name), p);
        for (const s of ['L', 'R'] as const) {
          expect(distance(k[`wrist${s}`], start[`wrist${s}`]), `${name} p=${p} hand`).toBeLessThan(0.005);
          expect(distance(k[`ankle${s}`], start[`ankle${s}`]), `${name} p=${p} toes`).toBeLessThan(0.005);
          expect(Math.abs(k[`toe${s}`].y), `${name} toes on the floor`).toBeLessThan(0.01);
        }
        // The hips lie on the line from the ankles to the shoulders.
        const line = nearestOnSegmentXY(k.hipL, k.ankleL, k.shoulderL);
        expect(line.d, `${name} p=${p} straight`).toBeLessThan(0.03);
      }
    }
  });

  it('goes from straight arms to the chest just above the floor', () => {
    for (const name of PUSHUPS) {
      const top = skeletonAt(spec(name), 0);
      const bottom = skeletonAt(spec(name), 1);
      expect(flexion(top.shoulderL, top.elbowL, top.wristL), `${name} top`).toBeLessThan(20);
      expect(bottom.shoulderL.y, `${name} bottom`).toBeLessThan(0.22);
      expect(bottom.chest.y, `${name} chest above the floor`).toBeGreaterThan(0.06);
    }
  });

  it('puts the hands wider for the wide push-up and closer for the close one', () => {
    const w = (n: string) => skeletonAt(spec(n), 0).wristL.z - skeletonAt(spec(n), 0).wristR.z;
    expect(w('Push-Ups - Close Triceps Position')).toBeLessThan(w('Pushups'));
    expect(w('Pushups')).toBeLessThan(w('Push-Up Wide'));
  });
});

describe('incline bench press', () => {
  const INCLINES = OF('incline');
  it('lies back at the bench angle with the bar touching the upper chest over vertical forearms', () => {
    for (const name of INCLINES) {
      const k = skeletonAt(spec(name), 1);
      const angle = Math.atan2(k.chest.y - k.pelvis.y, k.pelvis.x - k.chest.x) * DEG;
      expect(Math.abs(angle - MOTIONS[name]!.variant.incline), `${name} angle`).toBeLessThan(2);
      expect(tilt(k.elbowL, k.wristL), `${name} forearm`).toBeLessThan(15);
      // Distance of the bar from the chest surface, along the direction the chest faces.
      const th = (MOTIONS[name]!.variant.incline * Math.PI) / 180;
      const face = { x: Math.sin(th), y: Math.cos(th), z: 0 };
      const trunk = { x: -Math.cos(th), y: Math.sin(th), z: 0 };
      const chestSurface = { x: k.chest.x + trunk.x * 0.06 + face.x * 0.12, y: k.chest.y + trunk.y * 0.06 + face.y * 0.12, z: 0 };
      const off = dot(sub({ x: k.bar.x, y: k.bar.y, z: 0 }, chestSurface), face);
      expect(off, `${name} touching`).toBeGreaterThan(0);
      expect(off, `${name} touching`).toBeLessThan(0.03);
    }
  });

  it('starts with the bar over the shoulders and the arms nearly straight', () => {
    for (const name of INCLINES) {
      const k = skeletonAt(spec(name), 0);
      expect(Math.abs(k.bar.x - k.shoulderL.x), name).toBeLessThan(0.05);
      expect(distance(k.shoulderL, k.gripL), name).toBeGreaterThan(ARM - 0.05);
    }
  });
});

describe('standing at ease', () => {
  it('hangs the arms down beside the body with the feet flat, and keeps every segment its length', () => {
    for (const t of [0, BREATH_SECONDS / 4, BREATH_SECONDS / 2]) {
      const k = relaxed(BODY, t);
      for (const s of ['L', 'R'] as const) {
        expect(k[`shoulder${s}`].y).toBeGreaterThan(k[`elbow${s}`].y);
        expect(k[`elbow${s}`].y).toBeGreaterThan(k[`wrist${s}`].y);
        expect(Math.abs(k[`grip${s}`].z) - 0.2, 'hand clear of the thigh').toBeGreaterThan(0.04);
        expect(Math.abs(distance(k[`shoulder${s}`], k[`elbow${s}`]) - BODY.upperArm)).toBeLessThan(0.001);
        expect(Math.abs(distance(k[`elbow${s}`], k[`wrist${s}`]) - BODY.forearm)).toBeLessThan(0.001);
        expect(k[`toe${s}`].y).toBeLessThan(0.01);
      }
    }
  });

  it('breathes: the shoulders rise a few millimetres and fall again', () => {
    const y = (t: number) => relaxed(BODY, t).shoulderL.y;
    const ys = Array.from({ length: 20 }, (_, i) => y((i / 20) * BREATH_SECONDS));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.005);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.012);
    expect(y(BREATH_SECONDS)).toBeCloseTo(y(0), 6);
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
    expect(motionFor('Pullups')?.pattern).toBe('pull');
    expect(motionFor('Leg Extensions')).toBeNull();
  });
});

// The same rules hold for other bodies: the solvers take the body's measurements.
const MODEL_BODY: Body = { ankleHeight: 0.071, shin: 0.432, thigh: 0.428, pelvis: 0.1, lumbar: 0.22, chest: 0.238, shoulderDrop: 0.1, neck: 0.095, head: 0.15, shoulderHalf: 0.213, hipHalf: 0.107, upperArm: 0.252, forearm: 0.255, hand: 0.08, heelBack: 0.06, toeFront: 0.2, midfoot: 0.07 };
const scaled = (k: number): Body => Object.fromEntries(Object.entries(BODY).map(([key, v]) => [key, v * k])) as Body;
const OTHER_BODIES: [string, Body][] = [['110 % of the default', scaled(1.1)], ['92 % of the default', scaled(0.92)], ['the MPFB body', MODEL_BODY]];

describe.each(OTHER_BODIES)('the form rules on %s', (_name, body) => {
  const at = (name: string, p: number) => skeletonAt(spec(name), p, body);
  const every = (names: string[], f: (k: Skeleton, p: number, name: string) => void) => {
    for (const name of names) for (const p of SAMPLES) f(at(name, p), p, name);
  };

  it('keeps every segment at the length of that body', () => {
    every(ALL, (k, p, name) => {
      for (const s of ['L', 'R'] as const) {
        expect(Math.abs(distance(k[`hip${s}`], k[`knee${s}`]) - body.thigh), `thigh ${name} p=${p}`).toBeLessThan(0.002);
        expect(Math.abs(distance(k[`knee${s}`], k[`ankle${s}`]) - body.shin), `shin ${name} p=${p}`).toBeLessThan(0.002);
        expect(Math.abs(distance(k[`shoulder${s}`], k[`elbow${s}`]) - body.upperArm), `upper arm ${name} p=${p}`).toBeLessThan(0.002);
        expect(Math.abs(distance(k[`elbow${s}`], k[`wrist${s}`]) - body.forearm), `forearm ${name} p=${p}`).toBeLessThan(0.002);
      }
    });
  });

  it('stands as tall as its measurements say and keeps its feet on the floor', () => {
    const k = standing(body);
    const tall = body.ankleHeight + body.shin + body.thigh + body.pelvis + body.lumbar + body.chest + body.neck + body.head;
    expect(Math.abs(k.headTop.y - tall)).toBeLessThan(0.02); // a slight forward lean costs about a centimetre
    every(SQUATS, (s, _p, name) => {
      for (const side of ['L', 'R'] as const) {
        expect(Math.abs(s[`heel${side}`].y), name).toBeLessThan(0.01);
        expect(Math.abs(s[`toe${side}`].y), name).toBeLessThan(0.01);
      }
    });
  });

  it('keeps a barbell over the mid-foot in the squat, and goes deep', () => {
    every(BARBELL_SQUATS, (k, p, name) => expect(Math.abs(k.bar.x - k.midfoot.x), `${name} p=${p}`).toBeLessThan(0.06));
    for (const name of BARBELL_SQUATS) expect(flexion(at(name, 1).hipL, at(name, 1).kneeL, at(name, 1).ankleL), name).toBeGreaterThan(100);
  });

  it('starts the deadlift with the bar on the floor and nearly vertical arms, and never puts the bar in the legs', () => {
    const k = at('Barbell Deadlift', 1);
    expect(Math.abs(k.bar.y - PLATE_RADIUS)).toBeLessThan(0.02);
    const arm = sub(k.gripL, k.shoulderL);
    expect(Math.atan2(Math.hypot(arm.x, arm.z), -arm.y) * DEG).toBeLessThan(10);
    every(['Barbell Deadlift', 'Romanian Deadlift'], (s, p, name) => {
      expect(nearestOnSegmentXY(s.bar, s.ankleL, s.kneeL).d, `shin ${name} p=${p}`).toBeGreaterThan(0.04 + BAR_RADIUS - 0.006);
    });
  });

  it('touches the chest at the bottom of the bench press with vertical forearms and level hands', () => {
    for (const name of ALL.filter((n) => MOTIONS[n]!.pattern === 'bench')) {
      const k = at(name, 1);
      expect(k.bar.y - (k.chest.y + 0.12), name).toBeGreaterThan(-0.005);
      expect(k.bar.y - (k.chest.y + 0.12), name).toBeLessThan(0.035);
      const forearm = sub(k.wristL, k.elbowL);
      expect(Math.atan2(Math.hypot(forearm.x, forearm.z), forearm.y) * DEG, name).toBeLessThan(15);
      expect(Math.abs(k.gripL.y - k.gripR.y), name).toBeLessThan(0.01);
    }
  });

  it('keeps the joints within human ranges', () => {
    every(ALL, (k, p, name) => {
      for (const s of ['L', 'R'] as const) {
        expect(flexion(k[`hip${s}`], k[`knee${s}`], k[`ankle${s}`]), `knee ${name} p=${p}`).toBeLessThan(150);
        expect(flexion(k[`shoulder${s}`], k[`elbow${s}`], k[`wrist${s}`]), `elbow ${name} p=${p}`).toBeLessThan(168);
      }
    });
  });
});
