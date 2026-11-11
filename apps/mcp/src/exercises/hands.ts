// What the hands do in a movement: closed around a bar or handle, flat on the floor, or hanging at ease. Pure, like the
// solvers: it only says how each hand is held; the body model (`ui/shared/humanBody.ts`) turns that into finger angles.
import { BAR_RADIUS, type MotionSpec, type PatternId, type Skeleton, type Vec3, norm, sub, vec } from './motionKit';

export type HandPose =
  /** Closed around a round handle that passes through the grip point. `thumb` is the handle's direction on the thumb's side; `radius` is the handle's, in metres. */
  | { kind: 'grip'; thumb: Vec3; radius: number }
  /** Open and flat, the palm pressed on a surface it faces (`palm`), the fingers along the wrist-to-grip line. */
  | { kind: 'flat'; palm: Vec3 }
  /** Nothing in the hand: the fingers loosely curled, the palm facing `palm`. */
  | { kind: 'relaxed'; palm: Vec3 };
export interface Hands {
  L: HandPose;
  R: HandPose;
}

export const DUMBBELL_HANDLE_RADIUS = 0.014;
export const PULL_BAR_RADIUS = 0.016;
const CABLE_HANDLE_RADIUS = 0.015;

/** The patterns where the hands hold a handle of a machine or a cable (the others without a load leave the hands free). */
const HANDLES: Partial<Record<PatternId, 'bar' | 'neutral'>> = {
  pull: 'bar',
  seatedrow: 'neutral',
  pushdown: 'bar',
  facepull: 'neutral',
  straightarm: 'bar',
  crossover: 'bar',
  chestpress: 'bar',
  machinerow: 'bar',
  pecdeck: 'neutral',
  armmachine: 'bar',
};

const SIDES = [['L', 1], ['R', -1]] as const;

/**
 * How each hand is held for a movement at this pose (`spec` null: standing at ease). A bar runs across the figure: over it the
 * thumbs point at each other, under it (curls, chin-ups) away from each other. A neutral handle (a rope, a V-bar, the upright grips
 * of a pec deck) is held thumb-up: the handle is square to the forearm in the figure's side view, so a hanging arm has its thumb forward.
 */
export function handsFor(spec: MotionSpec | null, k: Skeleton): Hands {
  const out = {} as Hands;
  for (const [sfx, side] of SIDES) {
    // The solvers call +z "left": toward the middle of the figure is -z for that hand.
    const relaxed: HandPose = { kind: 'relaxed', palm: vec(-0.35, 0, -side) };
    if (!spec) {
      out[sfx] = relaxed;
      continue;
    }
    const v = spec.variant;
    if (spec.pattern === 'pushup') {
      out[sfx] = { kind: 'flat', palm: vec(0, -1, 0) };
      continue;
    }
    const across: Vec3 = vec(0, 0, v.palm === 'under' ? side : -side);
    const forearm = norm(sub(k[`grip${sfx}`], k[`wrist${sfx}`]));
    const flat = Math.hypot(forearm.x, forearm.y);
    const neutral: Vec3 = flat > 0.3 ? vec(-forearm.y / flat, forearm.x / flat, 0) : vec(0, 1, 0);
    if (v.load === 'barbell-back' || v.load === 'barbell-front' || v.load === 'barbell-hands') out[sfx] = { kind: 'grip', thumb: across, radius: BAR_RADIUS };
    else if (v.load === 'dumbbells') out[sfx] = { kind: 'grip', thumb: across, radius: DUMBBELL_HANDLE_RADIUS };
    else if (v.load === 'goblet') out[sfx] = { kind: 'grip', thumb: vec(0, 1, 0), radius: 0.012 };
    else {
      const handle = v.kind === 'rope' || v.kind === 'vbar' ? 'neutral' : HANDLES[spec.pattern];
      if (!handle) out[sfx] = relaxed;
      else out[sfx] = { kind: 'grip', thumb: handle === 'neutral' ? neutral : across, radius: spec.pattern === 'pull' ? PULL_BAR_RADIUS : CABLE_HANDLE_RADIUS };
    }
  }
  return out;
}
