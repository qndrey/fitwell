/**
 * Stick-figure illustrations drawn from joint angles, so every exercise is a handful of numbers rather than a picture.
 * Side view, facing right. Angles are in degrees, 0 = straight down, 90 = forward, 180 = straight up, 270 = backward.
 */
export type Pt = readonly [number, number];

export interface Pose {
  /** Hip to shoulder. */
  torso: number;
  /** Neck and head; follows the torso when left out. */
  head?: number;
  /** Shoulder to elbow, elbow to wrist. */
  uarm: number;
  farm: number;
  /** The arm on the far side (drawn lighter); left out when it would hide behind the near one. */
  uarm2?: number;
  farm2?: number;
  /** Hip to knee, knee to ankle, ankle to toe. */
  thigh: number;
  shin: number;
  foot?: number;
  /** The leg on the far side (drawn lighter); left out when it would hide behind the near one. */
  thigh2?: number;
  shin2?: number;
  foot2?: number;
  /** Height above the floor, for jumps and steps. */
  rise?: number;
  /** How far the near hand has gone to the template's `reach` joint: 0 = where the arm angles put it, 1 = on the joint (default). */
  grip?: number;
}

export type Hold = 'barbell' | 'dumbbell' | 'kettlebell' | 'wheel' | 'cable-low' | 'cable-mid' | 'cable-high' | 'cable-over';
export type Prop = 'bench' | 'seat' | 'incline' | 'hand-bench' | 'back-bench' | 'rear-bench' | 'pullup-bar' | 'dip-bars' | 'low-bar' | 'step' | 'preacher' | 'hyper';

export interface Template {
  start: Pose;
  /** Poses passed through on the way from start to end, for motions that do not go in a straight line. */
  via?: Pose[];
  end: Pose;
  hold?: Hold;
  props?: Prop[];
  /** What stays still: the floor (default) or a bar the hands hold on to. */
  anchor?: 'floor' | 'bar';
  /** Height of the bar the hands hold when anchored to one (default: a pull-up bar near the top). */
  barY?: number;
  /** The joint that stays put sideways while the rest moves (default: the ankle). */
  pin?: 'ankle' | 'toe' | 'wrist' | 'hip' | 'knee' | 'shoulder';
  /** The joint whose path is drawn as a dotted arrow (default: the hands when something is held). */
  trace?: 'wrist' | 'ankle' | 'knee' | 'hip' | 'head' | 'none';
  /** Which end of the motion tells it apart best in a small picture (default: the end position). */
  thumb?: 0 | 1;
  /** The near hand goes to this joint (holding a shin, a bar on the hips), whatever the arm angles say. `bend` picks the elbow side. */
  reach?: { to: 'hip' | 'knee' | 'ankle' | 'toe'; bend?: 1 | -1 };
}

export const BAR_Y = 12;
export const STEP_H = 9;
export const PLATE_R = 6.5;
export const SIZE = { w: 120, h: 80, floor: 72 } as const;
const K = 0.88;
const LEN = { torso: 22 * K, neck: 3 * K, head: 4.6 * K, uarm: 12 * K, farm: 11 * K, thigh: 16 * K, shin: 15 * K, foot: 5 * K } as const;
export const HEAD_R = 4.6 * K;

const dir = (deg: number): Pt => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
const add = (p: Pt, deg: number, len: number): Pt => [p[0] + dir(deg)[0] * len, p[1] + dir(deg)[1] * len];

export interface Frame {
  head: Pt;
  neck: Pt;
  shoulder: Pt;
  elbow: Pt;
  wrist: Pt;
  hip: Pt;
  knee: Pt;
  ankle: Pt;
  toe: Pt;
  far?: { knee: Pt; ankle: Pt; toe: Pt };
  farArm?: { elbow: Pt; wrist: Pt };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Elbow and wrist for a hand that reaches `target` from `shoulder`; the arm straightens towards it when it is too far. */
function reachTo(shoulder: Pt, target: Pt, bend: 1 | -1): { elbow: Pt; wrist: Pt } {
  const [l1, l2] = [LEN.uarm, LEN.farm];
  const dx = target[0] - shoulder[0];
  const dy = target[1] - shoulder[1];
  const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const a = Math.atan2(dy, dx) + bend * Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const elbow: Pt = [shoulder[0] + Math.cos(a) * l1, shoulder[1] + Math.sin(a) * l1];
  const u = Math.hypot(target[0] - elbow[0], target[1] - elbow[1]) || 1;
  return { elbow, wrist: [elbow[0] + ((target[0] - elbow[0]) / u) * l2, elbow[1] + ((target[1] - elbow[1]) / u) * l2] };
}

/** Joint positions with the hip at the origin. */
function skeleton(p: Pose, reach?: Template['reach']): Frame {
  const hip: Pt = [0, 0];
  const shoulder = add(hip, p.torso, LEN.torso);
  const headDir = p.head ?? p.torso;
  const neck = add(shoulder, headDir, LEN.neck);
  const head = add(shoulder, headDir, LEN.neck + LEN.head);
  let elbow = add(shoulder, p.uarm, LEN.uarm);
  let wrist = add(elbow, p.farm, LEN.farm);
  const knee = add(hip, p.thigh, LEN.thigh);
  const ankle = add(knee, p.shin, LEN.shin);
  const toe = add(ankle, p.foot ?? 90, LEN.foot);
  const grip = p.grip ?? 1;
  if (reach && grip > 0) {
    const joint = { hip, knee, ankle, toe }[reach.to];
    ({ elbow, wrist } = reachTo(shoulder, [lerp(wrist[0], joint[0], grip), lerp(wrist[1], joint[1], grip)], reach.bend ?? 1));
  }
  let far: Frame['far'];
  if (p.thigh2 !== undefined) {
    const k = add(hip, p.thigh2, LEN.thigh);
    const a = add(k, p.shin2 ?? p.shin, LEN.shin);
    far = { knee: k, ankle: a, toe: add(a, p.foot2 ?? 90, LEN.foot) };
  }
  let farArm: Frame['farArm'];
  if (p.uarm2 !== undefined) {
    const e = add(shoulder, p.uarm2, LEN.uarm);
    farArm = { elbow: e, wrist: add(e, p.farm2 ?? p.farm, LEN.farm) };
  }
  return { head, neck, shoulder, elbow, wrist, hip, knee, ankle, toe, far, farArm };
}

/** Values a pose means when it leaves them out. Other missing values (a far limb, the head) follow the other pose. */
const DEFAULTS: Partial<Record<keyof Pose, number>> = { foot: 90, foot2: 90, rise: 0, grip: 1 };

function blend(a: Pose, b: Pose, t: number): Pose {
  const out: Record<string, number | undefined> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Pose>) {
    const x = a[k] ?? DEFAULTS[k] ?? b[k];
    const y = b[k] ?? DEFAULTS[k] ?? a[k];
    out[k] = x === undefined || y === undefined ? undefined : lerp(x, y, t);
  }
  return out as unknown as Pose;
}

/** All the poses of a motion, in order. */
export const keyPoses = (tpl: Template): Pose[] => [tpl.start, ...(tpl.via ?? []), tpl.end];

/** The pose at `t`, walking through the key poses at an even pace. */
export function poseAt(tpl: Template, t: number): Pose {
  const keys = keyPoses(tpl);
  const x = Math.min(Math.max(t, 0), 1) * (keys.length - 1);
  const i = Math.min(Math.floor(x), keys.length - 2);
  return blend(keys[i]!, keys[i + 1]!, x - i);
}

export const framePoints = (f: Frame): Pt[] => [
  f.head, f.shoulder, f.elbow, f.wrist, f.hip, f.knee, f.ankle, f.toe,
  ...(f.far ? [f.far.knee, f.far.ankle, f.far.toe] : []),
  ...(f.farArm ? [f.farArm.elbow, f.farArm.wrist] : []),
];

const mapFrame = (f: Frame, move: (q: Pt) => Pt): Frame => ({
  head: move(f.head),
  neck: move(f.neck),
  shoulder: move(f.shoulder),
  elbow: move(f.elbow),
  wrist: move(f.wrist),
  hip: move(f.hip),
  knee: move(f.knee),
  ankle: move(f.ankle),
  toe: move(f.toe),
  far: f.far && { knee: move(f.far.knee), ankle: move(f.far.ankle), toe: move(f.far.toe) },
  farArm: f.farArm && { elbow: move(f.farArm.elbow), wrist: move(f.farArm.wrist) },
});

export type Shape =
  | { kind: 'line'; a: Pt; b: Pt; cls: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; cls: string }
  | { kind: 'circle'; c: Pt; r: number; cls: string };

export interface Drawing {
  frame: Frame;
  hold?: { kind: Hold; at: Pt; from: Pt; anchor?: Pt };
  /** Equipment that stays still: benches, bars, boxes, cable towers. */
  props: Shape[];
  /** False when the figure hangs and the floor is out of the picture. */
  floor: boolean;
  /** Size of the figure, 1 = full size; motions that reach high are drawn a little smaller. */
  scale: number;
}

/** How far an implement reaches past the hand, so it stays in the picture too. */
const REACH: Partial<Record<Hold, number>> = { barbell: PLATE_R, kettlebell: 7.6, dumbbell: 3.2, wheel: 3.8 };
const fitCache = new WeakMap<Template, number>();

/** 1, or a little less for motions that would not fit the picture at full size (bars overhead, jumps). */
function fitScale(tpl: Template): number {
  const cached = fitCache.get(tpl);
  if (cached !== undefined) return cached;
  const r = (tpl.hold && REACH[tpl.hold]) ?? 0;
  const samples = Array.from({ length: 13 }, (_, i) => poseAt(tpl, i / 12));
  const fits = (s: number) =>
    samples.every((p) => {
      const f = scaleFrame(skeleton(p, tpl.reach), s);
      const ys = framePoints(f).map((q) => q[1]);
      const top = Math.min(f.head[1] - HEAD_R * s, f.wrist[1] - r);
      if (tpl.anchor === 'bar') return (tpl.barY ?? BAR_Y) - f.wrist[1] + Math.max(...ys) < SIZE.h - 3;
      return SIZE.floor - (p.rise ?? 0) - Math.max(...ys) + top >= 5;
    });
  let s = 1;
  while (s > 0.7 && !fits(s)) s -= 0.01;
  fitCache.set(tpl, s);
  return s;
}

const scaleFrame = (f: Frame, s: number): Frame => (s === 1 ? f : mapFrame(f, (q) => [q[0] * s, q[1] * s]));

/** Where the figure goes in the picture: a sideways and a downward shift for the pose at `t`. */
function placement(tpl: Template) {
  const s = fitScale(tpl);
  const pinned = (f: Frame) => f[tpl.pin ?? 'ankle'][0];
  const body = (p: Pose) => scaleFrame(skeleton(p, tpl.reach), s);
  // Sideways: pin one joint, then centre what all key poses cover.
  const xs = keyPoses(tpl).flatMap((p) => {
    const f = body(p);
    return framePoints(f).map((q) => q[0] - pinned(f));
  });
  const dx = SIZE.w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;
  return (t: number): Frame => {
    const pose = poseAt(tpl, t);
    const f0 = body(pose);
    const dy = tpl.anchor === 'bar' ? (tpl.barY ?? BAR_Y) - f0.wrist[1] : SIZE.floor - (pose.rise ?? 0) - Math.max(...framePoints(f0).map((q) => q[1]));
    const ox = dx - pinned(f0);
    return mapFrame(f0, (q) => [q[0] + ox, q[1] + dy]);
  };
}

const line = (a: Pt, b: Pt, cls = 'fig-propline'): Shape => ({ kind: 'line', a, b, cls });
const off = (p: Pt, v: Pt, k: number): Pt => [p[0] + v[0] * k, p[1] + v[1] * k];
const unit = (a: Pt, b: Pt): Pt => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
const FL = SIZE.floor + 1.5;

/** A flat pad on two legs, standing on the floor. */
function bench(x1: number, x2: number, top: number): Shape[] {
  return [
    { kind: 'rect', x: x1, y: top, w: x2 - x1, h: 3, cls: 'fig-prop' },
    line([x1 + 3, top + 3], [x1 + 3, FL]),
    line([x2 - 3, top + 3], [x2 - 3, FL]),
  ];
}

/** Equipment, placed from the start pose so it never moves. */
function propShapes(tpl: Template, f: Frame, all: Frame[]): Shape[] {
  const out: Shape[] = [];
  const props = tpl.props ?? [];
  const back = unit(f.hip, f.shoulder);
  const behind: Pt = [back[1], -back[0]];
  if (props.includes('bench')) {
    // Lying along the pad: it runs from just past the hips to the shoulders.
    const xs = [f.hip[0], f.shoulder[0]];
    out.push(...bench(Math.min(...xs) - 4, Math.max(...xs) + 6, Math.max(f.hip[1], f.shoulder[1]) + 2.6));
  }
  if (props.includes('seat') || props.includes('incline')) out.push(...bench(f.hip[0] - 9, f.hip[0] + 7, f.hip[1] + 2.6));
  if (props.includes('incline')) {
    const a = off(f.hip, behind, 3.2);
    const b = off(off(f.shoulder, behind, 3.2), back, 2);
    out.push(line(a, b, 'fig-prop-pad'), line(off(a, back, 8), [off(a, back, 8)[0] - 6, FL]));
  }
  if (props.includes('hand-bench')) out.push(...bench(f.wrist[0] - 15, f.wrist[0] + 3, f.wrist[1] + 1.6));
  if (props.includes('back-bench')) out.push(...bench(f.shoulder[0] - 15, f.shoulder[0] + 3, f.shoulder[1] + 2.6));
  if (props.includes('pullup-bar')) {
    const y = tpl.barY ?? BAR_Y;
    out.push(line([30, y], [90, y], 'fig-prop-bar'), line([30, y], [30, y + 5]), line([90, y], [90, y + 5]));
  }
  if (props.includes('dip-bars')) {
    const y = all[0]!.wrist[1] + 1.5;
    const x = all[0]!.wrist[0];
    out.push(line([x - 16, y], [x + 16, y], 'fig-prop-bar'), line([x - 12, y], [x - 12, FL]), line([x + 12, y], [x + 12, FL]));
  }
  if (props.includes('low-bar')) {
    const w = f.wrist;
    out.push(line([w[0], w[1] + 1.5], [w[0], FL]), { kind: 'circle', c: w, r: 1.8, cls: 'fig-prop' });
  }
  if (props.includes('step')) {
    const x = Math.min(f.ankle[0], f.toe[0]);
    out.push({ kind: 'rect', x: x - 6, y: SIZE.floor - STEP_H + 1.5, w: 18, h: STEP_H, cls: 'fig-prop-box' });
  }
  if (props.includes('rear-bench') && f.far) {
    const p = f.far.toe[1] > f.far.ankle[1] ? f.far.toe : f.far.ankle;
    out.push(...bench(p[0] - 10, p[0] + 8, p[1] + 1.8));
  }
  if (props.includes('preacher')) {
    const d = unit(f.elbow, f.shoulder);
    const below: Pt = [-d[1], d[0]];
    const a = off(f.elbow, below, 2.6);
    const b = off(off(f.elbow, d, 9), below, 2.6);
    out.push(line(a, b, 'fig-prop-pad'), line(off(a, d, 4), [off(a, d, 4)[0], FL]));
    out.push(...bench(f.hip[0] - 8, f.hip[0] + 7, f.hip[1] + 2.6));
  }
  if (props.includes('hyper')) {
    // A pad in front of the hips and a roller behind the ankles, on a frame that slopes to the floor.
    const pad = off(f.hip, [1, 0.25], 3.4);
    const roll: Pt = [f.ankle[0] + 1, f.ankle[1] - 3];
    out.push({ kind: 'circle', c: pad, r: 2.6, cls: 'fig-prop' }, { kind: 'circle', c: roll, r: 1.8, cls: 'fig-prop' });
    out.push(line([pad[0] - 2, pad[1] + 2.4], [roll[0] - 1, FL]), line(roll, [roll[0], FL]));
  }
  return out;
}

/** Where a cable comes from: a pulley on a tower in front, placed once for the whole motion. */
function cableAnchor(kind: Hold, all: Frame[]): Pt | undefined {
  const x = Math.min(Math.max(...all.map((f) => f.wrist[0])) + 24, SIZE.w - 6);
  if (kind === 'cable-high') return [x, 8];
  if (kind === 'cable-low') return [x, SIZE.floor - 3];
  if (kind === 'cable-mid') return [x, all[0]!.wrist[1]];
  if (kind === 'cable-over') return [all[0]!.wrist[0], 4];
  return undefined;
}

/**
 * Places the figure in the picture. `t` runs from 0 (start position) to 1 (end position).
 * Horizontal placement comes from all key poses, so the figure does not slide while it moves.
 */
export function draw(tpl: Template, t: number): Drawing {
  const at = placement(tpl);
  const frame = at(t);
  const all = [0, ...(tpl.via ?? []).map((_, i, v) => (i + 1) / (v.length + 1)), 1].map(at);
  const out: Drawing = { frame, props: propShapes(tpl, all[0]!, all), floor: !tpl.props?.includes('pullup-bar'), scale: fitScale(tpl) };
  if (tpl.hold) {
    const anchor = cableAnchor(tpl.hold, all);
    if (anchor) {
      const post = tpl.hold === 'cable-over' ? anchor[0] + 20 : anchor[0] + 3.5;
      out.props.push(line([post, 3], [post, FL]), { kind: 'circle', c: anchor, r: 2, cls: 'fig-pulley' });
      if (tpl.hold === 'cable-over') out.props.push(line([anchor[0], 2.5], [post, 2.5]));
    }
    out.hold = { kind: tpl.hold, at: frame.wrist, from: frame.elbow, anchor };
  }
  return out;
}

/** The path one joint takes from start to end, for drawing the direction of the motion. */
export function tracePath(tpl: Template): Pt[] | undefined {
  const joint = tpl.trace ?? (tpl.hold ? 'wrist' : 'none');
  if (joint === 'none') return undefined;
  const at = placement(tpl);
  const pts = Array.from({ length: 25 }, (_, i) => at(i / 24)[joint]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return len > 8 ? pts : undefined;
}
