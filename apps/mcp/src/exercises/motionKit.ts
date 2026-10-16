// The shared parts of the movement solvers (see motion.ts): vectors, the body's measurements, the skeleton, the movement types
// and the geometry helpers (two-bone limbs, standing and seated lower bodies, arms and loads). Pure: no three.js, no I/O.
export type Vec3 = { x: number; y: number; z: number };
export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3) => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b));
export const norm = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return mul(a, 1 / l);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const DEG = Math.PI / 180;
/** The angle of the shins when standing straight (a few degrees forward of vertical). */
export const SHIN_AT_REST = 3 * DEG;

/** Segment lengths in metres for a 1.75 m male figure. Axes: x forward (the way the figure faces), y up, z to the figure's left. */
export const BODY = {
  ankleHeight: 0.08,
  shin: 0.42,
  thigh: 0.43,
  pelvis: 0.1,
  lumbar: 0.22,
  chest: 0.2,
  shoulderDrop: 0.03,
  neck: 0.08,
  head: 0.23,
  shoulderHalf: 0.2,
  hipHalf: 0.09,
  upperArm: 0.3,
  forearm: 0.26,
  hand: 0.08,
  heelBack: 0.06,
  toeFront: 0.2,
  midfoot: 0.07,
} as const;

/** The measurements of a body, in metres. The solvers take one, so the same form rules hold for whichever body is drawn. */
export type Body = { -readonly [K in keyof typeof BODY]: number };
/** Hip joint to the centre of the shoulders along the trunk. */
export const trunkOf = (b: Body) => b.pelvis + b.lumbar + b.chest - b.shoulderDrop;
/** Shoulder joint to the centre of a gripped bar with the arm straight. */
export const armOf = (b: Body) => b.upperArm + b.forearm + b.hand;
export const TRUNK = trunkOf(BODY);
export const ARM = armOf(BODY);
export const PLATE_RADIUS = 0.225;
export const BAR_RADIUS = 0.0125;
export const BENCH_HEIGHT = 0.43;

export const JOINTS = [
  'pelvis', 'lumbar', 'chest', 'neckBase', 'neckTop', 'headTop',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'gripL', 'gripR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'heelL', 'heelR', 'toeL', 'toeR',
  'bar', 'midfoot',
] as const;
export type Joint = (typeof JOINTS)[number];
export type Skeleton = Record<Joint, Vec3>;

export type PatternId =
  | 'squat' | 'hinge' | 'bench' | 'incline' | 'press' | 'row' | 'curl' | 'pull' | 'lunge' | 'pushup'
  | 'legpress' | 'kneemachine' | 'lyingcurl' | 'chestpress' | 'machinerow' | 'pecdeck' | 'armmachine' | 'calf' | 'hipmachine'
  | 'seatedrow' | 'pushdown' | 'facepull' | 'straightarm' | 'crossover';
export type Load = 'barbell-back' | 'barbell-front' | 'barbell-hands' | 'dumbbells' | 'goblet' | 'machine' | 'none';
export interface Variant {
  load: Load;
  stance: 'normal' | 'wide' | 'narrow';
  grip: 'close' | 'medium' | 'wide';
  hinge: 'conventional' | 'romanian' | 'stiff';
  /** Sitting (the overhead press on an upright bench, the lat pulldown) rather than standing or hanging. */
  seated: boolean;
  /** The angle of the bench back for the incline press, in degrees (0 is flat). */
  incline: number;
  /** The palms face the body (over) or away from it (under: curls, chin-ups, underhand pulldowns). */
  palm: 'over' | 'under';
  /** The bar rides on the rails of a Smith machine: it moves straight up and down. */
  rails: boolean;
  /** Which machine of a kind: extension or curl, flat or incline, butterfly or reverse, bicep or preacher, standing or seated, and so on. */
  kind: string;
}
export interface MotionSpec {
  pattern: PatternId;
  variant: Variant;
}

export const DEFAULT_VARIANT: Variant = { load: 'none', stance: 'normal', grip: 'medium', hinge: 'conventional', seated: false, incline: 0, palm: 'over', rails: false, kind: '' };
export const spec = (pattern: PatternId, v: Partial<Variant>): MotionSpec => ({ pattern, variant: { ...DEFAULT_VARIANT, ...v } });

// ---------- geometry helpers ----------

/** Middle joint of a two-bone chain from `root` to `target`; `pole` says which way the joint bends toward. The end is clamped to the reach. */
export function twoBone(root: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3): { mid: Vec3; end: Vec3 } {
  const to = sub(target, root);
  const full = length(to);
  const dir = norm(to);
  const d = Math.min(Math.max(full, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const side = norm(sub(pole, mul(dir, dot(pole, dir))));
  return { mid: add(add(root, mul(dir, a)), mul(side, h)), end: add(root, mul(dir, d)) };
}

/** Finds x in [lo, hi] where f crosses zero, for a function that is increasing or decreasing across the bracket. */
export function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  const fa = f(a);
  for (let i = 0; i < 50; i++) {
    const m = (a + b) / 2;
    if (Math.sign(f(m)) === Math.sign(fa)) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** The spine, neck and head for a trunk pointing along `t` (unit, pelvis toward shoulders) with the neck along `n`. */
export function upperBody(b: Body, hipC: Vec3, t: Vec3, n: Vec3) {
  const lumbar = add(hipC, mul(t, b.pelvis));
  const chest = add(lumbar, mul(t, b.lumbar));
  const neckBase = add(chest, mul(t, b.chest));
  const shoulderC = sub(neckBase, mul(t, b.shoulderDrop));
  return {
    pelvis: hipC,
    lumbar,
    chest,
    neckBase,
    neckTop: add(neckBase, mul(n, b.neck)),
    headTop: add(neckBase, mul(n, b.neck + b.head)),
    shoulderC,
  };
}

export interface LegPlan {
  hipC: Vec3;
  /** Half distance between the ankles. */
  stance: number;
  /** Toes point out by this many radians. */
  toeOut: number;
  /** Where the knees bend toward, per side: forward plus this much outward. */
  kneePole: Vec3;
}

/** Hips, knees (two-bone chain to planted ankles), ankles and feet. The hip is lowered if the legs cannot reach. */
export function legs(b: Body, plan: LegPlan, ankleX: (side: 1 | -1) => number, ankleY = b.ankleHeight) {
  const out: Partial<Record<Joint, Vec3>> = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const hip = vec(plan.hipC.x, plan.hipC.y, side * b.hipHalf);
    const ankle = vec(ankleX(side), ankleY, side * plan.stance);
    const { mid } = twoBone(hip, ankle, b.thigh, b.shin, vec(plan.kneePole.x, plan.kneePole.y, side * plan.kneePole.z));
    const f = vec(Math.cos(plan.toeOut), 0, side * Math.sin(plan.toeOut));
    out[`hip${sfx}`] = hip;
    out[`knee${sfx}`] = mid;
    out[`ankle${sfx}`] = ankle;
    out[`heel${sfx}`] = sub(sub(ankle, mul(f, b.heelBack)), vec(0, b.ankleHeight, 0));
    out[`toe${sfx}`] = sub(add(ankle, mul(f, b.toeFront)), vec(0, b.ankleHeight, 0));
  }
  return out;
}

/** Arms from the shoulders to given grip points (shoulder is the left one; the right one is mirrored by the caller). */
export function arms(b: Body, shoulderC: Vec3, grips: { L: Vec3; R: Vec3 }, pole: Vec3) {
  const out: Partial<Record<Joint, Vec3>> = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(shoulderC, vec(0, 0, side * b.shoulderHalf));
    const grip = grips[sfx];
    const { mid: elbow, end } = twoBone(shoulder, grip, b.upperArm, b.forearm + b.hand, vec(pole.x, pole.y, side * pole.z));
    out[`shoulder${sfx}`] = shoulder;
    out[`elbow${sfx}`] = elbow;
    out[`wrist${sfx}`] = add(elbow, mul(sub(end, elbow), b.forearm / (b.forearm + b.hand)));
    out[`grip${sfx}`] = end;
  }
  return out;
}

/**
 * Arms for holds where the wrist is bent (a bar on the front of the shoulders or behind the neck, hands clasped): the
 * elbow is solved from the shoulder to the wrist, and the hand reaches from the wrist to the grip point. `handDir` is the
 * direction from the grip to the wrist, for the left side (the right side mirrors its z).
 */
export function armsWithBentWrist(b: Body, shoulderC: Vec3, grips: { L: Vec3; R: Vec3 }, handDir: Vec3, pole: Vec3) {
  const out: Partial<Record<Joint, Vec3>> = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(shoulderC, vec(0, 0, side * b.shoulderHalf));
    const grip = grips[sfx];
    const wristTarget = add(grip, mul(norm(vec(handDir.x, handDir.y, side * handDir.z)), b.hand));
    const { mid: elbow, end: wrist } = twoBone(shoulder, wristTarget, b.upperArm, b.forearm, vec(pole.x, pole.y, side * pole.z));
    out[`shoulder${sfx}`] = shoulder;
    out[`elbow${sfx}`] = elbow;
    out[`wrist${sfx}`] = wrist;
    out[`grip${sfx}`] = add(wrist, mul(norm(sub(grip, wristTarget)), b.hand));
  }
  return out;
}

export const assemble = (b: Body, parts: Partial<Record<Joint, Vec3>>, bar: Vec3): Skeleton => {
  const left = parts.ankleL!;
  const right = parts.ankleR!;
  const mid = mul(add(left, right), 0.5);
  return { ...(parts as Skeleton), bar, midfoot: vec(mid.x + b.midfoot, 0, 0) };
};

/** The arms and the load for the holds shared by the squat and the lunge. `barAt` is where a barbell rides on the trunk. */
export function carry(b: Body, v: Variant, body: ReturnType<typeof upperBody>, hipC: Vec3, t: Vec3, lean: number, barAt: Vec3) {
  const nFwd = vec(Math.cos(lean), -Math.sin(lean), 0);
  let bar = barAt;
  let armParts: Partial<Record<Joint, Vec3>>;
  const shoulderL = add(body.shoulderC, vec(0, 0, b.shoulderHalf));
  const shoulderR = sub(body.shoulderC, vec(0, 0, b.shoulderHalf));
  const hands = (z: number, at: Vec3) => ({ L: add(at, vec(0, 0, z)), R: add(at, vec(0, 0, -z)) });
  switch (v.load) {
    case 'barbell-back':
      // Hands on the bar behind the neck with the wrists just below it; the elbows point down and back.
      armParts = armsWithBentWrist(b, body.shoulderC, hands(0.36, bar), vec(0, -1, 0), vec(-0.5, -1, 0.4));
      break;
    case 'barbell-front':
      // The bar rests on the front of the shoulders, held by the fingers; the elbows point forward at about shoulder height.
      armParts = armsWithBentWrist(b, body.shoulderC, hands(0.28, bar), vec(-0.3, -0.95, 0), vec(1, 0.35, 0.15));
      break;
    case 'goblet':
      bar = add(add(hipC, mul(t, 0.38)), mul(nFwd, 0.14));
      armParts = armsWithBentWrist(b, body.shoulderC, hands(0.05, bar), vec(0, 0, 0.0001), vec(0.2, -1, 0.3));
      break;
    case 'dumbbells': {
      const grips = { L: add(shoulderL, vec(0, -armOf(b), 0.06)), R: add(shoulderR, vec(0, -armOf(b), -0.06)) };
      armParts = arms(b, body.shoulderC, grips, vec(0.2, 0, 1));
      bar = mul(add(grips.L, grips.R), 0.5);
      break;
    }
    default: {
      // Bodyweight: the hands are clasped in front of the chest with the elbows pointing down and out.
      const chest = add(add(hipC, mul(t, 0.4)), mul(nFwd, 0.12));
      armParts = armsWithBentWrist(b, body.shoulderC, hands(0.04, chest), vec(0, 0, 0.0001), vec(0.2, -1, 0.3));
      bar = chest;
    }
  }
  return { armParts, bar };
}

export const smooth = (e0: number, e1: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
};

/** Standing with the legs straight, as at the top of the squat: the hips, and both legs. */
export function standLower(b: Body, stance = 0.12) {
  const s = SHIN_AT_REST;
  const knee = { x: b.shin * Math.sin(s), y: b.ankleHeight + b.shin * Math.cos(s) };
  const hipC = vec(knee.x + b.thigh * Math.sin(s), knee.y + b.thigh * Math.cos(s), 0);
  return { hipC, lower: legs(b, { hipC, stance, toeOut: 10 * DEG, kneePole: vec(1, 0, 0.15) }, () => 0) };
}

/** Sitting on a bench or seat with the thighs level and the shins vertical, the ankles at `ankleX`. */
export function seatedLower(b: Body, ankleX: number) {
  const hipC = vec(ankleX - b.thigh, b.ankleHeight + b.shin, 0);
  return { hipC, lower: legs(b, { hipC, stance: 0.11, toeOut: 5 * DEG, kneePole: vec(0, 1, 0.1) }, () => ankleX) };
}

export const neckFor = (lean: number) => vec(Math.sin(lean * 0.35), Math.cos(lean * 0.35), 0);

