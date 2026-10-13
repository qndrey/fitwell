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
  /** Hip to knee, knee to ankle, ankle to toe. */
  thigh: number;
  shin: number;
  foot?: number;
  /** The leg on the far side (drawn lighter); left out when it would hide behind the near one. */
  thigh2?: number;
  shin2?: number;
  foot2?: number;
}

export type Hold = 'barbell' | 'dumbbell' | 'cable-low' | 'cable-high';
export type Prop = 'bench' | 'pullup-bar' | 'step';

export interface Template {
  start: Pose;
  end: Pose;
  hold?: Hold;
  props?: Prop[];
  /** What stays still: the floor (default) or a bar the hands hold on to. */
  anchor?: 'floor' | 'bar';
  /** The joint that stays put sideways while the rest moves (default: the ankle). */
  pin?: 'ankle' | 'toe' | 'wrist' | 'hip';
  /** Which end of the motion tells it apart best in a small picture (default: the end position). */
  thumb?: 0 | 1;
}

export const BAR_Y = 12;
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
}

/** Joint positions with the hip at the origin. */
function skeleton(p: Pose): Frame {
  const hip: Pt = [0, 0];
  const shoulder = add(hip, p.torso, LEN.torso);
  const headDir = p.head ?? p.torso;
  const neck = add(shoulder, headDir, LEN.neck);
  const head = add(shoulder, headDir, LEN.neck + LEN.head);
  const elbow = add(shoulder, p.uarm, LEN.uarm);
  const wrist = add(elbow, p.farm, LEN.farm);
  const knee = add(hip, p.thigh, LEN.thigh);
  const ankle = add(knee, p.shin, LEN.shin);
  const toe = add(ankle, p.foot ?? 90, LEN.foot);
  let far: Frame['far'];
  if (p.thigh2 !== undefined) {
    const k = add(hip, p.thigh2, LEN.thigh);
    const a = add(k, p.shin2 ?? p.shin, LEN.shin);
    far = { knee: k, ankle: a, toe: add(a, p.foot2 ?? 90, LEN.foot) };
  }
  return { head, neck, shoulder, elbow, wrist, hip, knee, ankle, toe, far };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function blend(a: Pose, b: Pose, t: number): Pose {
  const out: Record<string, number | undefined> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Pose>) {
    const x = a[k] ?? b[k];
    const y = b[k] ?? a[k];
    out[k] = x === undefined || y === undefined ? undefined : lerp(x, y, t);
  }
  return out as unknown as Pose;
}

const points = (f: Frame): Pt[] => [f.head, f.shoulder, f.elbow, f.wrist, f.hip, f.knee, f.ankle, f.toe, ...(f.far ? [f.far.knee, f.far.ankle, f.far.toe] : [])];

export interface Drawing {
  frame: Frame;
  hold?: { kind: Hold; at: Pt; anchor?: Pt };
  bench?: { x1: number; x2: number; top: number };
  bar?: { y: number };
  step?: { x1: number; x2: number; top: number };
}

/**
 * Places the figure in the picture. `t` runs from 0 (start position) to 1 (end position).
 * Horizontal placement comes from both end poses, so the figure does not slide while it moves.
 */
export function draw(tpl: Template, t: number): Drawing {
  const pinned = (f: Frame) => f[tpl.pin ?? 'ankle'][0];
  // Sideways: pin one joint, then centre what both end poses cover.
  const xs = [tpl.start, tpl.end].flatMap((p) => {
    const f = skeleton(p);
    return points(f).map((q) => q[0] - pinned(f));
  });
  const dx = SIZE.w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;

  const f0 = skeleton(blend(tpl.start, tpl.end, t));
  const dy = tpl.anchor === 'bar' ? BAR_Y - f0.wrist[1] : SIZE.floor - Math.max(...points(f0).map((q) => q[1]));
  const ox = dx - pinned(f0);
  const move = (q: Pt): Pt => [q[0] + ox, q[1] + dy];
  const frame: Frame = {
    head: move(f0.head),
    neck: move(f0.neck),
    shoulder: move(f0.shoulder),
    elbow: move(f0.elbow),
    wrist: move(f0.wrist),
    hip: move(f0.hip),
    knee: move(f0.knee),
    ankle: move(f0.ankle),
    toe: move(f0.toe),
    far: f0.far && { knee: move(f0.far.knee), ankle: move(f0.far.ankle), toe: move(f0.far.toe) },
  };

  const out: Drawing = { frame };
  if (tpl.hold) {
    const anchor: Pt | undefined = tpl.hold === 'cable-low' ? [frame.wrist[0] + 26, SIZE.floor - 2] : tpl.hold === 'cable-high' ? [frame.wrist[0] + 24, 6] : undefined;
    out.hold = { kind: tpl.hold, at: frame.wrist, anchor };
  }
  if (tpl.props?.includes('bench')) out.bench = { x1: frame.hip[0] - 34, x2: frame.hip[0] + 6, top: frame.hip[1] + 3 };
  if (tpl.props?.includes('pullup-bar')) out.bar = { y: BAR_Y };
  return out;
}
