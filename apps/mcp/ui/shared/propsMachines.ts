// Frames, seats, pads and handles of gym machines for the exercise animation. Plain three.js geometry; each builder returns
// its group and the parts that follow the pose (the caller moves them from the skeleton each frame).
import { BoxGeometry, CylinderGeometry, Group, Mesh, Quaternion, Vector3, type Material } from 'three';
import type { MotionSpec, Skeleton, Vec3 } from '../../src/exercises/motion';
import { CALF, LEG_PRESS, LYING_CURL, SEAT } from '../../src/exercises/motionMachines';
import type { Materials } from './props';

/** The two uprights of a Smith machine with a sleeve on each that rides at the bar's height. */
export function smithFrame(m: Materials): { group: Group; sleeves: Mesh[] } {
  const g = new Group();
  const height = 2.3;
  const sleeves: Mesh[] = [];
  for (const z of [0.72, -0.72]) {
    const post = new Mesh(new BoxGeometry(0.07, height, 0.07), m.furniture);
    post.position.set(0, height / 2, z);
    post.userData.screen = z > 0 ? true : undefined;
    const foot = new Mesh(new BoxGeometry(0.5, 0.04, 0.09), m.furniture);
    foot.position.set(0, 0.02, z);
    foot.userData.screen = z > 0 ? true : undefined;
    const sleeve = new Mesh(new CylinderGeometry(0.045, 0.045, 0.1, 12), m.steel);
    sleeve.position.set(0, 1, z);
    sleeve.userData.screen = z > 0 ? true : undefined;
    sleeves.push(sleeve);
    g.add(post, foot, sleeve);
  }
  const beam = new Mesh(new BoxGeometry(0.07, 0.07, 1.5), m.furniture);
  beam.position.set(0, height, 0);
  g.add(beam);
  return { group: g, sleeves };
}

// ---------- seated and lying machines ----------

const v3 = (a: Vec3) => new Vector3(a.x, a.y, a.z);
const UP = new Vector3(0, 1, 0);

export interface MachineProps {
  group: Group;
  update(k: Skeleton): void;
}

/** A solid box of the given size (x, y, z) at a place, turned about z by `tilt` (radians). */
function slab(g: Group, mat: Material, size: [number, number, number], at: [number, number, number], tilt = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), mat);
  mesh.position.set(...at);
  mesh.rotation.z = tilt;
  g.add(mesh);
  return mesh;
}

/** A cylinder across the machine (along z). */
function roller(g: Group, mat: Material, radius: number, length: number, at: [number, number, number]): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 14), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(...at);
  g.add(mesh);
  return mesh;
}

/** A thin round bar between two points that is re-aimed whenever the points move. */
function link(g: Group, mat: Material, radius = 0.017): (from: Vec3 | Vector3, to: Vec3 | Vector3) => void {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, 1, 8), mat);
  g.add(mesh);
  return (from, to) => {
    const a = from instanceof Vector3 ? from : v3(from);
    const d = (to instanceof Vector3 ? to : v3(to)).clone().sub(a);
    const len = Math.max(d.length(), 1e-4);
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, d.divideScalar(len)));
  };
}

/** The seat and back pad of a seated machine, the back reclined `lean` from vertical, with a stem and a base. */
function seat(g: Group, m: Materials, hip: { x: number; y: number }, lean: number, backHeight = 0.7): void {
  slab(g, m.furniture, [0.5, 0.09, 0.4], [hip.x + 0.12, hip.y - 0.1, 0]);
  const t = { x: -Math.sin(lean), y: Math.cos(lean) };
  const back = slab(g, m.furniture, [0.1, backHeight, 0.4], [hip.x - 0.12 + t.x * (backHeight / 2), hip.y - 0.02 + t.y * (backHeight / 2), 0], lean);
  back.userData.keep = true;
  slab(g, m.furniture, [0.07, hip.y - 0.15, 0.07], [hip.x + 0.1, (hip.y - 0.15) / 2, 0]);
  slab(g, m.furniture, [1.1, 0.04, 0.5], [hip.x + 0.2, 0.02, 0]);
}

/** A pair of handles (short rollers along x) that follow the hands, with a lever to a pivot. */
function handles(g: Group, m: Materials, pivot: (k: Skeleton, side: 1 | -1) => Vec3 | Vector3): (k: Skeleton) => void {
  const levers = [link(g, m.steel), link(g, m.steel)];
  const grips = [0, 1].map(() => {
    const mesh = new Mesh(new CylinderGeometry(0.018, 0.018, 0.14, 10), m.steel);
    mesh.rotation.x = Math.PI / 2;
    g.add(mesh);
    return mesh;
  });
  return (k) => {
    ([1, -1] as const).forEach((side, i) => {
      const grip = side === 1 ? k.gripL : k.gripR;
      grips[i]!.position.set(grip.x, grip.y, grip.z);
      levers[i]!(pivot(k, side), grip);
    });
  };
}

/** The furniture and moving parts of a machine for a movement, or null when the movement has none (free weights, the Smith frame). */
export function machineProps(spec: MotionSpec, m: Materials): MachineProps | null {
  const g = new Group();
  const kind = spec.variant.kind;
  switch (spec.pattern) {
    case 'legpress': {
      const { beta, gamma, hip } = LEG_PRESS;
      const t = { x: -Math.sin(beta), y: Math.cos(beta) };
      const front = { x: Math.cos(beta), y: Math.sin(beta) };
      slab(g, m.furniture, [0.8, 0.1, 0.46], [hip.x + t.x * 0.34 - front.x * 0.12, hip.y + t.y * 0.34 - front.y * 0.12, 0], beta - Math.PI / 2 + Math.PI / 2 - 0);
      slab(g, m.furniture, [0.4, 0.1, 0.46], [hip.x + 0.12, hip.y - 0.1, 0]);
      for (const z of [0.4, -0.4]) slab(g, m.furniture, [1.7, 0.06, 0.06], [hip.x + Math.cos(gamma) * 0.95, hip.y + Math.sin(gamma) * 0.95 - 0.12, z], gamma);
      slab(g, m.furniture, [1.8, 0.04, 0.9], [hip.x + 0.4, 0.02, 0]);
      const plate = slab(g, m.furniture, [0.06, 0.55, 0.7], [0, 0, 0], gamma);
      for (const z of [0.3, -0.3]) roller(g, m.steel, 0.018, 0.14, [hip.x + 0.05, hip.y + 0.14, z]);
      return {
        group: g,
        update(k) {
          plate.position.set(k.bar.x, k.bar.y, 0);
        },
      };
    }
    case 'kneemachine': {
      seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, SEAT.lean);
      const pad = roller(g, m.steel, 0.05, 0.36, [0, 0, 0]);
      const arm = [link(g, m.steel, 0.02), link(g, m.steel, 0.02)];
      const pivot = new Vector3(SEAT.hipX + 0.5, 0.4, 0);
      for (const z of [0.3, -0.3]) roller(g, m.steel, 0.018, 0.14, [SEAT.hipX + 0.1, SEAT.hipY + 0.2, z]);
      // A thigh pad holds the legs down.
      roller(g, m.furniture, 0.05, 0.4, [SEAT.hipX + 0.3, SEAT.hipY + 0.1, 0]);
      return {
        group: g,
        update(k) {
          pad.position.set(k.bar.x, k.bar.y, 0);
          arm[0]!(pivot.clone().setZ(0.2), new Vector3(k.bar.x, k.bar.y, 0.2));
          arm[1]!(pivot.clone().setZ(-0.2), new Vector3(k.bar.x, k.bar.y, -0.2));
        },
      };
    }
    case 'lyingcurl': {
      slab(g, m.furniture, [1.2, 0.1, 0.36], [0.17, LYING_CURL.bench - 0.03, 0]);
      for (const x of [-0.35, 0.65]) for (const z of [0.14, -0.14]) slab(g, m.furniture, [0.05, LYING_CURL.bench - 0.08, 0.05], [x, (LYING_CURL.bench - 0.08) / 2, z]);
      const pad = roller(g, m.steel, 0.05, 0.3, [0, 0, 0]);
      const arm = link(g, m.steel, 0.02);
      for (const z of [0.2, -0.2]) roller(g, m.steel, 0.018, 0.14, [0.82, LYING_CURL.bench + 0.19, z]);
      return {
        group: g,
        update(k) {
          pad.position.set(k.bar.x, k.bar.y, 0);
          arm(new Vector3(-0.52, 0.45, 0), new Vector3(k.bar.x, k.bar.y, 0));
        },
      };
    }
    case 'chestpress': {
      seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, SEAT.lean, 0.9);
      slab(g, m.furniture, [0.08, 1.7, 0.1], [SEAT.hipX - 0.32, 0.85, 0]);
      const moveHandles = handles(g, m, (k, side) => new Vector3(k.shoulderL.x - 0.28, k.shoulderL.y + 0.1, side * 0.46));
      return { group: g, update: moveHandles };
    }
    case 'press': {
      if (spec.variant.load !== 'machine') return null;
      seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, 0.02, 1.0);
      slab(g, m.furniture, [0.08, 2, 0.1], [SEAT.hipX - 0.32, 1, 0]);
      const moveHandles = handles(g, m, (k, side) => new Vector3(k.shoulderL.x - 0.32, k.shoulderL.y + 0.55, side * 0.46));
      return { group: g, update: moveHandles };
    }
    case 'machinerow': {
      seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, 0, 0.3);
      slab(g, m.furniture, [0.1, 0.5, 0.4], [SEAT.hipX + 0.3, SEAT.hipY + 0.4, 0], 0.12);
      slab(g, m.furniture, [0.08, 1.4, 0.1], [SEAT.hipX + 0.7, 0.7, 0]);
      const moveHandles = handles(g, m, (k) => new Vector3(k.shoulderL.x + 0.8, k.shoulderL.y - 0.1, 0.0));
      return { group: g, update: moveHandles };
    }
    case 'pecdeck': {
      const reverse = kind === 'reverse';
      seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, reverse ? 0 : SEAT.lean, reverse ? 0.3 : 0.8);
      if (reverse) slab(g, m.furniture, [0.1, 0.5, 0.4], [SEAT.hipX + 0.3, SEAT.hipY + 0.45, 0], 0.1);
      const px = reverse ? SEAT.hipX + 0.6 : SEAT.hipX - 0.3;
      for (const z of [0.38, -0.38]) slab(g, m.furniture, [0.08, 1.45, 0.08], [px, 0.72, z]);
      slab(g, m.furniture, [0.08, 0.08, 0.84], [px, 1.45, 0]);
      const arms = [link(g, m.steel, 0.02), link(g, m.steel, 0.02)];
      const pads = [0, 1].map(() => slab(g, m.furniture, reverse ? [0.05, 0.14, 0.05] : [0.07, 0.42, 0.12], [0, 0, 0]));
      return {
        group: g,
        update(k) {
          ([1, -1] as const).forEach((side, i) => {
            const target = reverse ? (side === 1 ? k.gripL : k.gripR) : side === 1 ? k.elbowL : k.elbowR;
            arms[i]!(new Vector3(px, k.shoulderL.y, side * 0.38), target);
            const wrist = side === 1 ? k.wristL : k.wristR;
            const mid = reverse ? target : { x: (target.x + wrist.x) / 2, y: (target.y + wrist.y) / 2, z: (target.z + wrist.z) / 2 };
            pads[i]!.position.set(mid.x + (reverse ? 0 : 0.0), mid.y, mid.z);
          });
        },
      };
    }
    case 'armmachine': {
      seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, 0.05, 0.8);
      const lever = [link(g, m.steel, 0.02), link(g, m.steel, 0.02)];
      const pad = slab(g, m.furniture, [0.3, 0.06, 0.34], [0, 0, 0]);
      const dip = kind === 'dip';
      return {
        group: g,
        update(k) {
          ([1, -1] as const).forEach((side, i) => {
            const grip = side === 1 ? k.gripL : k.gripR;
            const elbow = side === 1 ? k.elbowL : k.elbowR;
            lever[i]!(dip ? new Vector3(grip.x - 0.1, grip.y + 0.5, grip.z) : elbow, grip);
          });
          if (dip) {
            pad.visible = false;
            return;
          }
          // The pad lies along the upper arms, just beneath them.
          const sh = k.shoulderL;
          const el = k.elbowL;
          const mid = new Vector3(sh.x * 0.45 + el.x * 0.55, sh.y * 0.45 + el.y * 0.55 - 0.07, 0);
          pad.position.copy(mid);
          pad.rotation.z = Math.atan2(el.y - sh.y, el.x - sh.x);
        },
      };
    }
    case 'calf': {
      const seated = kind === 'seated';
      slab(g, m.furniture, [0.55, CALF.block, 0.5], [(seated ? SEAT.hipX + 0.43 : 0) + CALF.ballFromAnkle - 0.1, CALF.block / 2, 0]);
      if (seated) {
        seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, 0.0, 0.7);
        const pad = roller(g, m.furniture, 0.06, 0.4, [0, 0, 0]);
        return {
          group: g,
          update(k) {
            pad.position.set(k.kneeL.x, k.kneeL.y + 0.1, 0);
          },
        };
      }
      if (spec.variant.rails) return { group: g, update() {} };
      // A standing machine: two shoulder pads on posts.
      const pads = [0.17, -0.17].map((z) => roller(g, m.furniture, 0.06, 0.2, [0, 0, z]));
      for (const z of [0.36, -0.36]) {
        const post = slab(g, m.furniture, [0.07, 2.2, 0.07], [-0.05, 1.1, z]);
        post.userData.screen = z > 0 ? true : undefined;
      }
      return {
        group: g,
        update(k) {
          pads.forEach((p) => p.position.set(k.shoulderL.x - 0.02, k.shoulderL.y + 0.07, p.position.z));
        },
      };
    }
    case 'hipmachine': {
      seat(g, m, { x: SEAT.hipX, y: SEAT.hipY }, 0.03, 0.8);
      const pads = [0, 1].map(() => slab(g, m.furniture, [0.1, 0.24, 0.12], [0, 0, 0]));
      const levers = [link(g, m.steel, 0.02), link(g, m.steel, 0.02)];
      const inner = kind === 'adductor';
      return {
        group: g,
        update(k) {
          ([1, -1] as const).forEach((side, i) => {
            const knee = side === 1 ? k.kneeL : k.kneeR;
            const z = knee.z + side * (inner ? -0.1 : 0.1);
            pads[i]!.position.set(knee.x, knee.y, z);
            levers[i]!(new Vector3(SEAT.hipX + 0.1, 0.25, 0), new Vector3(knee.x, knee.y - 0.1, z));
          });
        },
      };
    }
    default:
      return null;
  }
}
