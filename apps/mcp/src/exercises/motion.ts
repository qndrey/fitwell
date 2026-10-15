// Movement patterns for the 3D exercise animation: for a pattern and a progress value p (0 = top, 1 = bottom), the
// positions of the joints of a male figure, in metres. Positions come from small solvers that keep every segment at its
// fixed length and enforce the rule of the lift (bar over the mid-foot in the squat, vertical forearms at the bottom of
// the bench press), so the animation cannot show a pose that breaks the lift. Pure: no three.js, no I/O; shared by the
// server (which says which exercises have a motion) and the views (which draw it).

import {
  BAR_RADIUS,
  BENCH_HEIGHT,
  BODY,
  type Body,
  DEFAULT_VARIANT,
  DEG,
  type Joint,
  type MotionSpec,
  PLATE_RADIUS,
  type PatternId,
  SHIN_AT_REST,
  type Skeleton,
  type Variant,
  type Vec3,
  add,
  armOf,
  arms,
  armsWithBentWrist,
  assemble,
  bisect,
  carry,
  distance,
  dot,
  legs,
  lerp,
  mul,
  neckFor,
  norm,
  seatedLower,
  smooth,
  spec,
  standLower,
  sub,
  trunkOf,
  twoBone,
  upperBody,
  vec,
} from './motionKit';
export * from './motionKit';

// ---------- squat ----------

const SQUAT = { kneeMax: 118 * DEG, shinStart: SHIN_AT_REST, shinEnd: 32 * DEG, leanMax: 70 * DEG };

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

  const { armParts, bar } = carry(b, v, body, hipC, t, lean, loadAt(lean));
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
  const theta = v.incline * DEG;
  const lying = (x: number, dy = 0) => vec(x, BENCH_HEIGHT + 0.1 + dy, 0);
  const hipC = lying(0);
  // From the hips toward the head, up the bench back; and the direction the chest faces.
  const t = vec(-Math.cos(theta), Math.sin(theta), 0);
  const nFront = vec(Math.sin(theta), Math.cos(theta), 0);
  const body = upperBody(b, hipC, t, t);
  const lower = legs(b, { hipC, stance: 0.2, toeOut: 0, kneePole: vec(0, 1, 0.2) }, () => 0.54);

  const dumbbells = v.load === 'dumbbells';
  const gz = dumbbells ? 0.22 : GRIP_HALF[v.grip];
  const shoulder = add(body.shoulderC, vec(0, 0, b.shoulderHalf)); // left shoulder
  const l1 = b.upperArm;
  const l2 = b.forearm + b.hand;
  const dz = gz - b.shoulderHalf;

  // Bottom: the bar touches the chest with the forearms vertical, which fixes where along the body it lands.
  // (On a flat bench the chest is a height; on an incline it is a sloping surface, so the height is found by search.)
  const barAt = (gy: number) => vec(shoulder.x + Math.sqrt(Math.max(0, l1 * l1 - (shoulder.y - (gy - l2)) ** 2 - dz * dz)), gy, gz);
  const chestPoint = add(add(body.chest, mul(t, theta > 0 ? 0.06 : 0)), mul(nFront, 0.12));
  const gyBottom =
    theta === 0 ? chestPoint.y + BAR_RADIUS : bisect((gy) => dot(sub(barAt(gy), chestPoint), nFront) - BAR_RADIUS, chestPoint.y - 0.15, chestPoint.y + 0.25);
  const bottom = barAt(gyBottom);
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

// ---------- overhead press ----------

/** p = 0 is lockout with the bar over the shoulders, p = 1 the bar racked on the front of the shoulders. */
function press(p: number, v: Variant, b: Body): Skeleton {
  const barbell = v.load === 'barbell-front';
  const { hipC, lower } = v.seated ? seatedLower(b, 0.28) : standLower(b);
  // Standing, the trunk leans a little so the lockout is over the mid-foot, and a little back to let the bar pass the face.
  const lean0 = v.seated ? 0 : Math.asin(Math.min(0.3, Math.max(-0.3, (b.midfoot - hipC.x) / trunkOf(b))));
  const lean = lean0 - (v.seated ? 0.02 : 0.07) * p;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;

  const yLock = sc.y + armOf(b) - 0.015;
  const yRack = sc.y + (barbell ? 0.01 : 0.11);
  const y = lerp(yLock, yRack, p);
  const h = y - yRack;
  // The bar starts in front of the collarbones, swings out around the face, and ends straight above the shoulders.
  const off = barbell ? lerp(0.07, 0.16, smooth(0.05, 0.17, h)) * (1 - smooth(0.36, 0.52, h)) : 0.06 * (1 - smooth(0, 0.5, h));
  const bar = vec(sc.x + off, y, 0);
  const gz = b.shoulderHalf + (barbell ? 0.06 : 0.07);
  const hands = { L: vec(bar.x, y, gz), R: vec(bar.x, y, -gz) };
  const armParts = armsWithBentWrist(b, sc, hands, vec(0, -1, 0), barbell ? vec(0.5, -1, 0.3) : vec(0, -0.6, 1));
  return assemble(b, { ...body, ...lower, ...armParts }, bar);
}

// ---------- bent-over row ----------

const ROW = { knee: 40 * DEG, shin: 7 * DEG, lean: 50 * DEG };

/** p = 0 is the bar pulled to the lower ribs, p = 1 the arms hanging straight down. */
function row(p: number, v: Variant, b: Body): Skeleton {
  const knee2 = { x: b.shin * Math.sin(ROW.shin), y: b.ankleHeight + b.shin * Math.cos(ROW.shin) };
  const a = ROW.knee - ROW.shin;
  const hipC = vec(knee2.x - b.thigh * Math.sin(a), knee2.y + b.thigh * Math.cos(a), 0);
  const t = vec(Math.sin(ROW.lean), Math.cos(ROW.lean), 0);
  const body = upperBody(b, hipC, t, vec(Math.sin(ROW.lean * 0.45), Math.cos(ROW.lean * 0.45), 0));
  const lower = legs(b, { hipC, stance: 0.11, toeOut: 10 * DEG, kneePole: vec(1, 0, 0.1) }, () => 0);
  const sc = body.shoulderC;
  const bottom = vec(sc.x, sc.y - armOf(b), 0);
  const front = vec(Math.cos(ROW.lean), -Math.sin(ROW.lean), 0);
  const top = add(add(hipC, mul(t, 0.34)), mul(front, 0.12));
  const g = vec(lerp(top.x, bottom.x, p), lerp(top.y, bottom.y, p), 0);
  const gz = b.shoulderHalf + (v.load === 'dumbbells' ? 0.03 : 0.09);
  const grips = { L: vec(g.x, g.y, gz), R: vec(g.x, g.y, -gz) };
  return assemble(b, { ...body, ...lower, ...arms(b, sc, grips, vec(-1, 0.35, 0.5)) }, g);
}

// ---------- curl ----------

/** p = 0 is the weight curled up to the shoulders, p = 1 the arms hanging. */
function curl(p: number, _v: Variant, b: Body): Skeleton {
  const { hipC, lower } = standLower(b);
  const t = vec(0, 1, 0);
  const body = upperBody(b, hipC, t, t);
  const swing = (1 - p) * 0.2; // the upper arms drift forward a little at the top
  const alpha = lerp(150 * DEG, 8 * DEG, p);
  const out: Partial<Record<Joint, Vec3>> = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(body.shoulderC, vec(0, 0, side * b.shoulderHalf));
    const elbow = add(shoulder, mul(norm(vec(Math.sin(swing), -Math.cos(swing), side * 0.12)), b.upperArm));
    const d = norm(vec(Math.sin(alpha), -Math.cos(alpha), -side * 0.05));
    const wrist = add(elbow, mul(d, b.forearm));
    out[`shoulder${sfx}`] = shoulder;
    out[`elbow${sfx}`] = elbow;
    out[`wrist${sfx}`] = wrist;
    out[`grip${sfx}`] = add(wrist, mul(d, b.hand));
  }
  const bar = mul(add(out.gripL!, out.gripR!), 0.5);
  return assemble(b, { ...body, ...lower, ...out }, bar);
}

// ---------- pull-up and lat pulldown ----------

/** Height of the pull-up bar, so a hanging figure clears the floor. */
export const PULLUP_BAR_HEIGHT = 2.3;
const PULL_GRIP = { close: 0.12, medium: 0.3, wide: 0.45 } as const;

/** p = 0 is the bar at the chin (pull-up) or the upper chest (pulldown), p = 1 the arms stretched overhead. */
function pull(p: number, v: Variant, b: Body): Skeleton {
  const gz = PULL_GRIP[v.grip];
  if (v.seated) {
    const { hipC, lower } = seatedLower(b, 0.28);
    const lean = lerp(0.24, 0.05, p); // leaning back at the bottom of the pull
    const t = vec(-Math.sin(lean), Math.cos(lean), 0);
    const body = upperBody(b, hipC, t, neckFor(lean));
    const sc = body.shoulderC;
    const bottom = vec(sc.x + 0.15, sc.y - 0.05, 0);
    const dz = gz - b.shoulderHalf;
    const topX = sc.x + 0.05;
    const top = vec(topX, sc.y + Math.sqrt(Math.max(0, (armOf(b) - 0.01) ** 2 - 0.05 ** 2 - dz * dz)), 0);
    const g = vec(lerp(bottom.x, top.x, p), lerp(bottom.y, top.y, p), 0);
    const grips = { L: vec(g.x, g.y, gz), R: vec(g.x, g.y, -gz) };
    return assemble(b, { ...body, ...lower, ...arms(b, sc, grips, vec(-1, -0.4, 0.4)) }, g);
  }
  const H = PULLUP_BAR_HEIGHT;
  const ys = lerp(H - (b.shoulderDrop + b.neck + 0.02), H - armOf(b) + 0.005, p);
  const sc = vec(lerp(-0.1, 0, p), ys, 0);
  const lean = lerp(0.2, 0, p);
  const t = vec(-Math.sin(lean), Math.cos(lean), 0);
  const hipC = sub(sc, mul(t, trunkOf(b)));
  const body = upperBody(b, hipC, t, vec(-Math.sin(lean * 0.5), Math.cos(lean * 0.5), 0));
  const lower = legs(b, { hipC, stance: 0.09, toeOut: 0, kneePole: vec(1, 0, 0.1) }, () => hipC.x - 0.13, hipC.y - (b.thigh + b.shin) * 0.94);
  // Hanging feet point down.
  for (const sfx of ['L', 'R'] as const) {
    const ankle = lower[`ankle${sfx}`]!;
    lower[`toe${sfx}`] = add(ankle, vec(0.05, -0.17, 0));
    lower[`heel${sfx}`] = add(ankle, vec(-0.03, -0.03, 0));
  }
  const bar = vec(0, H, 0);
  const grips = { L: vec(0, H, gz), R: vec(0, H, -gz) };
  return assemble(b, { ...body, ...lower, ...arms(b, sc, grips, vec(-0.4, -1, 0.6)) }, bar);
}

// ---------- lunge and split squat ----------

const LUNGE = { stride: 0.8, drop: 0.31 };

/** p = 0 is standing tall in the split stance, p = 1 the front thigh level and the back knee just above the floor. */
function lunge(p: number, v: Variant, b: Body): Skeleton {
  const xf = 0.1; // the front ankle
  const xr = xf - LUNGE.stride;
  const hipX = xf - b.thigh;
  const reach = (b.thigh + b.shin) * 0.995;
  const yTop = b.ankleHeight + Math.sqrt(Math.max(0, reach * reach - (xf - hipX) ** 2));
  const yBottom = b.ankleHeight + b.shin;
  const hipC = vec(hipX, lerp(yTop, yBottom, p), 0);
  const out: Partial<Record<Joint, Vec3>> = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const frontLeg = side === 1;
    const hip = vec(hipC.x, hipC.y, side * b.hipHalf);
    const ankle = frontLeg ? vec(xf, b.ankleHeight, side * 0.11) : vec(xr, b.ankleHeight + 0.1, side * 0.11);
    const { mid } = twoBone(hip, ankle, b.thigh, b.shin, frontLeg ? vec(1, 0, 0.1) : vec(-0.2, -1, 0.1));
    out[`hip${sfx}`] = hip;
    out[`knee${sfx}`] = mid;
    out[`ankle${sfx}`] = ankle;
    // The front foot is flat; the back foot is on its toes with the heel up.
    out[`heel${sfx}`] = frontLeg ? vec(ankle.x - b.heelBack, 0, ankle.z) : vec(ankle.x - 0.06, ankle.y - 0.05, ankle.z);
    out[`toe${sfx}`] = frontLeg ? vec(ankle.x + b.toeFront, 0, ankle.z) : vec(ankle.x + 0.13, 0, ankle.z);
  }
  const lean = 0.07;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const barAt = add(add(hipC, mul(t, trunkOf(b) + 0.01)), mul(vec(-Math.cos(lean), Math.sin(lean), 0), 0.055));
  const { armParts, bar } = carry(b, v, body, hipC, t, lean, barAt);
  return assemble(b, { ...body, ...out, ...armParts }, bar);
}

// ---------- push-up ----------

/** p = 0 is the top with the arms straight, p = 1 the chest just above the floor. */
function pushup(p: number, v: Variant, b: Body): Skeleton {
  const gz = b.shoulderHalf + { close: -0.1, medium: 0.06, wide: 0.17 }[v.grip];
  const toe = vec(0, 0, 0);
  const ankle0 = vec(toe.x - 0.06, 0.15, 0);
  const lengthOfBody = b.shin + b.thigh + trunkOf(b);
  const wristY = 0.065;
  const dz = gz - b.shoulderHalf;
  const shoulderTop = wristY + Math.sqrt(Math.max(0, (b.upperArm + b.forearm - 0.006) ** 2 - dz * dz));
  const shoulderY = lerp(shoulderTop, 0.17, p);
  const beta = Math.asin(Math.min(1, Math.max(0, (shoulderY - ankle0.y) / lengthOfBody)));
  const d = vec(Math.cos(beta), Math.sin(beta), 0);
  const kneeAt = (side: number) => add(add(ankle0, vec(0, 0, side * 0.07)), mul(d, b.shin));
  const hipC = add(ankle0, mul(d, b.shin + b.thigh));
  const body = upperBody(b, hipC, d, vec(Math.cos(beta + 0.45), Math.sin(beta + 0.45), 0));
  // The hands stay where they were put at the top, under the shoulders.
  const topBeta = Math.asin((shoulderTop - ankle0.y) / lengthOfBody);
  const handX = ankle0.x + lengthOfBody * Math.cos(topBeta);
  const out: Partial<Record<Joint, Vec3>> = {};
  const sc = body.shoulderC;
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(sc, vec(0, 0, side * b.shoulderHalf));
    const wristTarget = vec(handX, wristY, side * gz);
    const { mid, end } = twoBone(shoulder, wristTarget, b.upperArm, b.forearm, vec(-0.5, 0.2, side));
    out[`shoulder${sfx}`] = shoulder;
    out[`elbow${sfx}`] = mid;
    out[`wrist${sfx}`] = end;
    out[`grip${sfx}`] = add(end, vec(b.hand * 0.99, -0.01, 0));
    out[`hip${sfx}`] = vec(hipC.x, hipC.y, side * b.hipHalf);
    out[`knee${sfx}`] = kneeAt(side);
    out[`ankle${sfx}`] = add(ankle0, vec(0, 0, side * 0.07));
    out[`toe${sfx}`] = add(vec(0, 0, side * 0.07), vec(0, 0, 0));
    out[`heel${sfx}`] = add(ankle0, vec(-0.04, -0.05, side * 0.07));
  }
  return assemble(b, { ...body, ...out }, vec(handX, wristY, 0));
}

// ---------- public API ----------

const SOLVERS: Record<PatternId, (p: number, v: Variant, b: Body) => Skeleton> = { squat, hinge, bench, incline: bench, press, row, curl, pull, lunge, pushup };

export function skeletonAt(s: MotionSpec, p: number, body: Body = BODY): Skeleton {
  const q = Math.min(1, Math.max(0, p));
  return SOLVERS[s.pattern](q, s.variant, body);
}

/** The standing figure, for proportions and the turntable view. */
export function standing(body: Body = BODY): Skeleton {
  return squat(0, DEFAULT_VARIANT, body);
}

/** True when the lift starts from the bottom of the movement (the deadlift from the floor, the press from the shoulders, a pull from the hang, a curl from the hang). */
export const startsAtBottom = (s: MotionSpec) => (s.pattern === 'hinge' && s.variant.hinge === 'conventional') || ['press', 'row', 'curl', 'pull'].includes(s.pattern);

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
  'Barbell Incline Bench Press - Medium Grip': spec('incline', { load: 'barbell-hands', grip: 'medium', incline: 30 }),
  'Incline Dumbbell Press': spec('incline', { load: 'dumbbells', incline: 30 }),
  'Standing Military Press': spec('press', { load: 'barbell-front' }),
  'Seated Barbell Military Press': spec('press', { load: 'barbell-front', seated: true }),
  'Standing Dumbbell Press': spec('press', { load: 'dumbbells' }),
  'Dumbbell Shoulder Press': spec('press', { load: 'dumbbells', seated: true }),
  'Bent Over Barbell Row': spec('row', { load: 'barbell-hands' }),
  'Bent Over Two-Dumbbell Row': spec('row', { load: 'dumbbells' }),
  'Barbell Curl': spec('curl', { load: 'barbell-hands', palm: 'under' }),
  'EZ-Bar Curl': spec('curl', { load: 'barbell-hands', palm: 'under' }),
  'Close-Grip EZ Bar Curl': spec('curl', { load: 'barbell-hands', palm: 'under' }),
  'Close-Grip Standing Barbell Curl': spec('curl', { load: 'barbell-hands', palm: 'under' }),
  'Dumbbell Bicep Curl': spec('curl', { load: 'dumbbells', palm: 'under' }),
  'Pullups': spec('pull', { grip: 'medium' }),
  'Chin-Up': spec('pull', { grip: 'close', palm: 'under' }),
  'Wide-Grip Lat Pulldown': spec('pull', { seated: true, grip: 'wide' }),
  'Close-Grip Front Lat Pulldown': spec('pull', { seated: true, grip: 'close' }),
  'Full Range-Of-Motion Lat Pulldown': spec('pull', { seated: true, grip: 'medium' }),
  'Underhand Cable Pulldowns': spec('pull', { seated: true, grip: 'close', palm: 'under' }),
  'Barbell Lunge': spec('lunge', { load: 'barbell-back' }),
  'Dumbbell Lunges': spec('lunge', { load: 'dumbbells' }),
  'Split Squats': spec('lunge', { load: 'none' }),
  'Split Squat with Dumbbells': spec('lunge', { load: 'dumbbells' }),
  'Pushups': spec('pushup', { grip: 'medium' }),
  'Push-Up Wide': spec('pushup', { grip: 'wide' }),
  'Push-Ups - Close Triceps Position': spec('pushup', { grip: 'close' }),
};

/** One breath, in and out, in seconds. */
export const BREATH_SECONDS = 4.4;

/**
 * Standing at ease with the arms hanging, for an exercise that has no movement to show. `t` (seconds) lifts the shoulders a
 * few millimetres with each breath; the chest itself is moved by the player's skin shader.
 */
export function relaxed(body: Body = BODY, t = 0): Skeleton {
  const b = body;
  const { hipC, lower } = standLower(b);
  const up = vec(0, 1, 0);
  const trunk = upperBody(b, hipC, up, up);
  const lift = 0.004 * Math.sin((2 * Math.PI * t) / BREATH_SECONDS);
  const out: Partial<Record<Joint, Vec3>> = {};
  for (const [side, sfx] of [[1, 'L'], [-1, 'R']] as const) {
    const shoulder = add(trunk.shoulderC, vec(0, lift, side * b.shoulderHalf));
    const elbow = add(shoulder, mul(norm(vec(0.05, -1, side * 0.14)), b.upperArm));
    const d = norm(vec(0.13, -1, side * 0.1));
    const wrist = add(elbow, mul(d, b.forearm));
    out[`shoulder${sfx}`] = shoulder;
    out[`elbow${sfx}`] = elbow;
    out[`wrist${sfx}`] = wrist;
    out[`grip${sfx}`] = add(wrist, mul(d, b.hand));
  }
  return assemble(b, { ...trunk, ...lower, ...out }, hipC);
}

/** How tightly the hands close for a movement: flat on the floor for a push-up, loosely with nothing in them, around a bar or handle otherwise. */
export const gripFor = (s: MotionSpec) => (s.pattern === 'pushup' ? 0 : s.variant.load === 'none' && s.pattern !== 'pull' ? 0.35 : 1);

export function motionFor(name: string): MotionSpec | null {
  return MOTIONS[name] ?? null;
}
