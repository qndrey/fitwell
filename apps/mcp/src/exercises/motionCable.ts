// Cable exercises for the exercise animation: the seated cable row, the triceps pushdown, the face pull, the straight-arm
// pulldown and the cable crossover. The cable fixes where the handle can go (it is pulled along the line to the pulley), so
// the handle is placed first and the arms are solved to it. p = 0 is the top of the movement, p = 1 the bottom, as for the free lifts.
// Pure: no three.js, no I/O.
import {
  DEG,
  add,
  armOf,
  arms,
  assemble,
  lerp,
  mul,
  neckFor,
  norm,
  standLower,
  sub,
  trunkOf,
  twoBone,
  upperBody,
  vec,
  type Body,
  type Joint,
  type Skeleton,
  type Variant,
  type Vec3,
} from './motionKit';

type Parts = Partial<Record<Joint, Vec3>>;

/** Half the distance between the hands for each way of gripping: a straight bar, a V-bar, a rope. */
const HANDLE = { wide: 0.17, medium: 0.1, close: 0.05 } as const;
const handleHalf = (v: Variant) => HANDLE[v.grip === 'wide' ? 'wide' : v.grip === 'close' ? 'close' : 'medium'];

/** Where the cable pulleys of each station stand, for the props (metres, x forward). */
export const PULLEY = { rowLow: { x: 1.55, y: 0.3 }, pushdown: { x: 0.2, y: 2.25 } };

// ---------- seated cable row ----------

/** Sitting on the bench with the feet on the plate and the knees a little bent; the V-bar is pulled to the belly. */
export function seatedRow(p: number, _v: Variant, b: Body): Skeleton {
  const hipC = vec(0, 0.5, 0);
  const lean = lerp(-0.06, 0.28, p);
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;
  const out: Parts = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const hip = vec(0, hipC.y, side * b.hipHalf);
    const ankle = vec(0.78 * (b.thigh + b.shin) / 0.86, 0.32, side * 0.11);
    const { mid } = twoBone(hip, ankle, b.thigh, b.shin, vec(0, 1, side * 0.1));
    out[`hip${sfx}`] = hip;
    out[`knee${sfx}`] = mid;
    out[`ankle${sfx}`] = ankle;
    out[`heel${sfx}`] = add(ankle, vec(-0.03, -0.06, 0));
    out[`toe${sfx}`] = add(ankle, vec(0.07, 0.14, 0));
  }
  const gz = 0.09;
  const y = sc.y - lerp(0.32, 0.12, p);
  const reach = Math.sqrt(Math.max(0, (armOf(b) - 0.02) ** 2 - (sc.y - y) ** 2 - (gz - b.shoulderHalf) ** 2));
  const g = vec(lerp(sc.x + 0.1, sc.x + reach, p), y, 0);
  const armParts = arms(b, sc, { L: vec(g.x, g.y, gz), R: vec(g.x, g.y, -gz) }, vec(-1, 0, 0.3));
  return assemble(b, { ...body, ...out, ...armParts }, g);
}

// ---------- triceps pushdown ----------

/** Standing a little forward of the pulley with the elbows at the sides; the forearms swing down until the arms are straight (p = 0). */
export function pushdown(p: number, v: Variant, b: Body): Skeleton {
  const { hipC, lower } = standLower(b);
  const lean = 0.1;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const gz = handleHalf(v);
  const flex = lerp(4 * DEG, 105 * DEG, p);
  const out: Parts = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(body.shoulderC, vec(0, 0, side * b.shoulderHalf));
    const elbow = add(shoulder, mul(norm(vec(-0.05, -1, side * 0.12)), b.upperArm));
    const reachLen = b.forearm + b.hand;
    const d = norm(vec(Math.sin(flex), -Math.cos(flex), -side * ((elbow.z * side - gz) / reachLen)));
    const wrist = add(elbow, mul(d, b.forearm));
    out[`shoulder${sfx}`] = shoulder;
    out[`elbow${sfx}`] = elbow;
    out[`wrist${sfx}`] = wrist;
    out[`grip${sfx}`] = add(wrist, mul(d, b.hand));
  }
  const bar = mul(add(out.gripL!, out.gripR!), 0.5);
  return assemble(b, { ...body, ...lower, ...out }, bar);
}

// ---------- face pull ----------

/** The rope is pulled from out in front of the face to the sides of the head with the elbows high and wide. */
export function facePull(p: number, _v: Variant, b: Body): Skeleton {
  const { hipC, lower } = standLower(b);
  const lean = -0.1 * (1 - p);
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;
  const gzFar = 0.07;
  const gzNear = 0.17;
  const y = lerp(sc.y + 0.26, sc.y + 0.02, p);
  const gz = lerp(gzNear, gzFar, p);
  const reach = Math.sqrt(Math.max(0, (armOf(b) - 0.03) ** 2 - (y - sc.y) ** 2 - (gz - b.shoulderHalf) ** 2));
  const g = vec(lerp(sc.x + 0.12, sc.x + reach, p), y, 0);
  const armParts = arms(b, sc, { L: vec(g.x, g.y, gz), R: vec(g.x, g.y, -gz) }, vec(-0.3, 0.5, 1));
  return assemble(b, { ...body, ...lower, ...armParts }, g);
}

// ---------- straight-arm pulldown ----------

/** Leaning forward with straight arms: the bar or rope sweeps from overhead down to the thighs (p = 0). */
export function straightArm(p: number, v: Variant, b: Body): Skeleton {
  const { hipC, lower } = standLower(b);
  const lean = 0.32;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;
  const gz = handleHalf(v);
  // The angle of the arms from hanging straight down; beyond 90 degrees they point up in front.
  const rho = lerp(25 * DEG, 150 * DEG, p);
  const parts: Parts = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(sc, vec(0, 0, side * b.shoulderHalf));
    const lateral = (b.shoulderHalf - gz) ** 2;
    const reach = Math.sqrt(Math.max(0, (armOf(b) * 0.99) ** 2 - lateral));
    const grip = vec(shoulder.x + reach * Math.sin(rho), shoulder.y - reach * Math.cos(rho), side * gz);
    const { mid, end } = twoBone(shoulder, grip, b.upperArm, b.forearm + b.hand, vec(-0.4, 0, side * 0.6));
    parts[`shoulder${sfx}`] = shoulder;
    parts[`elbow${sfx}`] = mid;
    parts[`wrist${sfx}`] = add(mid, mul(norm(sub(end, mid)), b.forearm));
    parts[`grip${sfx}`] = end;
  }
  const bar = mul(add(parts.gripL!, parts.gripR!), 0.5);
  return assemble(b, { ...body, ...lower, ...parts }, bar);
}

// ---------- cable crossover ----------

/** Standing with the cables pulling outward: the hands sweep in an arc together in front of the body (p = 0). `kind` 'low' sweeps up from low pulleys. */
export function crossover(p: number, v: Variant, b: Body): Skeleton {
  const { hipC, lower } = standLower(b);
  const lean = 0.2;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;
  const low = v.kind === 'low';
  const parts: Parts = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(sc, vec(0, 0, side * b.shoulderHalf));
    // Open: arms out to the sides (a little forward, at shoulder height or a little below for the low version). Closed: together in front.
    const open = norm(vec(0.15, low ? -0.35 : -0.05, side));
    const closed = norm(vec(0.65, low ? 0.4 : -0.7, side * -0.35));
    const dir = norm(add(mul(closed, 1 - p), mul(open, p)));
    const grip = add(shoulder, mul(dir, armOf(b) * 0.9));
    const { mid, end } = twoBone(shoulder, grip, b.upperArm, b.forearm + b.hand, vec(0.1, low ? -0.5 : 0.4, side * 0.6));
    parts[`shoulder${sfx}`] = shoulder;
    parts[`elbow${sfx}`] = mid;
    parts[`wrist${sfx}`] = add(mid, mul(norm(sub(end, mid)), b.forearm));
    parts[`grip${sfx}`] = end;
  }
  const bar = mul(add(parts.gripL!, parts.gripR!), 0.5);
  void trunkOf;
  return assemble(b, { ...body, ...lower, ...parts }, bar);
}
