// An artist's mannequin drawn with three.js: smooth rigid parts joined by ball joints, posed straight from the joint
// positions of a Skeleton (src/exercises/motion.ts). No rig and no model file: each part is a primitive stretched
// between two joints. Nothing here needs WebGL, so tests can build and pose it in Node.
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { BAR_RADIUS, BENCH_HEIGHT, BODY, PLATE_RADIUS, type MotionSpec, type Skeleton, type Vec3 } from '../../src/exercises/motion';

export interface Materials {
  body: Material;
  /** The muscle layer: the plain tone, and the two highlight tones for the muscles an exercise works. */
  muscle: Material;
  musclePrimary: Material;
  muscleSecondary: Material;
  joint: Material;
  load: Material;
  steel: Material;
  furniture: Material;
  floor: Material;
  shadow: Material;
}

export interface Palette {
  /** The tint laid over the muscles an exercise works. */
  tint: number;
  body: number;
  muscle: number;
  joint: number;
  load: number;
  steel: number;
  furniture: number;
  floor: number;
}

/** A blend of two 0xRRGGBB colours. */
function mixHex(a: number, b: number, t: number): number {
  return new Color(a).lerp(new Color(b), t).getHex();
}

/** Fine surface detail, drawn once with a canvas: a skin grain for the body and lengthwise fibre lines for the muscles. */
export interface Textures {
  skin: Texture;
  fibre: Texture;
}

/** A small seeded random generator, so the textures are the same every time. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Canvas {
  width: number;
  height: number;
  getContext(kind: '2d'): { createImageData(w: number, h: number): { data: Uint8ClampedArray }; putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void } | null;
}

function canvasTexture(size: number, paint: (px: Uint8ClampedArray, size: number) => void, repeatU: number, repeatV: number): Texture | null {
  // The server's own type checking has no DOM types, so the canvas is described by just what is used here.
  const doc = (globalThis as { document?: { createElement(tag: 'canvas'): Canvas } }).document;
  if (!doc) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(size, size);
  paint(image.data, size);
  ctx.putImageData(image, 0, 0);
  const tex = new CanvasTexture(canvas as never);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatU, repeatV);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const gray = (px: Uint8ClampedArray, i: number, v: number) => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  px[i] = c;
  px[i + 1] = c;
  px[i + 2] = c;
  px[i + 3] = 255;
};

/** Null when there is no canvas (tests in Node): the figure is then plain colour. */
export function makeTextures(): Textures | null {
  const rand = rng(7);
  // Skin: a soft, even grain with slow blotches.
  const skin = canvasTexture(
    128,
    (px, n) => {
      const blot = Array.from({ length: 9 * 9 }, () => rand());
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const bx = Math.floor((x / n) * 8);
          const by = Math.floor((y / n) * 8);
          const slow = blot[by * 9 + bx]! * 0.5 + blot[by * 9 + ((bx + 1) % 9)]! * 0.5;
          gray(px, (y * n + x) * 4, 226 + slow * 14 + rand() * 18);
        }
      }
    },
    3,
    3,
  );
  // Muscle: fibres run along the length of the muscle (the v direction), so the pattern changes across (u).
  const fibre = canvasTexture(
    256,
    (px, n) => {
      const column = Array.from({ length: n }, () => rand());
      const smooth = column.map((_, i) => (column[i]! * 2 + column[(i + 1) % n]! + column[(i + n - 1) % n]!) / 4);
      for (let y = 0; y < n; y++) {
        const sway = Math.sin((y / n) * Math.PI * 2 * 3) * 0.5 + 0.5;
        for (let x = 0; x < n; x++) {
          // Every few columns a deeper groove between bundles of fibres.
          const groove = x % 18 < 2 ? -24 : 0;
          gray(px, (y * n + x) * 4, 214 + smooth[x]! * 34 + sway * 6 + groove + rand() * 8);
        }
      }
    },
    3,
    1,
  );
  return skin && fibre ? { skin, fibre } : null;
}

/** A soft coloured film that lies on the skin over a muscle group. */
function tint(color: number, opacity: number): Material {
  return new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, transparent: true, opacity, depthWrite: false });
}

export function makeMaterials(p: Palette, textures: Textures | null = null): Materials {
  const std = (color: number, roughness = 0.8, tex?: Texture, bump = 0) =>
    new MeshStandardMaterial({ color, roughness, metalness: 0.05, ...(tex ? { map: tex, bumpMap: tex, bumpScale: bump } : {}) });
  return {
    body: std(p.body, 0.8, textures?.skin, 0.5),
    muscle: std(p.muscle, 0.7, textures?.fibre, 0.8),
    musclePrimary: tint(p.tint, 0.78),
    muscleSecondary: tint(p.tint, 0.45),
    joint: std(p.joint, 0.8, textures?.skin, 0.5),
    load: std(p.load, 0.6),
    steel: new MeshStandardMaterial({ color: p.steel, roughness: 0.35, metalness: 0.6 }),
    furniture: std(p.furniture),
    floor: new MeshBasicMaterial({ color: p.floor, transparent: true, opacity: 0.55 }),
    shadow: new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }),
  };
}

export function setPalette(m: Materials, p: Palette): void {
  (m.body as MeshStandardMaterial).color.setHex(p.body);
  (m.muscle as MeshStandardMaterial).color.setHex(p.muscle);
  (m.musclePrimary as MeshStandardMaterial).color.setHex(p.tint);
  (m.muscleSecondary as MeshStandardMaterial).color.setHex(p.tint);
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
  return new CylinderGeometry(rFar, rNear, 1, 20, 1);
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

// ---------- the muscle layer ----------
// Each muscle is an ellipsoid laid along a limb segment (or on the torso). Names are the muscle names of the exercise
// library, so the muscles an exercise works can be lit up with the same words as the muscle drawing.

type Segment = 'upperArm' | 'forearm' | 'thigh' | 'shin';
const SEGMENT_LENGTH: Record<Segment, number> = { upperArm: BODY.upperArm, forearm: BODY.forearm, thigh: BODY.thigh, shin: BODY.shin };
const SEGMENT_JOINTS: Record<Segment, [string, string]> = { upperArm: ['shoulder', 'elbow'], forearm: ['elbow', 'wrist'], thigh: ['hip', 'knee'], shin: ['knee', 'ankle'] };

/** How a muscle swells along its length: where it is fullest (0 at the near end, 1 at the far end) and how full it is. */
interface Belly {
  /** Where the muscle is thickest. */
  peak: number;
  /** Below 1 the muscle is full along its length, above 1 it tapers sharply. */
  power: number;
}

interface LimbMuscle extends Belly {
  muscle: string;
  seg: Segment;
  /** Start and end along the segment, 0 at the proximal joint, 1 at the distal one. */
  f0: number;
  f1: number;
  /** Offset toward the front (positive) or the back of the limb, and toward the outside (positive) or the inside. */
  front: number;
  lat: number;
  /** Half thickness front to back and side to side at the thickest point. */
  rA: number;
  rL: number;
}
const LIMB_MUSCLES: LimbMuscle[] = [
  { muscle: 'shoulders', seg: 'upperArm', f0: -0.2, f1: 0.5, front: 0, lat: 0.026, rA: 0.058, rL: 0.056, peak: 0.34, power: 0.7 },
  { muscle: 'biceps', seg: 'upperArm', f0: 0.1, f1: 0.92, front: 0.03, lat: 0, rA: 0.034, rL: 0.035, peak: 0.42, power: 0.75 },
  { muscle: 'triceps', seg: 'upperArm', f0: 0.08, f1: 0.92, front: -0.034, lat: 0.004, rA: 0.036, rL: 0.04, peak: 0.4, power: 0.7 },
  { muscle: 'forearms', seg: 'forearm', f0: -0.04, f1: 0.86, front: 0.004, lat: 0, rA: 0.038, rL: 0.04, peak: 0.2, power: 0.8 },
  { muscle: 'quadriceps', seg: 'thigh', f0: 0.06, f1: 0.96, front: 0.036, lat: 0.006, rA: 0.062, rL: 0.07, peak: 0.46, power: 0.62 },
  { muscle: 'hamstrings', seg: 'thigh', f0: 0.08, f1: 0.95, front: -0.042, lat: 0, rA: 0.054, rL: 0.062, peak: 0.4, power: 0.7 },
  { muscle: 'adductors', seg: 'thigh', f0: 0.03, f1: 0.8, front: -0.004, lat: -0.042, rA: 0.04, rL: 0.036, peak: 0.28, power: 0.8 },
  { muscle: 'abductors', seg: 'thigh', f0: -0.14, f1: 0.4, front: 0.0, lat: 0.064, rA: 0.05, rL: 0.038, peak: 0.4, power: 0.8 },
  { muscle: 'calves', seg: 'shin', f0: 0.04, f1: 0.72, front: -0.038, lat: 0.002, rA: 0.052, rL: 0.056, peak: 0.28, power: 0.72 },
];

type Origin = 'rib' | 'waist' | 'neckBase' | 'lumbar' | 'pelvis';
interface TorsoMuscle extends Belly {
  muscle: string;
  origin: Origin;
  /** Offset forward, up and to the left of the origin, in the body's own directions. */
  f: number;
  u: number;
  l: number;
  /** Radii forward, up and left. */
  rx: number;
  ry: number;
  rz: number;
  mirror: boolean;
}
/** The rectus abdominis: three rows of two rounded segments, which is what gives the abdomen its look. */
const ABS: TorsoMuscle[] = [0.075, 0.005, -0.065].map((u) => ({ muscle: 'abdominals', origin: 'waist' as const, f: 0.092, u, l: 0.038, rx: 0.014, ry: 0.046, rz: 0.042, mirror: true, peak: 0.5, power: 0.5 }));
const TORSO_MUSCLES: TorsoMuscle[] = [
  { muscle: 'chest', origin: 'rib', f: 0.085, u: 0.05, l: 0.08, rx: 0.05, ry: 0.09, rz: 0.11, mirror: true, peak: 0.5, power: 0.6 },
  ...ABS,
  { muscle: 'lats', origin: 'rib', f: -0.07, u: -0.04, l: 0.13, rx: 0.044, ry: 0.17, rz: 0.08, mirror: true, peak: 0.3, power: 0.8 },
  { muscle: 'traps', origin: 'neckBase', f: -0.05, u: -0.085, l: 0, rx: 0.042, ry: 0.12, rz: 0.17, mirror: false, peak: 0.45, power: 0.95 },
  { muscle: 'middle back', origin: 'rib', f: -0.098, u: 0.0, l: 0, rx: 0.032, ry: 0.11, rz: 0.11, mirror: false, peak: 0.5, power: 0.7 },
  { muscle: 'lower back', origin: 'lumbar', f: -0.088, u: 0.03, l: 0.042, rx: 0.034, ry: 0.125, rz: 0.036, mirror: true, peak: 0.5, power: 0.8 },
  { muscle: 'glutes', origin: 'pelvis', f: -0.075, u: -0.015, l: 0.078, rx: 0.09, ry: 0.088, rz: 0.088, mirror: true, peak: 0.5, power: 0.6 },
  { muscle: 'neck', origin: 'neckBase', f: 0, u: 0.045, l: 0, rx: 0.062, ry: 0.065, rz: 0.062, mirror: false, peak: 0.5, power: 0.5 },
];

const bellies = new Map<string, BufferGeometry>();
/**
 * A muscle belly of unit radius from y = +1 (near end) to y = -1 (far end): pointed at both ends, fullest at `peak`.
 * Scaled by its thickness and half length it becomes one muscle.
 */
function belly({ peak, power }: Belly): BufferGeometry {
  const key = `${peak}|${power}`;
  let g = bellies.get(key);
  if (!g) {
    const rings = 20;
    const pts: Vector2[] = [];
    // Points run from the far end (y = -1) to the near end (y = +1) so the surface faces outward.
    for (let i = 0; i <= rings; i++) {
      const t = 1 - i / rings; // distance from the near end, 0 to 1
      const swell = t < peak ? (0.5 * t) / peak : 0.5 + (0.5 * (t - peak)) / (1 - peak);
      pts.push(new Vector2(Math.pow(Math.sin(Math.PI * swell), power), -1 + (2 * i) / rings));
    }
    g = new LatheGeometry(pts, 20);
    bellies.set(key, g);
  }
  return g;
}

/** Every muscle name the figure can show. */
export const MUSCLE_NAMES = [...new Set([...LIMB_MUSCLES.map((m) => m.muscle), ...TORSO_MUSCLES.map((m) => m.muscle)])];

export interface Mannequin {
  group: Group;
  /** Moves every part to the given pose. */
  update(k: Skeleton): void;
  /** The limb parts and the two joints each one is stretched between (for tests). */
  segments: { from: keyof Skeleton; to: keyof Skeleton; mesh: Mesh }[];
  /** The muscle meshes by library muscle name, each with its tint overlay (for tests and highlighting). */
  muscles: { muscle: string; mesh: Mesh; overlay: Mesh }[];
  /** Tints the muscles an exercise works: main in the accent colour, secondary in a lighter tone. */
  setHighlight(primary: Iterable<string>, secondary: Iterable<string>): void;
  /** Turns the tint on or off; the muscle shapes stay, as contours under the skin. */
  setHighlightVisible(on: boolean): void;
}

export function buildMannequin(m: Materials): Mannequin {
  const group = new Group();
  const add = <T extends Mesh>(mesh: T): T => {
    group.add(mesh);
    return mesh;
  };
  const sphere = (r: number, mat: Material) => add(new Mesh(new SphereGeometry(r, 24, 16), mat));
  const ellipsoid = (rx: number, ry: number, rz: number, mat: Material) => {
    const mesh = add(new Mesh(new SphereGeometry(1, 24, 16), mat));
    mesh.userData.radii = new Vector3(rx, ry, rz);
    return mesh;
  };

  const limb = (rFar: number, rNear: number) => add(new Mesh(limbGeometry(rFar, rNear), m.body));
  // Limb pairs: [near joint, far joint, mesh]. The wide end of the cylinder is the near one (the one the limb hangs from).
  const limbs = (['L', 'R'] as const).flatMap((s) => [
    { a: `shoulder${s}`, b: `elbow${s}`, mesh: limb(0.04, 0.048) },
    { a: `elbow${s}`, b: `wrist${s}`, mesh: limb(0.031, 0.04) },
    { a: `hip${s}`, b: `knee${s}`, mesh: limb(0.06, 0.082) },
    { a: `knee${s}`, b: `ankle${s}`, mesh: limb(0.042, 0.056) },
  ]) as { a: keyof Skeleton; b: keyof Skeleton; mesh: Mesh }[];
  // Ball joints hide the seams between rigid parts.
  const balls = [
    ...(['L', 'R'] as const).flatMap((s) => [
      { at: `shoulder${s}` as keyof Skeleton, mesh: sphere(0.064, m.joint) },
      { at: `elbow${s}` as keyof Skeleton, mesh: sphere(0.05, m.joint) },
      { at: `wrist${s}` as keyof Skeleton, mesh: sphere(0.04, m.joint) },
      { at: `hip${s}` as keyof Skeleton, mesh: sphere(0.1, m.joint) },
      { at: `knee${s}` as keyof Skeleton, mesh: sphere(0.07, m.joint) },
      { at: `ankle${s}` as keyof Skeleton, mesh: sphere(0.052, m.joint) },
    ]),
  ];
  const hands = (['L', 'R'] as const).map((s) => ({ s, mesh: add(new Mesh(new SphereGeometry(1, 12, 8), m.body)) }));
  const feet = (['L', 'R'] as const).map((s) => ({ s, mesh: add(new Mesh(new SphereGeometry(1, 20, 12), m.body)) }));
  const neck = add(new Mesh(limbGeometry(0.05, 0.055), m.body));
  const head = ellipsoid(0.095, 0.115, 0.078, m.body);
  const nose = add(new Mesh(new ConeGeometry(0.02, 0.05, 6), m.joint));
  const ribcage = ellipsoid(0.115, 0.225, 0.172, m.body);
  const waist = ellipsoid(0.105, 0.135, 0.14, m.body);
  // A bar across the shoulders joins the arms to the body, the way a mannequin's shoulder line does.
  const shoulderBar = add(new Mesh(limbGeometry(0.05, 0.05), m.body));
  const pelvisBox = ellipsoid(0.115, 0.095, 0.165, m.body);
  const spineBall = sphere(0.1, m.joint);
  const neckBall = sphere(0.062, m.joint);

  // The muscle layer.
  const muscles: { muscle: string; mesh: Mesh; overlay: Mesh }[] = [];
  const muscleMesh = (muscle: string, shape: Belly) => {
    const mesh = new Mesh(belly(shape), m.muscle);
    mesh.userData.muscle = muscle;
    group.add(mesh);
    // The tint is a slightly larger copy of the muscle, shown only for the muscles an exercise works.
    const overlay = new Mesh(belly(shape), m.musclePrimary);
    overlay.visible = false;
    overlay.renderOrder = 2;
    group.add(overlay);
    muscles.push({ muscle, mesh, overlay });
    return mesh;
  };
  const limbMuscles = LIMB_MUSCLES.flatMap((lm) => ([1, -1] as const).map((side) => ({ lm, side, mesh: muscleMesh(lm.muscle, lm) })));
  const torsoMuscles = TORSO_MUSCLES.flatMap((tm) => (tm.mirror ? ([1, -1] as const) : ([1] as const)).map((side) => ({ tm, side, mesh: muscleMesh(tm.muscle, tm) })));
  let highlighted = { primary: new Set<string>(), secondary: new Set<string>() };
  let tint = true;
  const paint = () => {
    for (const { muscle, overlay } of muscles) {
      const main = highlighted.primary.has(muscle);
      overlay.visible = tint && (main || highlighted.secondary.has(muscle));
      overlay.material = main ? m.musclePrimary : m.muscleSecondary;
    }
  };

  const tmp = new Vector3();
  function update(k: Skeleton): void {
    for (const l of limbs) stretch(l.mesh, k[l.a], k[l.b]);
    for (const b of balls) b.mesh.position.copy(v3(k[b.at]));
    for (const h of hands) {
      // A rounded fist along the line from the wrist to the grip.
      const w = k[`wrist${h.s}` as keyof Skeleton];
      const g = k[`grip${h.s}` as keyof Skeleton];
      const d = v3(g).sub(v3(w));
      h.mesh.position.copy(mid(w, g)).addScaledVector(d.clone().normalize(), 0.012);
      h.mesh.quaternion.setFromUnitVectors(Y, d.normalize());
      h.mesh.scale.set(0.03, 0.058, 0.04);
    }
    for (const f of feet) {
      const heel = k[`heel${f.s}` as keyof Skeleton];
      const toe = k[`toe${f.s}` as keyof Skeleton];
      f.mesh.position.copy(mid(heel, toe)).y += 0.03;
      f.mesh.scale.set(Math.hypot(toe.x - heel.x, toe.z - heel.z) / 2, 0.04, 0.05);
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
    pelvisBox.scale.copy(pelvisBox.userData.radii as Vector3);
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

    // ----- muscles -----
    // The body's own directions: the figure faces +x and stands on +y, or lies with its face up and its head toward -x.
    const lying = up.x < -0.5;
    const F = lying ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const U = lying ? new Vector3(-1, 0, 0) : new Vector3(0, 1, 0);
    const Lt = F.clone().cross(U);
    const down = U.clone().negate();
    for (const { lm, side, mesh } of limbMuscles) {
      const [a, b] = SEGMENT_JOINTS[lm.seg];
      const sfx = side === 1 ? 'L' : 'R';
      const from = v3(k[`${a}${sfx}` as keyof Skeleton]);
      const axis = v3(k[`${b}${sfx}` as keyof Skeleton]).sub(from).normalize();
      // Turn the hanging limb's frame (front = F, side = Lt) to where the limb points now.
      const turn = new Quaternion().setFromUnitVectors(down, axis);
      const anterior = F.clone().applyQuaternion(turn);
      const left = Lt.clone().applyQuaternion(turn);
      const length = SEGMENT_LENGTH[lm.seg];
      mesh.position
        .copy(from)
        .addScaledVector(axis, ((lm.f0 + lm.f1) / 2) * length)
        .addScaledVector(anterior, lm.front)
        .addScaledVector(left, lm.lat * side);
      mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(anterior, axis.clone().negate(), left));
      mesh.scale.set(lm.rA, ((lm.f1 - lm.f0) * length) / 2, lm.rL);
    }
    const origins: Record<Origin, Vector3> = { rib: ribcage.position, waist: waist.position, neckBase: v3(k.neckBase), lumbar: v3(k.lumbar), pelvis: v3(k.pelvis) };
    const hipQ = basis(up, hipLeft);
    for (const { tm, side, mesh } of torsoMuscles) {
      const q = tm.origin === 'pelvis' ? hipQ : torso;
      const f = new Vector3(1, 0, 0).applyQuaternion(q);
      const u = new Vector3(0, 1, 0).applyQuaternion(q);
      const l = new Vector3(0, 0, 1).applyQuaternion(q);
      mesh.position.copy(origins[tm.origin]).addScaledVector(f, tm.f).addScaledVector(u, tm.u).addScaledVector(l, tm.l * side);
      mesh.quaternion.copy(q);
      mesh.scale.set(tm.rx, tm.ry, tm.rz);
    }
    // The tint follows its muscle, a little larger so it lies on top of the skin.
    for (const { mesh, overlay } of muscles) {
      if (!overlay.visible) continue;
      overlay.position.copy(mesh.position);
      overlay.quaternion.copy(mesh.quaternion);
      overlay.scale.set(mesh.scale.x * 1.06 + 0.002, mesh.scale.y * 1.012, mesh.scale.z * 1.06 + 0.002);
    }
  }
  return {
    group,
    update,
    segments: limbs.map((l) => ({ from: l.a, to: l.b, mesh: l.mesh })),
    muscles,
    setHighlight(primary, secondary) {
      highlighted = { primary: new Set(primary), secondary: new Set(secondary) };
      paint();
    },
    setHighlightVisible(on) {
      tint = on;
      paint();
    },
  };
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
