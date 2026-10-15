// The realistic male body of the exercise animation: a rigged model (made with MPFB, see ui/assets/README.md) posed from
// the same joint positions as the mannequin. Each bone is aimed at where the solver puts the next joint, so the form
// rules checked on the skeleton hold for the body too. The skin carries five attributes with per-vertex muscle weights,
// which the material uses to tint the muscle groups an exercise works. three.js code without a renderer, usable in Node.
import { Bone, Color, Group, Matrix4, MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3, Vector4 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { standing, type Body, type Skeleton } from '../../src/exercises/motion';
import type { Palette } from './mannequin';

/** The muscle groups of the weights, in the order of the five `_MUSCLE` attributes (four to an attribute). */
export const BODY_MUSCLES = ['abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings', 'lats', 'lower back', 'middle back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps'];

export interface HumanBody {
  /** Add this to the scene. The body faces +x (the way the solvers' figure faces) and stands on y = 0. */
  group: Group;
  /** The measurements of this body, to hand to the solvers so the pose fits it. */
  body: Body;
  /** Poses the body. `grip` is how tightly the hands close (0 relaxed, 1 around a bar). */
  update(k: Skeleton, grip?: number): void;
  setHighlight(primary: Iterable<string>, secondary: Iterable<string>): void;
  setHighlightVisible(on: boolean): void;
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

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const CURL = [65, 70, 55].map((d) => (d * Math.PI) / 180);
const RELAXED = (15 * Math.PI) / 180;

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
  let top = 0;
  const vertex = new Vector3();
  for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) top = Math.max(top, mesh.getVertexPosition(i, vertex).y);
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
    hand: 0.08,
    heelBack: 0.06,
    toeFront: 0.2,
    midfoot: 0.07,
  };
  const spineFraction = (n: string) => (P(n).y - hipMid.y) / trunk;

  // ----- the skin -----
  const tint = new Color(palette.tint);
  const uniforms = {
    uPri: { value: Array.from({ length: 5 }, () => new Vector4()) },
    uSec: { value: Array.from({ length: 5 }, () => new Vector4()) },
    uTint: { value: tint },
    uShow: { value: 1 },
  };
  const material = new MeshStandardMaterial({ color: palette.body, roughness: 0.62, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const weights = [0, 1, 2, 3, 4].map((i) => `dot(_muscle${i}, uPri[${i}])`).join(' + ');
    const weights2 = [0, 1, 2, 3, 4].map((i) => `dot(_muscle${i}, uSec[${i}])`).join(' + ');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${[0, 1, 2, 3, 4].map((i) => `attribute vec4 _muscle${i};`).join('\n')}\nuniform vec4 uPri[5];\nuniform vec4 uSec[5];\nvarying vec2 vWorked;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWorked = vec2(${weights}, ${weights2});`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uShow;\nvarying vec2 vWorked;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTint, clamp(vWorked.x * 0.78 + vWorked.y * 0.45, 0.0, 0.85) * uShow);');
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

  function update(k: Skeleton, grip = 1): void {
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
      setBone(`upperarm_${m}`, aim(`upperarm_${m}`, `lowerarm_${m}`, elbow));

      // The hand: fingers along the wrist-to-grip line, the knuckles across the bar (the bar runs across the figure).
      const fRest = P(`middle_01_${m}`).clone().sub(P(`hand_${m}`));
      const lRest = P(`pinky_01_${m}`).clone().sub(P(`index_01_${m}`));
      const nRest = Y.clone().negate(); // the relaxed rest hand has its palm down (made square to the fingers below)
      nRest.addScaledVector(fRest.clone().normalize(), -nRest.dot(fRest.clone().normalize()));
      const sign = Math.sign(nRest.dot(fRest.clone().cross(lRest))) || 1;
      const fDes = gripAt.clone().sub(wrist).normalize();
      const across = new Vector3(m === 'l' ? 1 : -1, 0, 0); // outward along the bar, pinky side
      const lDes = across.clone().addScaledVector(fDes, -across.dot(fDes)).normalize();
      const nDes = fDes.clone().cross(lDes).multiplyScalar(sign);
      const qHand = align(fRest, nRest, fDes, nDes).multiply(restWorld.get(`hand_${m}`)!);

      // The forearm takes most of the hand's turn about its own axis, so the wrist is not wrung.
      const qSwing = aim(`lowerarm_${m}`, `hand_${m}`, wrist);
      const axis = wrist.clone().sub(elbow).normalize();
      const rel = qHand.clone().multiply(qSwing.clone().invert());
      const twist = 2 * Math.atan2(rel.x * axis.x + rel.y * axis.y + rel.z * axis.z, rel.w);
      const wrap = ((twist + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      setBone(`lowerarm_${m}`, new Quaternion().setFromAxisAngle(axis, wrap * 0.7).multiply(qSwing));
      setBone(`hand_${m}`, qHand);

      // Fingers curl about the knuckle line, thumbs stay.
      for (const f of FINGERS)
        for (let j = 0; j < 3; j++) {
          const n = `${f}_0${j + 1}_${m}`;
          const b = bone(n);
          const own = restWorld.get(n)!;
          const axisLocal = X.clone().applyQuaternion(own.clone().invert());
          const angle = RELAXED + (CURL[j]! - RELAXED) * grip;
          b.quaternion.copy(restLocal.get(n)!).multiply(new Quaternion().setFromAxisAngle(axisLocal, angle));
          b.position.copy(restLocalPos.get(n)!);
        }
      for (let j = 1; j <= 3; j++) bone(`thumb_0${j}_${m}`).quaternion.copy(restLocal.get(`thumb_0${j}_${m}`)!);
    }

    // Legs: thigh to knee, calf to ankle, the foot flat along the heel-to-toe line.
    for (const s of ['L', 'R'] as const) {
      const m = BONE_SIDE[s];
      const aim = (n: string, next: string, to: Vector3) => swing(P(next).clone().sub(P(n)), to.clone().sub(posOf(n))).multiply(restWorld.get(n)!);
      setBone(`thigh_${m}`, aim(`thigh_${m}`, `calf_${m}`, T(`knee${s}`)));
      setBone(`calf_${m}`, aim(`calf_${m}`, `foot_${m}`, T(`ankle${s}`)));
      const restToe = new Vector3(0, -body.ankleHeight, body.toeFront);
      const toe = T(`toe${s}`).sub(T(`ankle${s}`));
      setBone(`foot_${m}`, align(restToe, Y, toe, Y).multiply(restWorld.get(`foot_${m}`)!));
      bone(`ball_${m}`).quaternion.copy(restLocal.get(`ball_${m}`)!);
    }
    group.updateMatrixWorld(true);
  }

  const highlight = (primary: Iterable<string>, secondary: Iterable<string>) => {
    const fill = (set: Iterable<string>, into: Vector4[]) => {
      const flat = new Float32Array(20);
      for (const name of set) {
        const i = BODY_MUSCLES.indexOf(name);
        if (i >= 0) flat[i] = 1;
      }
      into.forEach((v, i) => v.fromArray(flat, i * 4));
    };
    const first = new Set(primary);
    fill(first, uniforms.uPri.value);
    fill([...secondary].filter((m) => !first.has(m)), uniforms.uSec.value);
  };

  update(standing(body), 0);
  return {
    group,
    body,
    skin: mesh,
    bones,
    update,
    setHighlight: highlight,
    setHighlightVisible(on) {
      uniforms.uShow.value = on ? 1 : 0;
    },
    setPalette(p) {
      material.color.set(p.body);
      tint.set(p.tint);
    },
  };
}
