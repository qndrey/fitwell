// The realistic male body of the exercise animation: a rigged model (made with MPFB, see ui/assets/README.md) posed from
// the joint positions of the solvers. Each bone is aimed at where the solver puts the next joint, so the form
// rules checked on the skeleton hold for the body too. The skin carries five attributes with per-vertex muscle weights,
// which the material uses to tint the muscle groups an exercise works. three.js code without a renderer, usable in Node.
import { Bone, Color, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3, Vector4 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BAR_RADIUS, handsFor, standing, type Body, type Hands, type Skeleton } from '../../src/exercises/motion';
import type { Palette } from './props';

/** The library's muscle groups the body can show. The model divides them into parts ("heads", listed in the model itself); each vertex carries its two strongest. */
export const BODY_MUSCLES = ['abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings', 'lats', 'lower back', 'middle back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps'];

/**
 * Surface detail the model is too coarse to carry (its vertices are a centimetre apart): the grooves between muscles and
 * the six-pack, as a height field over the rest-pose position, in metres (negative is a groove). The fragment shader
 * turns its slope into a bump, so the detail is as fine as the screen and stays on the body as it moves.
 */
const DEFINITION = `
float groove(float d, float width) { return exp(-(d * d) / (width * width)); }
float definition() {
  vec3 r = vRest;
  float a = abs(r.x);
  float y = r.y;
  float front = smoothstep(-0.1, 0.4, vRestN.z);
  float back = smoothstep(0.1, -0.4, vRestN.z);
  float h = 0.0;

  // Chest: the pecs stand above a curved lower border that rises toward the arm; the breastbone and the collarbone are soft lines.
  float border = 1.205 + 1.7 * a * a;
  float pecs = front * smoothstep(0.0, 0.02, y - border) * smoothstep(1.43, 1.33, y) * smoothstep(0.2, 0.13, a) * smoothstep(0.0, 0.02, a);
  h += 0.003 * pecs;
  h -= 0.0013 * front * smoothstep(0.17, 0.12, a) * smoothstep(0.01, 0.03, a) * groove(y - border, 0.014);
  h -= 0.0012 * front * smoothstep(1.2, 1.24, y) * smoothstep(1.42, 1.38, y) * groove(r.x, 0.012);
  h -= 0.0008 * front * smoothstep(0.2, 0.15, a) * groove(y - (1.425 - 0.12 * a), 0.012);

  // Abdomen: the straight muscle in blocks (a line down the middle, three cross lines that sag away from it, an edge on each
  // side), and the diagonals of the ribs.
  float rectus = front * smoothstep(0.1, 0.08, a) * smoothstep(0.96, 0.985, y) * smoothstep(1.2, 1.18, y);
  h += 0.0012 * rectus;
  float sag = 1.8 * a * a;
  float rows = groove(y - (1.145 - sag), 0.011) + groove(y - (1.093 - sag), 0.011) + groove(y - (1.04 - sag), 0.011);
  h -= 0.0011 * rectus * (groove(r.x, 0.011) + rows);
  h -= 0.0008 * front * smoothstep(0.96, 0.99, y) * smoothstep(1.2, 1.18, y) * groove(a - 0.092, 0.014);
  float ribs = front * smoothstep(0.2, 0.15, a) * smoothstep(0.1, 0.115, a) * smoothstep(1.1, 1.14, y) * smoothstep(1.225, 1.2, y);
  h -= 0.0005 * ribs * (0.5 - 0.5 * cos(6.2832 * (y + 1.1 * a) / 0.034));

  // Back: a soft line down the spine, the two ridges of the lower back, and the shoulder blades.
  h -= 0.003 * back * smoothstep(0.95, 1.0, y) * smoothstep(1.44, 1.4, y) * groove(r.x, 0.012);
  h += 0.003 * back * smoothstep(0.95, 0.99, y) * smoothstep(1.17, 1.13, y) * groove(a - 0.045, 0.018);
  float blade = length(vec2((a - 0.115) / 0.06, (y - 1.3) / 0.08));
  h -= 0.0018 * back * groove(blade - 1.0, 0.25);
  h += 0.0025 * back * smoothstep(1.1, 0.7, blade);
  // The lats, the trapezius and the muscles between the shoulder blades stand a little proud of each other.
  h += 0.0022 * (back + 0.5 * (1.0 - back)) * smoothstep(0.3, 0.8, vSel.z);
  // The line between the buttocks.
  h -= 0.005 * back * smoothstep(0.3, 0.7, vSel.x) * groove(r.x, 0.009);
  // The thigh: the lines between the quadriceps' heads in front, and between the hamstrings behind.
  float thigh = 0.107 + 0.092 * (0.925 - y);
  float thighSpan = smoothstep(0.5, 0.58, y) * smoothstep(0.86, 0.8, y);
  h -= 0.003 * front * thighSpan * (groove(a - (thigh - 0.03), 0.01) + groove(a - (thigh + 0.034), 0.01));
  h -= 0.003 * back * thighSpan * groove(a - thigh, 0.011);
  // The two heads of the calf.
  h -= 0.003 * back * smoothstep(0.3, 0.7, vSel.y) * groove(a - (0.146 + (0.5 - y) * 0.112), 0.009);
  return h;
}
// 1 where a muscle weight is over the half-way line, with an edge as fine as the screen; and 1 on that line itself, about a pixel and a half wide.
float inside(float x) {
  float fw = max(fwidth(x) * 1.2, 0.0001);
  return smoothstep(0.5 - fw, 0.5 + fw, x);
}
float outline(float x) {
  return 1.0 - smoothstep(0.6, 1.8, abs(x - 0.5) / max(fwidth(x), 0.0001));
}
vec3 bumped(vec3 surfPos, vec3 surfNorm, vec2 dH) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

export interface HumanBody {
  /** Add this to the scene. The body faces +x (the way the solvers' figure faces) and stands on y = 0. */
  group: Group;
  /** The measurements of this body, to hand to the solvers so the pose fits it. */
  body: Body;
  /** Puts the body back in its rest pose: standing with the arms away from the sides, which shows every muscle. */
  rest(): void;
  /** Poses the body. `hands` says how each hand is held (`handsFor`): closed around a handle, flat on the floor, or at ease (the default). */
  update(k: Skeleton, hands?: Hands): void;
  /** Where the tip of a finger or thumb is now ('index', 'middle', 'ring', 'pinky' or 'thumb'; `side` as the solvers name it), in the solvers' coordinates (after `update`). For tests. */
  fingertip(side: 'L' | 'R', digit: string): { x: number; y: number; z: number };
  /** How the wrist is bent now, in degrees: `flex` toward the palm (negative: bent back), `deviation` toward the thumb (negative: toward the little finger). For tests. */
  wrist(side: 'L' | 'R'): { flex: number; deviation: number };
  /** The line an elbow ('arm') or a knee ('leg') bends about, where the limb's upper or lower bone carries it now, in the solvers' coordinates (after `update`). For tests. */
  hinge(limb: 'arm' | 'leg', side: 'L' | 'R', part: 'upper' | 'lower'): { x: number; y: number; z: number };
  setHighlight(primary: Iterable<string>, secondary: Iterable<string>): void;
  setHighlightVisible(on: boolean): void;
  /** Colours each muscle group on its own (a heat map) instead of the one tint; null goes back to the tint. Groups not in the map keep the skin colour. */
  setHeat(colours: Map<string, number> | null): void;
  /** The parts the model divides the muscles into, each with its muscle group. A head's name works wherever a group's does (`setHighlight`, `setHeat`). */
  heads: { name: string; group: string }[];
  /** Breathing, from -1 (breathed out) to 1 (breathed in): the ribs and belly swell a few millimetres. */
  setBreath(x: number): void;
  setPalette(p: Palette): void;
  /** The skinned mesh and the bones by name (for tests). */
  skin: SkinnedMesh;
  bones: Map<string, Bone>;
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

/** Solver coordinates (x forward, y up, z to the figure's left, as the solvers label it) to the model's (z forward, y up, x). */
const toModel = (p: { x: number; y: number; z: number }) => new Vector3(-p.z, p.y, p.x);
/** The solvers' "left" is at +z, which is the model's -x: the model's right side. */
const BONE_SIDE = { L: 'r', R: 'l' } as const;

/** Quaternion of the frame whose first axis is `a` and which lies in the plane of `a` and `b`. */
function frame(a: Vector3, b: Vector3): Quaternion {
  const e1 = a.clone().normalize();
  let e3 = e1.clone().cross(b);
  if (e3.lengthSq() < 1e-10) e3 = e1.clone().cross(Math.abs(e1.y) < 0.9 ? Y : X);
  e3.normalize();
  const e2 = e3.clone().cross(e1);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(e1, e2, e3));
}
/** The rotation that takes the rest pair (a, b) to the desired pair. */
const align = (restA: Vector3, restB: Vector3, a: Vector3, b: Vector3) => frame(a, b).multiply(frame(restA, restB).invert());
const swing = (from: Vector3, to: Vector3) => new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());

const DEG = Math.PI / 180;
/** A vertex keeps a head's number as (number + 0.5) / SLOTS (see scripts/blender/muscle_regions.py). */
const SLOTS = 64;
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
/** From the line of the hand's bones to the skin of the palm, and from a finger's bones to its pad, in metres. */
const PALM = 0.012;
const PAD = 0.008;
/** How far a finger's pad gives when it presses on a handle. */
const SQUEEZE = 0.004;
/** How far each joint of a finger bends (knuckle, middle, last), and the thumb's: its first bone swings away from the palm, the others bend. */
const FINGER_LIMITS: [number, number][] = [[-10 * DEG, 95 * DEG], [0, 110 * DEG], [0, 80 * DEG]];
const THUMB_LIMITS: [number, number][] = [[0, 80 * DEG], [0, 60 * DEG], [0, 80 * DEG]];
/** How far a wrist bends sideways, in degrees: toward the thumb and toward the little finger. */
export const WRIST_DEVIATION = { thumb: 20, little: 30 };
/** How far off square a handle may lie across the palm, in degrees, to spare the wrist. */
const DIAGONAL = 40;
/** A hand at ease: how much each joint is bent, from the index finger (least) to the little finger (most). */
const EASE: Record<(typeof FINGERS)[number], number[]> = { index: [12, 22, 10], middle: [16, 28, 12], ring: [22, 32, 14], pinky: [28, 36, 16] };

/**
 * A finger as a chain of three straight bones in the plane across a round handle: the angle of each bone (0 along the hand, a
 * quarter turn toward the palm) so that it lies on the handle, as far as its joints bend. `at` is the first joint and `centre` the
 * handle's middle, both as (along the hand, toward the palm); `sense` is 1 for a finger, which goes around the far side of the
 * handle, and -1 for the thumb, which comes around the near side.
 */
export function wrapDigit(at: [number, number], lengths: number[], centre: [number, number], radius: number, sense: 1 | -1, limits: [number, number][]): number[] {
  let [x, y] = at;
  let previous = 0;
  return lengths.map((l, j) => {
    const vx = centre[0] - x;
    const vy = centre[1] - y;
    const d = Math.hypot(vx, vy);
    // The bone touches the handle: along the tangent, or, when the joint is already at the handle, with its middle on it.
    let off = d > radius ? Math.asin(radius / d) : Math.PI / 2;
    if (d * Math.cos(off) < l / 2) {
      off = Math.acos(Math.min(1, l / 2 / d));
      if (d * Math.sin(off) < radius - SQUEEZE) off = d > radius - SQUEEZE ? Math.asin((radius - SQUEEZE) / d) : Math.PI / 2;
    }
    const wanted = Math.atan2(vy, vx) - sense * off;
    const [lo, hi] = limits[j]!;
    const turn = j === 0 ? wanted : sense * (wanted - previous);
    const bend = Math.min(hi, Math.max(lo, Math.atan2(Math.sin(turn), Math.cos(turn))));
    const angle = j === 0 ? bend : previous + sense * bend;
    x += l * Math.cos(angle);
    y += l * Math.sin(angle);
    previous = angle;
    return angle;
  });
}

export async function loadHumanBody(glb: ArrayBuffer, palette: Palette): Promise<HumanBody> {
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  let skin: SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skin = o as SkinnedMesh;
  });
  if (!skin) throw new Error('the body has no skin');
  const mesh = skin as SkinnedMesh;
  const bones = new Map<string, Bone>(mesh.skeleton.bones.map((b) => [b.name, b]));
  const bone = (n: string) => {
    const b = bones.get(n);
    if (!b) throw new Error(`the body has no bone ${n}`);
    return b;
  };

  // ----- the rest pose -----
  const restPos = new Map<string, Vector3>();
  const restWorld = new Map<string, Quaternion>();
  const restLocal = new Map<string, Quaternion>();
  const restLocalPos = new Map<string, Vector3>();
  for (const [n, b] of bones) {
    restPos.set(n, b.getWorldPosition(new Vector3()));
    restWorld.set(n, b.getWorldQuaternion(new Quaternion()));
    restLocal.set(n, b.quaternion.clone());
    restLocalPos.set(n, b.position.clone());
  }
  const P = (n: string) => restPos.get(n)!;

  // ----- measurements, in the solvers' terms -----
  const hipMid = P('thigh_l').clone().add(P('thigh_r')).multiplyScalar(0.5);
  // The top of the head: the highest skinned vertex in the rest pose.
  mesh.skeleton.update();
  // The model is stored quantized, so each vertex's rest position is kept as plain numbers for the shader's surface detail.
  const count = mesh.geometry.getAttribute('position').count;
  const rest = new Float32Array(count * 3);
  let top = 0;
  const vertex = new Vector3();
  for (let i = 0; i < count; i++) {
    mesh.getVertexPosition(i, vertex).toArray(rest, i * 3);
    top = Math.max(top, vertex.y);
  }
  mesh.geometry.setAttribute('restPosition', new Float32BufferAttribute(rest, 3));
  const trunk = P('neck_01').y - hipMid.y;
  const body: Body = {
    ankleHeight: P('foot_l').y,
    shin: P('calf_l').distanceTo(P('foot_l')),
    thigh: P('thigh_l').distanceTo(P('calf_l')),
    pelvis: 0.1,
    lumbar: 0.22,
    chest: trunk - 0.32,
    shoulderDrop: P('neck_01').y - P('upperarm_l').y,
    neck: P('neck_01').distanceTo(P('head')),
    head: top - P('head').y,
    shoulderHalf: Math.abs(P('upperarm_l').x),
    hipHalf: Math.abs(P('thigh_l').x),
    upperArm: P('upperarm_l').distanceTo(P('lowerarm_l')),
    forearm: P('lowerarm_l').distanceTo(P('hand_l')),
    // From the wrist to the middle of a bar in the closed hand: the bar lies on the palm just short of the knuckles.
    hand: Math.hypot(P('middle_01_l').distanceTo(P('hand_l')) - (BAR_RADIUS + PAD), PALM + BAR_RADIUS),
    heelBack: 0.06,
    toeFront: 0.2,
    midfoot: 0.07,
  };
  const spineFraction = (n: string) => (P(n).y - hipMid.y) / trunk;

  // ----- the muscle heads -----
  // The model lists its heads and the muscle group of each (written by scripts/blender/make_body.py).
  const listed = (mesh.userData as { fitwell_heads?: string }).fitwell_heads ?? (mesh.parent?.userData as { fitwell_heads?: string } | undefined)?.fitwell_heads;
  if (!listed) throw new Error('the body does not list its muscle heads');
  const heads = JSON.parse(listed) as { name: string; group: string }[];
  if (heads.length > SLOTS) throw new Error('the body has more muscle heads than fit');

  // ----- the skin -----
  const tint = new Color(palette.tint);
  const uniforms = {
    /** Per head: 1 when it is a main or a helping muscle of the exercise. */
    uPri: { value: new Float32Array(heads.length) },
    uSec: { value: new Float32Array(heads.length) },
    uTint: { value: tint },
    uShow: { value: 1 },
    /** 1 while an exercise's muscles are picked out, so the rest of the skin steps back. */
    uMute: { value: 0 },
    uBreath: { value: 0 },
    /** Per head: rgb, and in w whether it is coloured at all. */
    uHeat: { value: heads.map(() => new Vector4()) },
    uHeatOn: { value: 0 },
  };
  const material = new MeshStandardMaterial({ color: palette.body, roughness: 0.62, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const n = heads.length;
    // Which heads belong to the glutes, to the calves and to the back's big muscles: the surface detail draws their lines.
    const mask = (groups: string[]) => `float[${n}](${heads.map((h) => (groups.includes(h.group) ? '1.0' : '0.0')).join(', ')})`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 _muscle;
attribute vec3 restPosition;
uniform float uPri[${n}];
uniform float uSec[${n}];
uniform vec4 uHeat[${n}];
uniform float uBreath;
const float GLUTES[${n}] = ${mask(['glutes'])};
const float CALVES[${n}] = ${mask(['calves'])};
const float BACK[${n}] = ${mask(['lats', 'traps', 'middle back'])};
varying vec2 vWorked;
varying vec4 vHeat;
varying float vSeam;
varying vec3 vSel;
varying vec3 vRest;
varying vec3 vRestN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
// The vertex's two strongest heads: each as its number (kept as (number + 0.5) / ${SLOTS}) and its weight.
int head1 = int(floor(_muscle.x * ${SLOTS}.0));
int head2 = int(floor(_muscle.z * ${SLOTS}.0));
float w1 = _muscle.y;
float w2 = _muscle.w;
vWorked = vec2(clamp(w1 * uPri[head1] + w2 * uPri[head2], 0.0, 1.0), clamp(w1 * uSec[head1] + w2 * uSec[head2], 0.0, 1.0));
// The heads' heat colours, premultiplied by whether the head is coloured.
vHeat = w1 * vec4(uHeat[head1].rgb * uHeat[head1].w, uHeat[head1].w) + w2 * vec4(uHeat[head2].rgb * uHeat[head2].w, uHeat[head2].w);
// Where two heads meet there is a groove.
vSeam = min(w1, w2);
vSel = vec3(w1 * GLUTES[head1] + w2 * GLUTES[head2], w1 * CALVES[head1] + w2 * CALVES[head2], w1 * BACK[head1] + w2 * BACK[head2]);
vRest = restPosition;
vRestN = normalize(normal);
// Breathing: the ribs, belly and flanks swell along their normals, most over the lower ribs.
transformed += normal * uBreath * 0.006 * smoothstep(0.98, 1.1, restPosition.y) * (1.0 - smoothstep(1.28, 1.4, restPosition.y)) * (1.0 - smoothstep(0.16, 0.21, abs(restPosition.x)));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uTint;\nuniform float uShow;\nuniform float uMute;\nuniform float uHeatOn;\nvarying vec2 vWorked;\nvarying vec4 vHeat;\nvarying float vSeam;\nvarying vec3 vSel;\nvarying vec3 vRest;\nvarying vec3 vRestN;\n${DEFINITION}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float relief = definition();
diffuseColor.rgb *= 1.0 - clamp(-relief * 40.0, 0.0, 0.18);
// Where two parts of the muscles meet, a faint line (in the colour only: the weights are too coarse to shape the surface with).
diffuseColor.rgb *= 1.0 - 0.07 * smoothstep(0.3, 0.5, vSeam);
if (uHeatOn > 0.5) {
  diffuseColor.rgb = mix(diffuseColor.rgb, vHeat.rgb / max(vHeat.a, 0.001), inside(vHeat.a) * 0.82 * uShow);
  diffuseColor.rgb *= 1.0 - 0.2 * outline(vHeat.a) * uShow;
} else {
  // The muscles an exercise works: the main ones in the full tint, the helping ones clearly lighter, each with a fine darker
  // edge. The rest of the skin goes a little grey while they are shown, so the tint is what the eye lands on.
  float main = inside(vWorked.x);
  float helping = inside(vWorked.y) * (1.0 - main);
  float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey) * 1.03, 0.35 * uMute * uShow);
  diffuseColor.rgb = mix(diffuseColor.rgb, uTint, (main * 0.88 + helping * 0.36) * uShow);
  diffuseColor.rgb *= 1.0 - 0.22 * max(outline(vWorked.x), outline(vWorked.y) * (1.0 - main)) * uShow;
  // Inside a lit muscle, a fine line where two of its parts meet (the heads of the quadriceps, the upper and lower chest).
  diffuseColor.rgb *= 1.0 - 0.16 * smoothstep(0.32, 0.5, vSeam) * max(main, helping) * uShow;
}`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumped(-vViewPosition, normal, vec2(dFdx(relief), dFdy(relief)));');
  };
  material.customProgramCacheKey = () => 'fitwell-human-body';
  mesh.material = material;
  mesh.frustumCulled = false;

  const group = new Group();
  group.rotation.y = Math.PI / 2; // the model faces +z; the solvers' figure faces +x
  group.add(root);

  // ----- posing -----
  const worldQ = new Map<string, Quaternion>();
  const worldP = new Map<string, Vector3>();
  const parentOf = (n: string) => bone(n).parent?.name ?? '';
  /** Sets a bone's world rotation; its position follows from its parent. */
  function setBone(n: string, q: Quaternion): void {
    const pq = worldQ.get(parentOf(n)) ?? new Quaternion();
    bone(n).quaternion.copy(pq.clone().invert().multiply(q));
    worldQ.set(n, q.clone());
  }
  /** Where a bone is now: its parent's place plus its rest offset turned by the parent's rotation. Parents are posed first. */
  function posOf(n: string): Vector3 {
    let p = worldP.get(n);
    if (!p) {
      const parent = parentOf(n);
      p = posOf(parent).clone().add(restLocalPos.get(n)!.clone().applyQuaternion(worldQ.get(parent)!));
      worldP.set(n, p);
    }
    return p;
  }

  // ----- the hands -----
  // Each hand has its own frame in the rest pose: along the hand (wrist to the middle knuckle), out of the palm, and across the
  // knuckles toward the thumb. A finger is its first joint in that frame and the lengths of its three bones.
  interface Digit {
    bones: string[];
    at: [number, number];
    /** How far the finger is from the hand's line, toward the thumb's side. */
    aside: number;
    lengths: number[];
  }
  const handRig = (m: 'l' | 'r') => {
    const wrist = P(`hand_${m}`);
    const along = P(`middle_01_${m}`).clone().sub(wrist).normalize();
    const knuckles = P(`index_01_${m}`).clone().sub(P(`pinky_01_${m}`));
    const across = knuckles.addScaledVector(along, -knuckles.dot(along)).normalize();
    const palm = along.clone().cross(across).multiplyScalar(m === 'l' ? 1 : -1);
    const digit = (f: string): Digit => {
      const bones = [1, 2, 3].map((j) => `${f}_0${j}_${m}`);
      const from = P(bones[0]!).clone().sub(wrist);
      const l1 = P(bones[0]!).distanceTo(P(bones[1]!));
      const l2 = P(bones[1]!).distanceTo(P(bones[2]!));
      // The model has no bone for the fingertip: the last bone is about as long as the one before it (a little shorter on the thumb).
      return { bones, at: [from.dot(along), from.dot(palm)], aside: from.dot(across), lengths: [l1, l2, f === 'thumb' ? l2 * 0.8 : l2] };
    };
    return { along, across, palm, hinge: along.clone().cross(palm), fingers: FINGERS.map(digit), thumb: digit('thumb') };
  };
  const rigs = { l: handRig('l'), r: handRig('r') };
  /** A bone's own axes in the rest pose: it runs along its y, and a finger's pad faces along its z. */
  const restAxis = (n: string, axis: Vector3) => axis.clone().applyQuaternion(restWorld.get(n)!);
  const Z = new Vector3(0, 0, 1);
  /** In the rest hand's frame: the direction at `angle` from the hand's line toward the palm, leaning `lean` toward the thumb's side. */
  const inHand = (rig: (typeof rigs)['l'], angle: number, lean = 0) =>
    rig.along.clone().multiplyScalar(Math.cos(angle) * Math.cos(lean)).addScaledVector(rig.palm, Math.sin(angle) * Math.cos(lean)).addScaledVector(rig.across, Math.sin(lean));

  /** Turns a chain of finger bones: `turn` gives each bone's rotation from its rest pose, in the rest hand's frame. */
  function poseDigit(m: 'l' | 'r', d: Digit, turn: (n: string, j: number) => Quaternion): void {
    let parent = restWorld.get(`hand_${m}`)!;
    d.bones.forEach((n, j) => {
      const q = turn(n, j).multiply(restWorld.get(n)!);
      bone(n).quaternion.copy(parent.clone().invert().multiply(q));
      parent = q;
    });
  }
  /** Lays a finger's bones along the given angles with the pads facing `sense` of the way round (1 a finger, -1 the thumb). */
  const layDigit = (m: 'l' | 'r', d: Digit, angles: number[], sense: 1 | -1, lean: number[] = []) =>
    poseDigit(m, d, (n, j) => align(restAxis(n, Y), restAxis(n, Z), inHand(rigs[m], angles[j]!, lean[j] ?? 0), inHand(rigs[m], angles[j]! + (sense * Math.PI) / 2)));

  // ----- elbows and knees -----
  // A limb bends about one line through its middle joint, square to both of its bones: the hinge. In the rest pose the elbows
  // are bent by 46 degrees and the knees by 7, which is enough to read each hinge off the model.
  const hingeOf = (a: string, b: string, c: string) => P(b).clone().sub(P(a)).cross(P(c).clone().sub(P(b))).normalize();
  const hinges = {
    arm: { l: hingeOf('upperarm_l', 'lowerarm_l', 'hand_l'), r: hingeOf('upperarm_r', 'lowerarm_r', 'hand_r') },
    leg: { l: hingeOf('thigh_l', 'calf_l', 'foot_l'), r: hingeOf('thigh_r', 'calf_r', 'foot_r') },
  };
  /**
   * The rotation that aims a bone of a limb (rest direction `rest`) along `dir` and turns it about itself until the limb's
   * hinge is square to both bones of the pose (`first` and `second`, from the limb's root to its tip). A limb held straight has
   * no such line: it then keeps the turn the shortest way from the rest pose gives, and the two are blended in between.
   */
  function hinged(rest: Vector3, restHinge: Vector3, dir: Vector3, first: Vector3, second: Vector3): Quaternion {
    const shortest = restHinge.clone().applyQuaternion(swing(rest, dir));
    const bend = first.clone().normalize().cross(second.clone().normalize());
    const sharp = Math.min(1, Math.max(0, (bend.length() - 0.08) / 0.22));
    const hinge = bend.lengthSq() > 1e-8 ? shortest.lerp(bend.normalize(), sharp * sharp * (3 - 2 * sharp)) : shortest;
    return align(rest, restHinge, dir, hinge);
  }

  const wrists = { L: { flex: 0, deviation: 0 }, R: { flex: 0, deviation: 0 } };

  function update(k: Skeleton, hands: Hands = handsFor(null, k)): void {
    const T = (j: keyof Skeleton) => toModel(k[j]);
    worldQ.clear();
    worldP.clear();
    worldQ.set('Root', restWorld.get('Root')!.clone());
    worldP.set('Root', restPos.get('Root')!.clone());
    for (const [n, b] of bones) b.position.copy(restLocalPos.get(n)!);

    const hipL = T('hipL');
    const hipR = T('hipR');
    const hipC = hipL.clone().add(hipR).multiplyScalar(0.5);
    const neckBase = T('neckBase');
    const trunkDir = neckBase.clone().sub(hipC).normalize();
    const hipLine = hipL.clone().sub(hipR);
    const shoulderLine = T('shoulderL').sub(T('shoulderR'));
    // Rest lines: the solvers' left is the model's right bone.
    const restHipLine = P('thigh_r').clone().sub(P('thigh_l'));
    const restShoulderLine = P('clavicle_r').clone().sub(P('clavicle_l'));

    // Pelvis: its rotation from the trunk and hip line, its place so that the hips land on the solver's.
    const qPelvis = align(P('spine_01').clone().sub(P('pelvis')), restHipLine, trunkDir, hipLine);
    const pelvisAt = hipC.clone().sub(hipMid.clone().sub(P('pelvis')).applyQuaternion(qPelvis));
    bone('pelvis').position.copy(pelvisAt.clone().sub(posOf('Root')).applyQuaternion(worldQ.get('Root')!.clone().invert()));
    worldP.set('pelvis', pelvisAt);
    setBone('pelvis', qPelvis.multiply(restWorld.get('pelvis')!));

    // Spine: each bone points at the next one's place on the trunk, with the chest turned to the shoulder line.
    const spine = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01'];
    const target = (n: string) => (n === 'neck_01' ? neckBase.clone() : hipC.clone().addScaledVector(neckBase.clone().sub(hipC), spineFraction(n)));
    for (let i = 1; i < spine.length - 1; i++) {
      const n = spine[i]!;
      const next = spine[i + 1]!;
      const q = align(P(next).clone().sub(P(n)), restShoulderLine, target(next).sub(posOf(n)), shoulderLine);
      setBone(n, q.multiply(restWorld.get(n)!));
    }

    // Neck and head.
    const neckTop = T('neckTop');
    const headTop = T('headTop');
    setBone('neck_01', swing(P('head').clone().sub(P('neck_01')), neckTop.clone().sub(neckBase)).multiply(restWorld.get('neck_01')!));
    const restHeadTip = new Vector3(P('head').x, top, P('head').z);
    setBone('head', align(restHeadTip.clone().sub(P('head')), restShoulderLine, headTop.clone().sub(neckTop), shoulderLine).multiply(restWorld.get('head')!));

    // Arms.
    for (const s of ['L', 'R'] as const) {
      const m = BONE_SIDE[s];
      const shoulder = T(`shoulder${s}`);
      const elbow = T(`elbow${s}`);
      const wrist = T(`wrist${s}`);
      const gripAt = T(`grip${s}`);
      const aim = (n: string, next: string, to: Vector3) => swing(P(next).clone().sub(P(n)), to.clone().sub(posOf(n))).multiply(restWorld.get(n)!);
      setBone(`clavicle_${m}`, aim(`clavicle_${m}`, `upperarm_${m}`, shoulder));
      // The upper arm and the forearm turn about themselves so that the elbow bends about its own hinge.
      const upper = elbow.clone().sub(posOf(`upperarm_${m}`));
      const lower = wrist.clone().sub(elbow);
      const limb = (n: string, next: string, dir: Vector3) => hinged(P(next).clone().sub(P(n)), hinges.arm[m], dir, upper, lower).multiply(restWorld.get(n)!);
      setBone(`upperarm_${m}`, limb(`upperarm_${m}`, `lowerarm_${m}`, upper));
      // The skin near the shoulder does not turn with the elbow: its twist bone only swings with the arm.
      setBone(`upperarm_twist_${m}`, swing(P(`lowerarm_${m}`).clone().sub(P(`upperarm_${m}`)), upper).multiply(restWorld.get(`upperarm_twist_${m}`)!));

      // The hand: where it points and which way its palm faces, and the angles of its fingers.
      const rig = rigs[m];
      const pose = hands[s];
      const reach = gripAt.clone().sub(wrist);
      const forearm = wrist.clone().sub(elbow).normalize();
      const side = m === 'l' ? 1 : -1;
      let along: Vector3;
      let palmTo: Vector3;
      /** How far the wrist is bent toward the thumb, in degrees, for a hand that points along `a` with its palm facing `p`. */
      const deviation = (a: Vector3, p: Vector3) => -Math.asin(Math.max(-1, Math.min(1, forearm.dot(p.clone().cross(a)) * side))) / DEG;
      const beyond = (d: number) => (d > WRIST_DEVIATION.thumb ? d - WRIST_DEVIATION.thumb : d < -WRIST_DEVIATION.little ? d + WRIST_DEVIATION.little : 0);
      /** Turns the hand in the plane of its palm, by `most` degrees at most, until the wrist is not bent sideways further than it goes. */
      const spare = (a: Vector3, p: Vector3, most: number): Vector3 => {
        // The turn is found in a few steps: the sideways bend does not fall by exactly the angle turned.
        let now = a;
        let left = most;
        for (let i = 0; i < 8 && left > 0.01; i++) {
          const over = beyond(deviation(now, p));
          if (over === 0) break;
          const turn = Math.min(left, Math.abs(over));
          const ways = [turn, -turn].map((t) => now.clone().applyAxisAngle(p, t * DEG));
          now = Math.abs(beyond(deviation(ways[0]!, p))) <= Math.abs(beyond(deviation(ways[1]!, p))) ? ways[0]! : ways[1]!;
          left -= turn;
        }
        return now;
      };
      if (pose.kind === 'grip') {
        // The handle lies on the palm, so its middle is off the hand's line by the palm and its own radius; the hand turns in
        // the plane across the handle until the handle is there. Of the two ways round, the thumb's side picks one.
        const off = PALM + pose.radius;
        let handle = toModel(pose.thumb).normalize();
        let across = reach.clone().addScaledVector(handle, -reach.dot(handle));
        if (across.length() < off + 0.03) {
          // The handle runs along the forearm: hold it square to the forearm instead.
          const square = [handle, Y, X].map((c) => c.clone().addScaledVector(reach, -c.dot(reach) / reach.lengthSq())).find((c) => c.length() > 0.5)!;
          handle = square.normalize();
          across = reach.clone();
        }
        const span = across.length();
        const near = Math.sqrt(span * span - off * off);
        const e1 = across.clone().normalize();
        const e2 = handle.clone().cross(e1);
        const way = (sigma: 1 | -1) => ({
          along: e1.clone().multiplyScalar(near / span).addScaledVector(e2, (sigma * off) / span),
          palm: e1.clone().multiplyScalar(off / span).addScaledVector(e2, (-sigma * near) / span),
        });
        const first = way(1);
        const chosen = first.palm.dot(first.along.clone().cross(handle)) * side > 0 ? first : way(-1);
        palmTo = chosen.palm;
        // When holding the handle square would bend the wrist sideways further than it goes, the handle lies a little diagonally across the palm.
        along = spare(chosen.along, palmTo, DIAGONAL);
        // Each finger meets the handle where the handle crosses that finger's own plane.
        const toThumb = palmTo.clone().cross(along).multiplyScalar(side);
        const middle = [reach.dot(along), reach.dot(palmTo), reach.dot(toThumb)] as const;
        const runs = [handle.dot(along), handle.dot(palmTo), handle.dot(toThumb)] as const;
        const centreAt = (aside: number): [number, number] => {
          if (Math.abs(runs[2]) < 0.5) return [middle[0], middle[1]];
          const t = (aside - middle[2]) / runs[2];
          return [middle[0] + runs[0] * t, middle[1] + runs[1] * t];
        };
        const round = pose.radius / Math.max(0.7, Math.abs(runs[2])) + PAD;
        for (const f of rig.fingers) layDigit(m, f, wrapDigit(f.at, f.lengths, centreAt(f.aside), round, 1, FINGER_LIMITS), 1);
        // The thumb comes round the other side, beside the index finger.
        layDigit(m, rig.thumb, wrapDigit(rig.thumb.at, rig.thumb.lengths, centreAt(rig.thumb.aside + 0.02), round, -1, THUMB_LIMITS), -1, [22 * DEG, 6 * DEG, 0]);
      } else {
        palmTo = toModel(pose.palm).normalize();
        if (pose.kind === 'flat') {
          // Pressed on a surface: the hand lies in it, turned as far as the wrist needs, the fingers straight and a little spread.
          along = reach.clone().normalize();
          along = spare(along.addScaledVector(palmTo, -along.dot(palmTo)).normalize(), palmTo, 90);
          for (const f of rig.fingers) layDigit(m, f, [5 * DEG, 2 * DEG, 0], 1);
          layDigit(m, rig.thumb, [4 * DEG, 2 * DEG, 0], 1, [42 * DEG, 30 * DEG, 24 * DEG]);
        } else {
          // At ease the hand hangs in line with the forearm.
          along = forearm.clone();
          palmTo.addScaledVector(along, -palmTo.dot(along)).normalize();
          // Each finger a little more curled than the one before, bending about the knuckle line; the thumb beside the index finger.
          rig.fingers.forEach((f, i) => {
            const bends = EASE[FINGERS[i]!].map((d) => d * DEG);
            let angle = 0;
            const angles = bends.map((b) => (angle += b));
            poseDigit(m, f, (n, j) => {
              const now = restAxis(n, Y);
              return new Quaternion().setFromAxisAngle(rig.hinge, angles[j]! - Math.atan2(now.dot(rig.palm), now.dot(rig.along)));
            });
          });
          layDigit(m, rig.thumb, [14 * DEG, 20 * DEG, 30 * DEG], 1, [30 * DEG, 16 * DEG, 8 * DEG]);
        }
      }
      const qHand = align(rig.along, rig.palm, along, palmTo).multiply(restWorld.get(`hand_${m}`)!);
      // How the wrist is bent: the forearm's line as the hand sees it.
      const handAlong = along.clone().normalize();
      const handPalm = palmTo.clone().addScaledVector(handAlong, -palmTo.dot(handAlong)).normalize();
      const handThumb = handPalm.clone().cross(handAlong).multiplyScalar(m === 'l' ? 1 : -1);
      wrists[s] = { flex: -Math.atan2(forearm.dot(handPalm), forearm.dot(handAlong)) / DEG, deviation: -Math.asin(Math.max(-1, Math.min(1, forearm.dot(handThumb)))) / DEG };

      // The forearm takes most of the hand's turn about its own axis, so the wrist is not wrung.
      const qSwing = limb(`lowerarm_${m}`, `hand_${m}`, wrist.clone().sub(posOf(`lowerarm_${m}`)));
      const axis = wrist.clone().sub(elbow).normalize();
      const rel = qHand.clone().multiply(qSwing.clone().invert());
      const twist = 2 * Math.atan2(rel.x * axis.x + rel.y * axis.y + rel.z * axis.z, rel.w);
      const wrap = ((twist + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      // The forearm bone keeps to the elbow; its twist bone, which carries the skin toward the wrist, takes most of the hand's turn.
      setBone(`lowerarm_${m}`, qSwing);
      setBone(`lowerarm_twist_${m}`, new Quaternion().setFromAxisAngle(axis, wrap * 0.85).multiply(qSwing));
      setBone(`hand_${m}`, qHand);

    }

    // Legs: thigh to knee, calf to ankle, the foot flat along the heel-to-toe line.
    for (const s of ['L', 'R'] as const) {
      const m = BONE_SIDE[s];
      // The thigh and the shin turn about themselves so that the knee bends about its own hinge.
      const thigh = T(`knee${s}`).sub(posOf(`thigh_${m}`));
      const shin = T(`ankle${s}`).sub(T(`knee${s}`));
      const limb = (n: string, next: string, dir: Vector3) => hinged(P(next).clone().sub(P(n)), hinges.leg[m], dir, thigh, shin).multiply(restWorld.get(n)!);
      setBone(`thigh_${m}`, limb(`thigh_${m}`, `calf_${m}`, thigh));
      // The skin near the hip does not turn with the knee.
      setBone(`thigh_twist_${m}`, swing(P(`calf_${m}`).clone().sub(P(`thigh_${m}`)), thigh).multiply(restWorld.get(`thigh_twist_${m}`)!));
      setBone(`calf_${m}`, limb(`calf_${m}`, `foot_${m}`, T(`ankle${s}`).sub(posOf(`calf_${m}`))));

      const restToe = new Vector3(0, -body.ankleHeight, body.toeFront);
      const toe = T(`toe${s}`).sub(T(`ankle${s}`));
      // The top of the foot faces up for a foot on the floor and forward for a foot on its toes: it is square to the hip line and the toes.
      setBone(`foot_${m}`, align(restToe, Y, toe, hipLine.clone().cross(toe)).multiply(restWorld.get(`foot_${m}`)!));
      bone(`ball_${m}`).quaternion.copy(restLocal.get(`ball_${m}`)!);
    }
    group.updateMatrixWorld(true);
  }

  function toRestPose(): void {
    for (const [n, b] of bones) {
      b.position.copy(restLocalPos.get(n)!);
      b.quaternion.copy(restLocal.get(n)!);
    }
    group.updateMatrixWorld(true);
  }

  const highlight = (primary: Iterable<string>, secondary: Iterable<string>) => {
    // A name is a muscle group (all its heads) or one head.
    const fill = (set: Iterable<string>, into: Float32Array) => {
      const names = new Set(set);
      heads.forEach((h, i) => (into[i] = names.has(h.group) || names.has(h.name) ? 1 : 0));
    };
    const first = new Set(primary);
    fill(first, uniforms.uPri.value);
    const second = [...secondary].filter((m) => !first.has(m));
    fill(second, uniforms.uSec.value);
    uniforms.uMute.value = uniforms.uPri.value.some((x) => x > 0) || uniforms.uSec.value.some((x) => x > 0) ? 1 : 0;
  };

  update(standing(body));
  return {
    group,
    body,
    rest: toRestPose,
    skin: mesh,
    heads,
    bones,
    update,
    fingertip(side, digit) {
      const m = BONE_SIDE[side];
      const d = digit === 'thumb' ? rigs[m].thumb : rigs[m].fingers[FINGERS.indexOf(digit as (typeof FINGERS)[number])]!;
      const last = bone(d.bones[2]!);
      // The scene's coordinates are the solvers' (the group turns the model to face +x).
      const tip = last.localToWorld(new Vector3(0, d.lengths[2]! / last.getWorldScale(new Vector3()).y, 0));
      return { x: tip.x, y: tip.y, z: tip.z };
    },
    wrist: (side) => ({ ...wrists[side] }),
    hinge(limb, side, part) {
      const m = BONE_SIDE[side];
      const n = limb === 'arm' ? (part === 'upper' ? `upperarm_${m}` : `lowerarm_${m}`) : part === 'upper' ? `thigh_${m}` : `calf_${m}`;
      // The hinge in the bone's own axes (from the rest pose), then where the bone is now.
      const v = hinges[limb][m].clone().applyQuaternion(restWorld.get(n)!.clone().invert()).applyQuaternion(bone(n).getWorldQuaternion(new Quaternion()));
      return { x: v.x, y: v.y, z: v.z };
    },
    setHighlight: highlight,
    setHighlightVisible(on) {
      uniforms.uShow.value = on ? 1 : 0;
    },
    setHeat(colours) {
      uniforms.uHeatOn.value = colours ? 1 : 0;
      const c = new Color();
      uniforms.uHeat.value.forEach((v, i) => {
        // A colour for one head goes before its group's.
        const hex = colours?.get(heads[i]!.name) ?? colours?.get(heads[i]!.group);
        if (hex === undefined) v.set(0, 0, 0, 0);
        else {
          c.set(hex);
          v.set(c.r, c.g, c.b, 1);
        }
      });
    },
    setBreath(x) {
      uniforms.uBreath.value = x;
    },
    setPalette(p) {
      material.color.set(p.body);
      tint.set(p.tint);
    },
  };
}
