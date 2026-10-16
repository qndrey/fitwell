// Seated and lying strength machines for the exercise animation: leg press, leg extension and seated leg curl, lying leg curl,
// chest press, chest-supported row, pec deck and reverse fly, arm machines, calf raise and the hip abductor and adductor.
// A machine fixes where the handle, pad or platform can go, so these solvers place that part first and solve the limbs to it.
// p = 0 is the top of the movement (lockout, or the muscle fully shortened), p = 1 the bottom, as for the free lifts.
// Pure: no three.js, no I/O.
import {
  DEG,
  add,
  armOf,
  arms,
  assemble,
  carry,
  lerp,
  mul,
  neckFor,
  norm,
  seatedLower,
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

/** The seat of the seated machines: where the hips are, and how far the back is reclined. */
export const SEAT = { hipX: -0.2, hipY: 0.5, lean: 0.14 };

/** Hips, knee, ankle, heel and toe of one leg, from the joint positions. */
function leg(sfx: 'L' | 'R', hip: Vec3, knee: Vec3, ankle: Vec3, heel: Vec3, toe: Vec3): Parts {
  return { [`hip${sfx}`]: hip, [`knee${sfx}`]: knee, [`ankle${sfx}`]: ankle, [`heel${sfx}`]: heel, [`toe${sfx}`]: toe } as Parts;
}

const sides = [[1, 'L'], [-1, 'R']] as const;

// ---------- leg press ----------

/** The sled runs up and forward at `gamma`; the seat back is reclined `beta` from vertical; the hips sit at `hip`. */
export const LEG_PRESS = { beta: 50 * DEG, gamma: 42 * DEG, hip: { x: 0, y: 0.45 } };

export function legPress(p: number, v: Variant, b: Body): Skeleton {
  const { beta, gamma, hip } = LEG_PRESS;
  const hipC = vec(hip.x, hip.y, 0);
  const t = vec(-Math.sin(beta), Math.cos(beta), 0);
  const body = upperBody(b, hipC, t, vec(-Math.sin(beta * 0.5), Math.cos(beta * 0.5), 0));
  const d = vec(Math.cos(gamma), Math.sin(gamma), 0);
  const u = vec(-Math.sin(gamma), Math.cos(gamma), 0);
  const stance = v.stance === 'narrow' ? 0.08 : v.stance === 'wide' ? 0.2 : 0.13;
  // Knee flexion from nearly straight to about 105 degrees; the feet slide along the sled line from the hips.
  const flex = lerp(10 * DEG, 105 * DEG, p);
  const reach = Math.sqrt(b.thigh ** 2 + b.shin ** 2 + 2 * b.thigh * b.shin * Math.cos(flex));
  const out: Parts = {};
  for (const [side, sfx] of sides) {
    const hipPoint = vec(hipC.x, hipC.y, side * b.hipHalf);
    const ankle = add(hipPoint, add(mul(d, reach), vec(0, 0, side * (stance - b.hipHalf))));
    const { mid } = twoBone(hipPoint, ankle, b.thigh, b.shin, vec(u.x, u.y, side * 0.3));
    // The sole lies flat on the platform: toes up the plate, heel down it.
    const sole = add(ankle, mul(d, b.ankleHeight));
    Object.assign(out, leg(sfx, hipPoint, mid, ankle, sub(sole, mul(u, b.heelBack)), add(sole, mul(u, b.toeFront))));
  }
  // The hands hold the handles at the sides of the seat.
  const grips = { L: vec(hipC.x + 0.05, hipC.y + 0.14, 0.3), R: vec(hipC.x + 0.05, hipC.y + 0.14, -0.3) };
  const armParts = arms(b, body.shoulderC, grips, vec(0.3, -1, 0.4));
  const platform = add(mul(add(out.ankleL!, out.ankleR!), 0.5), mul(d, b.ankleHeight));
  return assemble(b, { ...body, ...out, ...armParts }, platform);
}

// ---------- seated leg extension and leg curl ----------

/** Seated at the machine; the shin swings about the knee. `kind` is 'extension' (p = 0 legs out) or 'curl' (p = 0 heels down). */
export function kneeMachine(p: number, v: Variant, b: Body): Skeleton {
  const hipC = vec(SEAT.hipX, SEAT.hipY, 0);
  const t = vec(-Math.sin(SEAT.lean), Math.cos(SEAT.lean), 0);
  const body = upperBody(b, hipC, t, neckFor(-SEAT.lean));
  // The angle of the shin from hanging straight down toward straight out in front.
  const theta = v.kind === 'curl' ? lerp(6 * DEG, 84 * DEG, p) : lerp(84 * DEG, 5 * DEG, p);
  const shinDir = vec(Math.sin(theta), -Math.cos(theta), 0);
  const f = vec(Math.cos(theta), Math.sin(theta), 0); // the way the toes point (square to the shin)
  const upFoot = vec(-Math.sin(theta), Math.cos(theta), 0);
  const out: Parts = {};
  for (const [side, sfx] of sides) {
    const hip = vec(hipC.x, hipC.y, side * b.hipHalf);
    const knee = add(hip, mul(norm(vec(Math.cos(0.07), Math.sin(0.07), side * 0.03)), b.thigh));
    const ankle = add(knee, mul(shinDir, b.shin));
    const sole = sub(ankle, mul(upFoot, b.ankleHeight));
    Object.assign(out, leg(sfx, hip, knee, ankle, sub(sole, mul(f, b.heelBack)), add(sole, mul(f, b.toeFront))));
  }
  const handles = { L: vec(hipC.x + 0.1, hipC.y + 0.2, 0.3), R: vec(hipC.x + 0.1, hipC.y + 0.2, -0.3) };
  const armParts = arms(b, body.shoulderC, handles, vec(0.2, -1, 0.5));
  // The roller pad rests on the shin just above the ankle: in front of it for the extension, behind it for the curl.
  const side = v.kind === 'curl' ? -1 : 1;
  const pad = add(mul(add(out.ankleL!, out.ankleR!), 0.5), add(mul(f, side * 0.075), mul(shinDir, -0.04)));
  return assemble(b, { ...body, ...out, ...armParts }, pad);
}

// ---------- lying leg curl ----------

export const LYING_CURL = { bench: 0.43 };

/** Face down on a bench with the knees at its edge; the heels curl toward the buttocks. */
export function lyingCurl(p: number, _v: Variant, b: Body): Skeleton {
  const hipC = vec(0, LYING_CURL.bench + 0.07, 0);
  const t = vec(1, 0, 0);
  const body = upperBody(b, hipC, t, vec(Math.cos(0.35), Math.sin(0.35), 0));
  const flex = lerp(125 * DEG, 8 * DEG, p);
  const dir = vec(-Math.cos(flex), Math.sin(flex), 0);
  const toeDir = vec(-dir.y, dir.x, 0);
  const out: Parts = {};
  for (const [side, sfx] of sides) {
    const hip = vec(0, hipC.y, side * b.hipHalf);
    const knee = add(hip, mul(norm(vec(-1, 0, side * 0.05)), b.thigh));
    const ankle = add(knee, mul(dir, b.shin));
    Object.assign(out, leg(sfx, hip, knee, ankle, sub(ankle, mul(toeDir, 0.04)), add(ankle, mul(toeDir, 0.17))));
  }
  const reach = trunkOf(b) + 0.25;
  const handles = { L: vec(reach, hipC.y + 0.12, 0.2), R: vec(reach, hipC.y + 0.12, -0.2) };
  const armParts = arms(b, body.shoulderC, handles, vec(0, 0.5, 1));
  const pad = add(mul(add(out.ankleL!, out.ankleR!), 0.5), add(mul(vec(dir.y, -dir.x, 0), 0.075), mul(dir, -0.03)));
  return assemble(b, { ...body, ...out, ...armParts }, pad);
}

// ---------- chest press ----------

/** Seated with the back on the pad; the handles move straight out from the chest (tilted for the incline and decline machines). */
export function chestPress(p: number, v: Variant, b: Body): Skeleton {
  // The cable version is done standing, leaning into the push.
  const stand = v.kind === 'cable';
  const { hipC, lower } = stand ? standLower(b) : seatedLower(b, SEAT.hipX + b.thigh);
  const lean = stand ? 0.1 : -SEAT.lean;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;
  const slope = Math.tan((v.kind === 'incline' ? 25 : v.kind === 'decline' ? -25 : 0) * DEG);
  const xb = sc.x + 0.12;
  const gz = 0.27;
  const grip = (x: number) => vec(x, sc.y - 0.04 + (x - xb) * slope, gz);
  // The top: the furthest the handles go with the arms nearly straight.
  let lo = xb;
  let hi = sc.x + armOf(b);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const g = grip(mid);
    const d = Math.hypot(g.x - sc.x, g.y - sc.y, g.z - b.shoulderHalf);
    if (d < armOf(b) - 0.015) lo = mid;
    else hi = mid;
  }
  const x = lerp(lo, xb, p);
  const g = grip(x);
  const armParts = arms(b, sc, { L: g, R: vec(g.x, g.y, -gz) }, vec(-0.2, -0.5, 0.8));
  return assemble(b, { ...body, ...lower, ...armParts }, vec(g.x, g.y, 0));
}

// ---------- chest-supported row machine ----------

/** Leaning on the chest pad; the handles are pulled back until the elbows pass the body ('high' starts from above the shoulders). */
export function machineRow(p: number, v: Variant, b: Body): Skeleton {
  const { hipC, lower } = seatedLower(b, SEAT.hipX + b.thigh);
  const lean = 0.12;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;
  const gz = 0.22;
  const dy = v.kind === 'high' ? lerp(-0.06, 0.1, p) : -0.14;
  const xFar = sc.x + Math.sqrt(Math.max(0, (armOf(b) - 0.02) ** 2 - dy * dy - (gz - b.shoulderHalf) ** 2));
  const x = lerp(sc.x + 0.1, xFar, p);
  const g = vec(x, sc.y + dy, gz);
  const armParts = arms(b, sc, { L: g, R: vec(g.x, g.y, -gz) }, vec(-1, 0.2, 0.5));
  return assemble(b, { ...body, ...lower, ...armParts }, vec(g.x, g.y, 0));
}

// ---------- pec deck and reverse fly ----------

/** Seated; the arms sweep through a horizontal arc about the shoulders. `kind` is 'butterfly' or 'reverse'. */
export function pecDeck(p: number, v: Variant, b: Body): Skeleton {
  const { hipC, lower } = seatedLower(b, SEAT.hipX + b.thigh);
  const reverse = v.kind === 'reverse';
  const lean = reverse ? 0.1 : -SEAT.lean;
  const t = vec(Math.sin(lean), Math.cos(lean), 0);
  const body = upperBody(b, hipC, t, neckFor(lean));
  const sc = body.shoulderC;
  const parts: Parts = {};
  // kappa: 0 points straight out to the side, 90 degrees straight ahead, beyond that across the chest.
  const kappa = reverse ? lerp(-5 * DEG, 75 * DEG, p) : lerp(110 * DEG, -10 * DEG, p);
  for (const [side, sfx] of sides) {
    const shoulder = add(sc, vec(0, 0, side * b.shoulderHalf));
    const dir = vec(Math.sin(kappa), 0, side * Math.cos(kappa));
    if (reverse) {
      const grip = add(shoulder, mul(dir, armOf(b) * 0.95));
      const { mid, end } = twoBone(shoulder, grip, b.upperArm, b.forearm + b.hand, vec(0, -1, 0));
      parts[`shoulder${sfx}`] = shoulder;
      parts[`elbow${sfx}`] = mid;
      parts[`wrist${sfx}`] = add(mid, mul(norm(sub(end, mid)), b.forearm));
      parts[`grip${sfx}`] = end;
    } else {
      // The forearms stand straight up on the pads, the elbows level with the shoulders.
      const elbow = add(shoulder, mul(dir, b.upperArm));
      const wrist = add(elbow, vec(0, b.forearm, 0));
      parts[`shoulder${sfx}`] = shoulder;
      parts[`elbow${sfx}`] = elbow;
      parts[`wrist${sfx}`] = wrist;
      parts[`grip${sfx}`] = add(wrist, vec(0, b.hand, 0));
    }
  }
  const bar = mul(add(parts.gripL!, parts.gripR!), 0.5);
  return assemble(b, { ...body, ...lower, ...parts }, bar);
}

// ---------- arm machines ----------

const UPPER_ARM_ANGLE = { bicep: 28 * DEG, preacher: 55 * DEG, triceps: 10 * DEG } as const;

/** Biceps and preacher curl machines and the seated triceps extension, with the upper arm resting on a pad; and the seated dip machine. */
export function armMachine(p: number, v: Variant, b: Body): Skeleton {
  const { hipC, lower } = seatedLower(b, SEAT.hipX + b.thigh);
  const t = vec(-0.05, 1, 0);
  const body = upperBody(b, hipC, norm(t), vec(0, 1, 0));
  const sc = body.shoulderC;
  const parts: Parts = {};
  if (v.kind === 'dip') {
    // Hands on the handles beside the hips; the machine is pushed down until the arms are straight (p = 0).
    const dropTop = armOf(b) - 0.03;
    const dropBottom = 0.3;
    for (const [side, sfx] of sides) {
      const shoulder = add(sc, vec(0, 0, side * b.shoulderHalf));
      const grip = vec(sc.x + 0.02, sc.y - lerp(dropTop, dropBottom, p), side * 0.26);
      const { mid, end } = twoBone(shoulder, grip, b.upperArm, b.forearm + b.hand, vec(-1, -0.3, side * 0.6));
      parts[`shoulder${sfx}`] = shoulder;
      parts[`elbow${sfx}`] = mid;
      parts[`wrist${sfx}`] = add(mid, mul(norm(sub(end, mid)), b.forearm));
      parts[`grip${sfx}`] = end;
    }
  } else {
    const triceps = v.kind === 'triceps';
    const upper = UPPER_ARM_ANGLE[v.kind === 'preacher' ? 'preacher' : triceps ? 'triceps' : 'bicep'];
    // Elbow flexion: curled (p = 0) to straight for the curls; straight (p = 0) to folded for the triceps machine.
    const flex = triceps ? lerp(15 * DEG, 140 * DEG, p) : lerp(140 * DEG, 15 * DEG, p);
    const a = upper + flex;
    for (const [side, sfx] of sides) {
      const shoulder = add(sc, vec(0, 0, side * b.shoulderHalf));
      const elbow = add(shoulder, mul(norm(vec(Math.sin(upper), -Math.cos(upper), side * 0.1)), b.upperArm));
      const d = norm(vec(Math.sin(a), -Math.cos(a), -side * 0.05));
      const wrist = add(elbow, mul(d, b.forearm));
      parts[`shoulder${sfx}`] = shoulder;
      parts[`elbow${sfx}`] = elbow;
      parts[`wrist${sfx}`] = wrist;
      parts[`grip${sfx}`] = add(wrist, mul(d, b.hand));
    }
  }
  const bar = mul(add(parts.gripL!, parts.gripR!), 0.5);
  return assemble(b, { ...body, ...lower, ...parts }, bar);
}

// ---------- calf raise ----------

export const CALF = { block: 0.09, ballFromAnkle: 0.126, ankleAboveBall: 0.063 };

/** Raising the heels about the balls of the feet on a block, standing (a machine or a Smith bar on the shoulders) or seated. */
export function calf(p: number, v: Variant, b: Body): Skeleton {
  const theta = lerp(38 * DEG, -12 * DEG, p);
  const seated = v.kind === 'seated';
  const ballX = seated ? SEAT.hipX + b.thigh + CALF.ballFromAnkle : CALF.ballFromAnkle;
  const ball = vec(ballX, CALF.block + 0.008, 0);
  const rel = vec(-CALF.ballFromAnkle * Math.cos(theta) + CALF.ankleAboveBall * Math.sin(theta), CALF.ballFromAnkle * Math.sin(theta) + CALF.ankleAboveBall * Math.cos(theta), 0);
  const ankleC = add(ball, rel);
  const out: Parts = {};
  for (const [side, sfx] of sides) {
    const ankle = vec(ankleC.x, ankleC.y, side * 0.11);
    const toe = vec(ball.x + 0.074, CALF.block, ankle.z);
    const heel = vec(ankle.x - 0.06 * Math.cos(theta) - 0.07 * Math.sin(theta), ankle.y - 0.06 * Math.sin(theta) * 0 - 0.07 * Math.cos(theta), ankle.z);
    // The hips stay where they are (on the seat, or over the flat foot) while the ankles rise and the legs lean a little.
    const reachLeg = (b.thigh + b.shin) * 0.998;
    const hipX = seated ? SEAT.hipX : 0; // over the flat foot's ankle
    const hipY = seated ? SEAT.hipY : ankle.y + Math.sqrt(Math.max(0, reachLeg ** 2 - (hipX - ankle.x) ** 2));
    const hip = vec(hipX, hipY, side * b.hipHalf);
    const knee = twoBone(hip, ankle, b.thigh, b.shin, seated ? vec(0, 1, 0) : vec(1, 0, 0)).mid;
    Object.assign(out, leg(sfx, hip, knee, ankle, heel, toe));
  }
  const hipC = mul(add(out.hipL!, out.hipR!), 0.5);
  const t = vec(0, 1, 0);
  const body = upperBody(b, hipC, t, t);
  const sc = body.shoulderC;
  if (v.rails) {
    // A Smith bar across the back of the shoulders, held with both hands.
    const barAt = add(add(hipC, mul(t, trunkOf(b) + 0.01)), vec(-0.055, 0, 0));
    const held = carry(b, { ...v, load: 'barbell-back' }, body, hipC, t, 0, barAt);
    return assemble(b, { ...body, ...out, ...held.armParts }, held.bar);
  }
  const grips = { L: vec(hipC.x + 0.2, hipC.y + 0.25, 0.26), R: vec(hipC.x + 0.2, hipC.y + 0.25, -0.26) };
  const armParts = arms(b, sc, grips, vec(-0.3, -1, 0.5));
  return assemble(b, { ...body, ...out, ...armParts }, sc);
}

// ---------- hip abductor and adductor ----------

/** Seated with the knees against the pads; the thighs open or close about the hips. */
export function hipMachine(p: number, v: Variant, b: Body): Skeleton {
  const { hipC, lower } = seatedLower(b, SEAT.hipX + b.thigh);
  const body = upperBody(b, hipC, vec(0, 1, 0), vec(0, 1, 0));
  // Abductor: open at the top (p = 0); adductor: closed at the top.
  const zeta = v.kind === 'adductor' ? lerp(4 * DEG, 36 * DEG, p) : lerp(38 * DEG, 5 * DEG, p);
  const out: Parts = {};
  for (const [side, sfx] of sides) {
    const hip = vec(hipC.x, hipC.y, side * b.hipHalf);
    const knee = add(hip, mul(vec(Math.cos(zeta), 0, side * Math.sin(zeta)), b.thigh));
    const ankle = vec(knee.x, knee.y - b.shin, knee.z);
    const f = vec(Math.cos(zeta * 0.4), 0, side * Math.sin(zeta * 0.4));
    const floor = vec(ankle.x, 0, ankle.z);
    Object.assign(out, leg(sfx, hip, knee, ankle, sub(floor, mul(f, b.heelBack)), add(floor, mul(f, b.toeFront))));
  }
  const grips = { L: vec(hipC.x + 0.05, hipC.y + 0.16, 0.27), R: vec(hipC.x + 0.05, hipC.y + 0.16, -0.27) };
  const armParts = arms(b, body.shoulderC, grips, vec(0, -1, 0.5));
  void lower;
  return assemble(b, { ...body, ...out, ...armParts }, mul(add(out.kneeL!, out.kneeR!), 0.5));
}
