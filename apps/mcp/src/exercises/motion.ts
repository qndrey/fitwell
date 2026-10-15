// Movement patterns for the 3D exercise animation: for a pattern and a progress value p (0 = top, 1 = bottom), the
// positions of the joints of a male figure, in metres. Positions come from small solvers that keep every segment at its
// fixed length and enforce the rule of the lift (bar over the mid-foot in the squat, vertical forearms at the bottom of
// the bench press), so the animation cannot show a pose that breaks the lift. Pure: no three.js, no I/O; shared by the
// server (which says which exercises have a motion) and the views (which draw it).

export type Vec3 = { x: number; y: number; z: number };
const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3) => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b));
const norm = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return mul(a, 1 / l);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DEG = Math.PI / 180;

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

export type PatternId = 'squat' | 'hinge' | 'bench';
export type Load = 'barbell-back' | 'barbell-front' | 'barbell-hands' | 'dumbbells' | 'goblet' | 'none';
export interface Variant {
  load: Load;
  stance: 'normal' | 'wide';
  grip: 'close' | 'medium' | 'wide';
  hinge: 'conventional' | 'romanian' | 'stiff';
}
export interface MotionSpec {
  pattern: PatternId;
  variant: Variant;
}

const DEFAULT_VARIANT: Variant = { load: 'none', stance: 'normal', grip: 'medium', hinge: 'conventional' };
const spec = (pattern: PatternId, v: Partial<Variant>): MotionSpec => ({ pattern, variant: { ...DEFAULT_VARIANT, ...v } });

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
function bisect(f: (x: number) => number, lo: number, hi: number): number {
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
function upperBody(b: Body, hipC: Vec3, t: Vec3, n: Vec3) {
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

interface LegPlan {
  hipC: Vec3;
  /** Half distance between the ankles. */
  stance: number;
  /** Toes point out by this many radians. */
  toeOut: number;
  /** Where the knees bend toward, per side: forward plus this much outward. */
  kneePole: Vec3;
}

/** Hips, knees (two-bone chain to planted ankles), ankles and feet. The hip is lowered if the legs cannot reach. */
function legs(b: Body, plan: LegPlan, ankleX: (side: 1 | -1) => number, ankleY = b.ankleHeight) {
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
function arms(b: Body, shoulderC: Vec3, grips: { L: Vec3; R: Vec3 }, pole: Vec3) {
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
function armsWithBentWrist(b: Body, shoulderC: Vec3, grips: { L: Vec3; R: Vec3 }, handDir: Vec3, pole: Vec3) {
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

const assemble = (b: Body, parts: Partial<Record<Joint, Vec3>>, bar: Vec3): Skeleton => {
  const left = parts.ankleL!;
  const right = parts.ankleR!;
  const mid = mul(add(left, right), 0.5);
  return { ...(parts as Skeleton), bar, midfoot: vec(mid.x + b.midfoot, 0, 0) };
};

// ---------- squat ----------

const SQUAT = { kneeMax: 118 * DEG, shinStart: 3 * DEG, shinEnd: 32 * DEG, leanMax: 70 * DEG };

function squat(p: number, v: Variant, b: Body): Skeleton {
  const wide = v.stance === 'wide';
  const stance = wide ? 0.21 : 0.12;
  const s = lerp(SQUAT.shinStart, SQUAT.shinEnd, p);
  const a = p * SQUAT.kneeMax - s; // thigh angle from vertical, hip behind the knee
  const knee2 = { x: b.shin * Math.sin(s), y: b.ankleHeight + b.shin * Math.cos(s) };
  let hip = { x: knee2.x - b.thigh * Math.sin(a), y: knee2.y + b.thigh * Math.cos(a) };
  // With the feet apart the hip must be closer to the floor for the legs to reach.
  const reach = (b.thigh + b.shin) * 0.9995;
  const flat = Math.hypot(hip.x, stance - b.hipHalf);
  if (flat < reach) hip = { x: hip.x, y: Math.min(hip.y, b.ankleHeight + Math.sqrt(reach * reach - flat * flat)) };
  const hipC = vec(hip.x, hip.y, 0);
  const midfootX = b.midfoot;

  // Where the load sits on the trunk, so the lean can put it over the mid-foot.
  const front = v.load === 'barbell-front';
  const loadAt = (lean: number) => {
    const t = vec(Math.sin(lean), Math.cos(lean), 0);
    return front
      ? add(add(hipC, mul(t, trunkOf(b))), mul(vec(Math.cos(lean), -Math.sin(lean), 0), 0.07))
      : add(add(hipC, mul(t, trunkOf(b) + 0.01)), mul(vec(-Math.cos(lean), Math.sin(lean), 0), 0.055));
  };
  const lean = loadAt(0).x >= midfootX ? 0 : Math.min(SQUAT.leanMax, bisect((l) => loadAt(l).x - midfootX, 0, SQUAT.leanMax));
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const neck = vec(Math.sin(lean * 0.35), Math.cos(lean * 0.35), 0);
  const body = upperBody(b, hipC, t, neck);
  const lower = legs(b, { hipC, stance, toeOut: (wide ? 22 : 10) * DEG, kneePole: vec(1, 0, wide ? 0.45 : 0.15) }, () => 0);

  const nFwd = vec(Math.cos(lean), -Math.sin(lean), 0);
  let bar = loadAt(lean);
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
  return assemble(b, { ...body, ...lower, ...armParts }, bar);
}

// ---------- hip hinge (deadlift family) ----------

interface HingeEnds {
  /** Knee flexion at the bottom, shin lean at the bottom (radians), and the height of the bar at the bottom. */
  kneeBottom: number;
  shinBottom: number;
  barBottom: number;
}
const HINGES: Record<Variant['hinge'], HingeEnds> = {
  conventional: { kneeBottom: 80 * DEG, shinBottom: 8 * DEG, barBottom: PLATE_RADIUS },
  romanian: { kneeBottom: 35 * DEG, shinBottom: 2 * DEG, barBottom: 0.46 },
  stiff: { kneeBottom: 15 * DEG, shinBottom: 2 * DEG, barBottom: 0.5 },
};

function hinge(p: number, v: Variant, b: Body): Skeleton {
  const e = HINGES[v.hinge];
  const s = lerp(3 * DEG, e.shinBottom, p);
  const phi = lerp(0, e.kneeBottom, p);
  const a = phi - s;
  const knee2 = { x: b.shin * Math.sin(s), y: b.ankleHeight + b.shin * Math.cos(s) };
  const hip = { x: knee2.x - b.thigh * Math.sin(a), y: knee2.y + b.thigh * Math.cos(a) };
  const hipC = vec(hip.x, hip.y, 0);

  // The bar hugs the legs: its height runs from the upper thigh to the bottom height, and it sits just in front of the leg at that height.
  const barY = lerp(hip.y - 0.15, e.barBottom, p);
  const legFront = (y: number) => {
    if (y <= knee2.y) return ((y - b.ankleHeight) / Math.cos(s)) * Math.sin(s) + 0.0675 + 0.01;
    const f = (y - knee2.y) / Math.max(1e-6, hip.y - knee2.y);
    return knee2.x + (hip.x - knee2.x) * Math.min(1, f) + 0.1;
  };
  const barX = legFront(barY);
  const bar = vec(barX, barY, 0);

  // Lean the trunk until the arms are taut; if the bar is already within reach the trunk stays upright.
  const shoulderAt = (lean: number) => add(hipC, mul(vec(Math.sin(lean), Math.cos(lean), 0), trunkOf(b)));
  const lean = distance(shoulderAt(0), bar) <= armOf(b) ? 0 : bisect((l) => distance(shoulderAt(l), bar) - armOf(b), 0, 88 * DEG);
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, vec(Math.sin(lean * 0.35), Math.cos(lean * 0.35), 0));
  const lower = legs(b, { hipC, stance: 0.11, toeOut: 10 * DEG, kneePole: vec(1, 0, 0.1) }, () => 0);

  const dumbbells = v.load === 'dumbbells';
  const z = dumbbells ? 0.24 : 0.22;
  const grips = { L: vec(barX, barY, z), R: vec(barX, barY, -z) };
  return assemble(b, { ...body, ...lower, ...arms(b, body.shoulderC, grips, vec(0, 0, 1)) }, bar);
}

// ---------- bench press ----------

const GRIP_HALF = { close: 0.2, medium: 0.3, wide: 0.4 } as const;

function bench(p: number, v: Variant, b: Body): Skeleton {
  const lying = (x: number, dy = 0) => vec(x, BENCH_HEIGHT + 0.1 + dy, 0);
  const hipC = lying(0);
  const t = vec(-1, 0, 0);
  const body = upperBody(b, hipC, t, t);
  const lower = legs(b, { hipC, stance: 0.2, toeOut: 0, kneePole: vec(0, 1, 0.2) }, () => 0.54);

  const dumbbells = v.load === 'dumbbells';
  const gz = dumbbells ? 0.22 : GRIP_HALF[v.grip];
  const shoulder = add(body.shoulderC, vec(0, 0, b.shoulderHalf)); // left shoulder
  const chestTop = body.chest.y + 0.12;
  const l1 = b.upperArm;
  const l2 = b.forearm + b.hand;
  const dz = gz - b.shoulderHalf;

  // Bottom: the bar touches the chest with the forearms vertical, which fixes where along the body it lands.
  const gyBottom = chestTop + BAR_RADIUS;
  const dy = shoulder.y - (gyBottom - l2);
  const dx = Math.sqrt(Math.max(0, l1 * l1 - dy * dy - dz * dz));
  const bottom = vec(shoulder.x + dx, gyBottom, gz);
  const elbowBottom = vec(bottom.x, gyBottom - l2, gz);
  // Top: the arms nearly straight, the bar a little toward the feet from the shoulders.
  const reach = Math.sqrt(Math.max(0, (l1 + l2) * (l1 + l2) - dz * dz)) - 0.02;
  const top = vec(shoulder.x + 0.02, shoulder.y + reach, gz);

  // The bar sits above the shoulders at the top and slides toward the feet while it comes down.
  const g = vec(lerp(top.x, bottom.x, p), lerp(top.y, bottom.y, p), gz);
  // Which way the elbows bend is fixed by the bottom position (the forearm is vertical there).
  const line = norm(sub(bottom, shoulder));
  const toElbow = sub(elbowBottom, shoulder);
  const pole = norm(sub(toElbow, mul(line, dot(toElbow, line))));
  const grips = { L: g, R: vec(g.x, g.y, -gz) };
  return assemble(b, { ...body, ...lower, ...arms(b, body.shoulderC, grips, vec(pole.x, pole.y, pole.z)) }, vec(g.x, g.y, 0));
}

// ---------- public API ----------

export function skeletonAt(s: MotionSpec, p: number, body: Body = BODY): Skeleton {
  const q = Math.min(1, Math.max(0, p));
  return s.pattern === 'squat' ? squat(q, s.variant, body) : s.pattern === 'hinge' ? hinge(q, s.variant, body) : bench(q, s.variant, body);
}

/** The standing figure, for proportions and the turntable view. */
export function standing(body: Body = BODY): Skeleton {
  return squat(0, DEFAULT_VARIANT, body);
}

/** True when the lift starts from the bottom (the conventional deadlift starts from the floor). */
export const startsAtBottom = (s: MotionSpec) => s.pattern === 'hinge' && s.variant.hinge === 'conventional';

const LOOP = { pauseTop: 0.4, down: 1.6, pauseBottom: 0.3, up: 1.2 };
export const LOOP_SECONDS = LOOP.pauseTop + LOOP.down + LOOP.pauseBottom + LOOP.up;
const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);

/** Progress p (0 top, 1 bottom) at time t of the repeating loop: a pause, a slow lowering, a pause, a lift. */
export function progressAt(t: number, s: MotionSpec): number {
  let x = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  if (startsAtBottom(s)) x = (x + LOOP.pauseTop + LOOP.down) % LOOP_SECONDS; // begin at the bottom, with the lift
  if (x < LOOP.pauseTop) return 0;
  x -= LOOP.pauseTop;
  if (x < LOOP.down) return ease(x / LOOP.down);
  x -= LOOP.down;
  if (x < LOOP.pauseBottom) return 1;
  x -= LOOP.pauseBottom;
  return 1 - ease(x / LOOP.up);
}

// ---------- which exercises have a motion ----------

/** An explicit list by exercise name (the names of the bundled library), so a motion is never guessed for a variation it does not fit. */
export const MOTIONS: Record<string, MotionSpec> = {
  'Barbell Squat': spec('squat', { load: 'barbell-back' }),
  'Barbell Full Squat': spec('squat', { load: 'barbell-back' }),
  'Narrow Stance Squats': spec('squat', { load: 'barbell-back' }),
  'Wide Stance Barbell Squat': spec('squat', { load: 'barbell-back', stance: 'wide' }),
  'Front Barbell Squat': spec('squat', { load: 'barbell-front' }),
  'Bodyweight Squat': spec('squat', { load: 'none' }),
  'Dumbbell Squat': spec('squat', { load: 'dumbbells' }),
  'Goblet Squat': spec('squat', { load: 'goblet' }),
  'Barbell Deadlift': spec('hinge', { load: 'barbell-hands', hinge: 'conventional' }),
  'Romanian Deadlift': spec('hinge', { load: 'barbell-hands', hinge: 'romanian' }),
  'Stiff-Legged Barbell Deadlift': spec('hinge', { load: 'barbell-hands', hinge: 'stiff' }),
  'Stiff-Legged Dumbbell Deadlift': spec('hinge', { load: 'dumbbells', hinge: 'stiff' }),
  'Barbell Bench Press - Medium Grip': spec('bench', { load: 'barbell-hands', grip: 'medium' }),
  'Wide-Grip Barbell Bench Press': spec('bench', { load: 'barbell-hands', grip: 'wide' }),
  'Close-Grip Barbell Bench Press': spec('bench', { load: 'barbell-hands', grip: 'close' }),
  'Dumbbell Bench Press': spec('bench', { load: 'dumbbells' }),
};

export function motionFor(name: string): MotionSpec | null {
  return MOTIONS[name] ?? null;
}
