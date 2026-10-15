// An artist's mannequin drawn with three.js: smooth rigid parts joined by ball joints, posed straight from the joint
// positions of a Skeleton (src/exercises/motion.ts). No rig and no model file: each part is a primitive stretched
// between two joints. Nothing here needs WebGL, so tests can build and pose it in Node.
import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { BAR_RADIUS, BENCH_HEIGHT, PLATE_RADIUS, type MotionSpec, type Skeleton, type Vec3 } from '../../src/exercises/motion';

export interface Materials {
  body: Material;
  joint: Material;
  load: Material;
  steel: Material;
  furniture: Material;
  floor: Material;
  shadow: Material;
}

export interface Palette {
  body: number;
  joint: number;
  load: number;
  steel: number;
  furniture: number;
  floor: number;
}

export function makeMaterials(p: Palette): Materials {
  const std = (color: number, roughness = 0.8) => new MeshStandardMaterial({ color, roughness, metalness: 0.05 });
  return {
    body: std(p.body),
    joint: std(p.joint),
    load: std(p.load, 0.6),
    steel: new MeshStandardMaterial({ color: p.steel, roughness: 0.35, metalness: 0.6 }),
    furniture: std(p.furniture),
    floor: new MeshBasicMaterial({ color: p.floor, transparent: true, opacity: 0.55 }),
    shadow: new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }),
  };
}

export function setPalette(m: Materials, p: Palette): void {
  (m.body as MeshStandardMaterial).color.setHex(p.body);
  (m.joint as MeshStandardMaterial).color.setHex(p.joint);
  (m.load as MeshStandardMaterial).color.setHex(p.load);
  (m.steel as MeshStandardMaterial).color.setHex(p.steel);
  (m.furniture as MeshStandardMaterial).color.setHex(p.furniture);
  (m.floor as MeshBasicMaterial).color.setHex(p.floor);
}

const v3 = (a: Vec3) => new Vector3(a.x, a.y, a.z);
const Y = new Vector3(0, 1, 0);
const mid = (a: Vec3, b: Vec3) => new Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);

/** A cylinder of unit length along +Y, so it can be stretched from one joint to another. */
function limbGeometry(rFar: number, rNear: number): BufferGeometry {
  return new CylinderGeometry(rFar, rNear, 1, 10, 1);
}

function stretch(mesh: Mesh, from: Vec3, to: Vec3): void {
  const a = v3(from);
  const d = v3(to).sub(a);
  const l = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, Math.max(l, 1e-4), 1);
  mesh.quaternion.setFromUnitVectors(Y, l > 1e-6 ? d.divideScalar(l) : Y);
}

/** Orientation with x forward, y up and z to the left, built from an up direction and a left direction. */
function basis(up: Vector3, left: Vector3): Quaternion {
  const side = left.clone().normalize();
  const forward = up.clone().cross(side).normalize();
  const u = side.clone().cross(forward).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(forward, u, side));
}

export interface Mannequin {
  group: Group;
  /** Moves every part to the given pose. */
  update(k: Skeleton): void;
  /** The limb parts and the two joints each one is stretched between (for tests). */
  segments: { from: keyof Skeleton; to: keyof Skeleton; mesh: Mesh }[];
}

export function buildMannequin(m: Materials): Mannequin {
  const group = new Group();
  const add = <T extends Mesh>(mesh: T): T => {
    group.add(mesh);
    return mesh;
  };
  const sphere = (r: number, mat: Material) => add(new Mesh(new SphereGeometry(r, 14, 10), mat));
  const ellipsoid = (rx: number, ry: number, rz: number, mat: Material) => {
    const mesh = add(new Mesh(new SphereGeometry(1, 16, 12), mat));
    mesh.userData.radii = new Vector3(rx, ry, rz);
    return mesh;
  };

  const limb = (rFar: number, rNear: number) => add(new Mesh(limbGeometry(rFar, rNear), m.body));
  // Limb pairs: [near joint, far joint, mesh]. The wide end of the cylinder is the near one (the one the limb hangs from).
  const limbs = (['L', 'R'] as const).flatMap((s) => [
    { a: `shoulder${s}`, b: `elbow${s}`, mesh: limb(0.04, 0.05) },
    { a: `elbow${s}`, b: `wrist${s}`, mesh: limb(0.032, 0.042) },
    { a: `hip${s}`, b: `knee${s}`, mesh: limb(0.06, 0.092) },
    { a: `knee${s}`, b: `ankle${s}`, mesh: limb(0.042, 0.06) },
  ]) as { a: keyof Skeleton; b: keyof Skeleton; mesh: Mesh }[];
  // Ball joints hide the seams between rigid parts.
  const balls = [
    ...(['L', 'R'] as const).flatMap((s) => [
      { at: `shoulder${s}` as keyof Skeleton, mesh: sphere(0.058, m.joint) },
      { at: `elbow${s}` as keyof Skeleton, mesh: sphere(0.046, m.joint) },
      { at: `wrist${s}` as keyof Skeleton, mesh: sphere(0.036, m.joint) },
      { at: `hip${s}` as keyof Skeleton, mesh: sphere(0.095, m.joint) },
      { at: `knee${s}` as keyof Skeleton, mesh: sphere(0.066, m.joint) },
      { at: `ankle${s}` as keyof Skeleton, mesh: sphere(0.048, m.joint) },
    ]),
  ];
  const hands = (['L', 'R'] as const).map((s) => ({ s, mesh: add(new Mesh(new BoxGeometry(0.045, 1, 0.09), m.body)) }));
  const feet = (['L', 'R'] as const).map((s) => ({ s, mesh: add(new Mesh(new BoxGeometry(1, 0.07, 0.1), m.body)) }));
  const neck = add(new Mesh(limbGeometry(0.05, 0.055), m.body));
  const head = ellipsoid(0.095, 0.115, 0.078, m.body);
  const nose = add(new Mesh(new ConeGeometry(0.02, 0.05, 6), m.joint));
  const ribcage = ellipsoid(0.105, 0.215, 0.16, m.body);
  const waist = ellipsoid(0.095, 0.12, 0.13, m.body);
  // A bar across the shoulders joins the arms to the body, the way a mannequin's shoulder line does.
  const shoulderBar = add(new Mesh(limbGeometry(0.05, 0.05), m.body));
  const pelvisBox = add(new Mesh(new BoxGeometry(0.2, 0.17, 0.3), m.body));
  const spineBall = sphere(0.05, m.joint);
  const neckBall = sphere(0.056, m.joint);

  const tmp = new Vector3();
  function update(k: Skeleton): void {
    for (const l of limbs) stretch(l.mesh, k[l.a], k[l.b]);
    for (const b of balls) b.mesh.position.copy(v3(k[b.at]));
    for (const h of hands) stretch(h.mesh, k[`wrist${h.s}` as keyof Skeleton], k[`grip${h.s}` as keyof Skeleton]);
    for (const f of feet) {
      const heel = k[`heel${f.s}` as keyof Skeleton];
      const toe = k[`toe${f.s}` as keyof Skeleton];
      f.mesh.position.copy(mid(heel, toe)).y += 0.035;
      f.mesh.scale.set(Math.hypot(toe.x - heel.x, toe.z - heel.z), 1, 1);
      f.mesh.rotation.set(0, -Math.atan2(toe.z - heel.z, toe.x - heel.x), 0);
    }

    const up = v3(k.neckBase).sub(v3(k.pelvis)).normalize();
    const left = v3(k.shoulderL).sub(v3(k.shoulderR));
    const hipLeft = v3(k.hipL).sub(v3(k.hipR));
    const torso = basis(up, left);
    ribcage.position.copy(mid(k.chest, k.neckBase)).addScaledVector(up, -0.02);
    ribcage.quaternion.copy(torso);
    ribcage.scale.copy(ribcage.userData.radii as Vector3);
    waist.position.copy(mid(k.lumbar, k.chest)).addScaledVector(up, -0.045);
    waist.quaternion.copy(torso);
    waist.scale.copy(waist.userData.radii as Vector3);
    pelvisBox.position.copy(v3(k.pelvis)).addScaledVector(up, 0.025);
    pelvisBox.quaternion.copy(basis(up, hipLeft));
    spineBall.position.copy(v3(k.lumbar));
    neckBall.position.copy(v3(k.neckBase));
    stretch(neck, k.neckBase, k.neckTop);
    stretch(shoulderBar, k.shoulderR, k.shoulderL);

    const headUp = v3(k.headTop).sub(v3(k.neckTop)).normalize();
    head.position.copy(mid(k.neckTop, k.headTop));
    const headQ = basis(headUp, left);
    head.quaternion.copy(headQ);
    head.scale.copy(head.userData.radii as Vector3);
    // The nose points the way the figure faces, so the direction is readable from the side.
    const forward = tmp.set(1, 0, 0).applyQuaternion(headQ);
    nose.position.copy(head.position).addScaledVector(forward, 0.1).addScaledVector(headUp, -0.01);
    nose.quaternion.setFromUnitVectors(Y, forward);
  }
  return { group, update, segments: limbs.map((l) => ({ from: l.a, to: l.b, mesh: l.mesh })) };
}

// ---------- the load and the furniture ----------

export interface Props {
  group: Group;
  update(k: Skeleton): void;
  /** In the side view the plates nearest the camera would hide the figure, so they are left out. */
  setSideView(on: boolean): void;
}

function barbell(m: Materials): Group {
  const g = new Group();
  const bar = new Mesh(new CylinderGeometry(BAR_RADIUS, BAR_RADIUS, 2.2, 10), m.steel);
  bar.rotation.x = Math.PI / 2; // along z
  g.add(bar);
  for (const side of [1, -1]) {
    for (const [i, thick] of [[0, 0.03], [1, 0.022]] as const) {
      const r = i === 0 ? PLATE_RADIUS : 0.18;
      const plate = new Mesh(new CylinderGeometry(r, r, thick, 20), m.load);
      plate.rotation.x = Math.PI / 2;
      plate.position.z = side * (0.52 + i * 0.045);
      plate.userData.screen = true;
      g.add(plate);
    }
    const collar = new Mesh(new CylinderGeometry(0.03, 0.03, 0.03, 10), m.steel);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = side * 0.62;
    collar.userData.screen = true;
    g.add(collar);
  }
  return g;
}

function dumbbell(m: Materials): Group {
  const g = new Group();
  const handle = new Mesh(new CylinderGeometry(0.014, 0.014, 0.15, 8), m.steel);
  handle.rotation.x = Math.PI / 2;
  g.add(handle);
  for (const side of [1, -1]) {
    const head = new Mesh(new CylinderGeometry(0.06, 0.06, 0.06, 6), m.load);
    head.rotation.x = Math.PI / 2;
    head.position.z = side * 0.095;
    head.userData.screen = true;
    g.add(head);
  }
  return g;
}

function kettlebell(m: Materials): Group {
  const g = new Group();
  const body = new Mesh(new SphereGeometry(0.085, 14, 10), m.load);
  body.position.y = -0.04;
  const handle = new Mesh(new TorusGeometry(0.05, 0.012, 8, 14), m.load);
  handle.position.y = 0.06;
  g.add(body, handle);
  return g;
}

function bench(m: Materials): Group {
  const g = new Group();
  const top = new Mesh(new BoxGeometry(1.25, 0.08, 0.3), m.furniture);
  top.position.set(-0.28, BENCH_HEIGHT - 0.04, 0);
  g.add(top);
  for (const x of [-0.8, 0.22]) {
    for (const z of [0.1, -0.1]) {
      const leg = new Mesh(new BoxGeometry(0.05, BENCH_HEIGHT - 0.08, 0.05), m.furniture);
      leg.position.set(x, (BENCH_HEIGHT - 0.08) / 2, z);
      g.add(leg);
    }
  }
  return g;
}

/** The load and furniture for an exercise; they follow the pose through `update`. */
export function buildProps(spec: MotionSpec, m: Materials): Props {
  const group = new Group();
  const floor = new Mesh(new CircleGeometry(1.3, 40), m.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(spec.pattern === 'bench' ? -0.15 : 0.05, 0.001, 0);
  group.add(floor);
  if (spec.pattern === 'bench') group.add(bench(m));

  const load = spec.variant.load;
  const bar = load === 'barbell-back' || load === 'barbell-front' || load === 'barbell-hands' ? barbell(m) : null;
  const bells = load === 'dumbbells' ? [dumbbell(m), dumbbell(m)] : [];
  const kettle = load === 'goblet' ? kettlebell(m) : null;
  for (const o of [bar, kettle, ...bells]) if (o) group.add(o);

  let sideView = false;
  const screens: Object3D[] = [];
  group.traverse((o) => {
    if (o.userData.screen) screens.push(o);
  });
  const world = new Vector3();
  const applySide = () => {
    group.updateMatrixWorld(true);
    for (const o of screens) o.visible = !(sideView && o.getWorldPosition(world).z > 0);
  };

  return {
    group,
    setSideView(on: boolean) {
      sideView = on;
      applySide();
    },
    update(k: Skeleton) {
      bar?.position.copy(v3(k.bar));
      kettle?.position.copy(v3(k.bar));
      if (bells.length) {
        bells[0]!.position.copy(v3(k.gripL));
        bells[1]!.position.copy(v3(k.gripR));
      }
      if (sideView) applySide();
    },
  };
}
