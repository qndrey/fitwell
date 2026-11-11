import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadExercises } from '@fitwell/core/data/exercises';
import { handsFor, MOTIONS, relaxed, skeletonAt, type Skeleton } from '../src/exercises/motion';
import { BODY_MUSCLES, loadHumanBody, WRIST_DEVIATION, type HumanBody } from '../ui/shared/humanBody';

const palette = { tint: 0xe4572e, body: 0xd9b8a0, load: 0x2f5d50, steel: 0xb0b0b0, furniture: 0x8a8378, floor: 0xddd6cc };
const SIDE = { L: 'r', R: 'l' } as const; // the solvers' left is the model's right side

let human: HumanBody;
beforeAll(async () => {
  const gz = readFileSync(join(import.meta.dirname, '../ui/assets/body.glb.gz'));
  const bytes = gunzipSync(gz);
  human = await loadHumanBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), palette);
});

const at = (name: string) => human.bones.get(name)!.getWorldPosition(new Vector3());
const joint = (k: Skeleton, j: keyof Skeleton) => new Vector3(k[j].x, k[j].y, k[j].z);

describe('the human body', () => {
  it('measures like a 1.73 m muscular man', () => {
    const b = human.body;
    expect(b.thigh).toBeGreaterThan(0.41);
    expect(b.thigh).toBeLessThan(0.45);
    expect(b.shin).toBeGreaterThan(0.41);
    expect(b.shin).toBeLessThan(0.45);
    expect(b.shoulderHalf).toBeGreaterThan(0.19);
    expect(b.head + b.neck + b.chest + b.lumbar + b.pelvis + b.thigh + b.shin + b.ankleHeight).toBeGreaterThan(1.65);
  });

  it('puts the bones on the joints of the solver in every pose', () => {
    const pairs: [string, (s: 'L' | 'R') => [string, keyof Skeleton]][] = [
      ['thigh', (s) => [`thigh_${SIDE[s]}`, `hip${s}`]],
      ['calf', (s) => [`calf_${SIDE[s]}`, `knee${s}`]],
      ['foot', (s) => [`foot_${SIDE[s]}`, `ankle${s}`]],
      ['upperarm', (s) => [`upperarm_${SIDE[s]}`, `shoulder${s}`]],
      ['lowerarm', (s) => [`lowerarm_${SIDE[s]}`, `elbow${s}`]],
      ['hand', (s) => [`hand_${SIDE[s]}`, `wrist${s}`]],
    ];
    let worst = 0;
    for (const name of Object.keys(MOTIONS)) {
      for (const p of [0, 0.5, 1]) {
        const k = skeletonAt(MOTIONS[name]!, p, human.body);
        human.update(k);
        for (const [what, f] of pairs)
          for (const s of ['L', 'R'] as const) {
            const [bone, j] = f(s);
            const d = at(bone).distanceTo(joint(k, j));
            worst = Math.max(worst, d);
            expect(d, `${name} p=${p} ${what} ${s}`).toBeLessThan(0.01);
          }
      }
    }
    console.log('worst bone-to-joint distance', worst.toFixed(3));
    expect(worst).toBeLessThan(0.01);
  });

  it('stands on the floor, and no skin sinks below it', () => {
    for (const [name, p] of [['standing', 0], ...Object.keys(MOTIONS).flatMap((n) => [0, 0.5, 1].map((q) => [n, q] as const))] as [string, number][]) {
      if (name === 'standing') human.update(relaxed(human.body, 1.1));
      else {
        const k = skeletonAt(MOTIONS[name]!, p, human.body);
        human.update(k, handsFor(MOTIONS[name]!, k));
      }
      const mesh = human.skin;
      const v = new Vector3();
      let low = Infinity;
      const count = mesh.geometry.getAttribute('position').count;
      mesh.skeleton.update();
      for (let i = 0; i < count; i += 7) low = Math.min(low, mesh.getVertexPosition(i, v).applyMatrix4(human.group.matrixWorld).y);
      expect(low, `${name} p=${p}`).toBeGreaterThan(-0.04);
    }
  });

  it('closes the hands around the bar or handle: every fingertip and the thumb lie on it, and no finger joint is inside it', () => {
    let grips = 0;
    for (const name of Object.keys(MOTIONS)) {
      for (const p of [0, 0.5, 1]) {
        const k = skeletonAt(MOTIONS[name]!, p, human.body);
        const hands = handsFor(MOTIONS[name]!, k);
        human.update(k, hands);
        for (const s of ['L', 'R'] as const) {
          const pose = hands[s];
          if (pose.kind !== 'grip') continue;
          grips++;
          // How far a point is from the handle's middle line, which runs through the grip point. When the handle would run along the
          // forearm the hand holds it square instead, so the distance is taken from the grip point itself.
          const centre = joint(k, `grip${s}`);
          const reach = centre.clone().sub(joint(k, `wrist${s}`));
          const axis = new Vector3(pose.thumb.x, pose.thumb.y, pose.thumb.z).normalize();
          const square = reach.clone().addScaledVector(axis, -reach.dot(axis)).length() < 0.012 + pose.radius + 0.03;
          const off = (v: Vector3) => {
            const d = v.clone().sub(centre);
            return square ? d.length() : d.addScaledVector(axis, -d.dot(axis)).length();
          };
          const where = `${name} p=${p} ${s}`;
          for (const f of ['index', 'middle', 'ring', 'pinky']) {
            const tip = human.fingertip(s, f);
            if (!square) {
              expect(off(new Vector3(tip.x, tip.y, tip.z)), `${where} ${f} tip`).toBeGreaterThan(pose.radius);
              expect(off(new Vector3(tip.x, tip.y, tip.z)), `${where} ${f} tip`).toBeLessThan(pose.radius + 0.03);
              for (const j of [2, 3]) expect(off(at(`${f}_0${j}_${SIDE[s]}`)), `${where} ${f} joint ${j}`).toBeGreaterThan(pose.radius);
            } else expect(off(new Vector3(tip.x, tip.y, tip.z)), `${where} ${f} tip`).toBeLessThan(0.07);
          }
          const thumb = human.fingertip(s, 'thumb');
          if (!square) expect(off(new Vector3(thumb.x, thumb.y, thumb.z)), `${where} thumb tip`).toBeGreaterThan(pose.radius);
          expect(off(new Vector3(thumb.x, thumb.y, thumb.z)), `${where} thumb tip`).toBeLessThan(pose.radius + 0.045);
        }
      }
    }
    expect(grips).toBeGreaterThan(300);
  });

  it('bends no wrist further than a wrist goes, in any movement', () => {
    // Back as far as a hand pressed flat on the floor (a push-up), forward less; sideways as `WRIST_DEVIATION` says, with a few degrees to spare.
    for (const name of Object.keys(MOTIONS)) {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const k = skeletonAt(MOTIONS[name]!, p, human.body);
        human.update(k, handsFor(MOTIONS[name]!, k));
        for (const s of ['L', 'R'] as const) {
          const w = human.wrist(s);
          expect(w.flex, `${name} p=${p} ${s} bent back`).toBeGreaterThan(-90);
          expect(w.flex, `${name} p=${p} ${s} bent forward`).toBeLessThan(60);
          expect(w.deviation, `${name} p=${p} ${s} toward the thumb`).toBeLessThan(WRIST_DEVIATION.thumb + 4);
          expect(w.deviation, `${name} p=${p} ${s} toward the little finger`).toBeGreaterThan(-WRIST_DEVIATION.little - 4);
        }
      }
    }
    const at = relaxed(human.body, 0);
    human.update(at, handsFor(null, at));
    expect(Math.abs(human.wrist('L').flex)).toBeLessThan(1);
    expect(Math.abs(human.wrist('L').deviation)).toBeLessThan(1);
  });

  it('bends the elbows and the knees about their own hinges: the upper and lower bone of a limb keep one hinge line', () => {
    // The line a joint bends about is read off the rest pose and carried by the limb's bones; in a bent limb it must lie along the
    // line square to both bones of the pose.
    for (const name of ['Barbell Squat', 'Barbell Curl', 'Pushups', 'Barbell Bench Press - Medium Grip', 'Pullups', 'Barbell Deadlift']) {
      for (const p of [0.5, 1]) {
        const k = skeletonAt(MOTIONS[name]!, p, human.body);
        human.update(k, handsFor(MOTIONS[name]!, k));
        for (const s of ['L', 'R'] as const) {
          for (const [a, b, c] of [['shoulder', 'elbow', 'wrist'], ['hip', 'knee', 'ankle']] as const) {
            const first = joint(k, `${b}${s}`).sub(joint(k, `${a}${s}`)).normalize();
            const second = joint(k, `${c}${s}`).sub(joint(k, `${b}${s}`)).normalize();
            const bend = first.clone().cross(second);
            if (bend.length() < 0.35) continue; // nearly straight: no hinge line to speak of
            const limb = a === 'shoulder' ? 'arm' : 'leg';
            const line = bend.normalize();
            const carried = (part: 'upper' | 'lower') => {
              const h = human.hinge(limb, s, part);
              return new Vector3(h.x, h.y, h.z).dot(line);
            };
            // The forearm also turns with the hand, so only the upper arm is held to the elbow's line; both bones of the leg are.
            expect(carried('upper'), `${name} p=${p} ${s} ${b} upper`).toBeGreaterThan(0.99);
            if (limb === 'leg') expect(carried('lower'), `${name} p=${p} ${s} ${b} lower`).toBeGreaterThan(0.99);
          }
        }
      }
    }
  });

  it('holds the two hands as mirror images, at ease and around a bar', () => {
    for (const name of [null, 'Barbell Bench Press - Medium Grip', 'Barbell Curl', 'Pullups']) {
      const k = name ? skeletonAt(MOTIONS[name]!, 0.5, human.body) : relaxed(human.body, 0);
      human.update(k, handsFor(name ? MOTIONS[name]! : null, k));
      for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
        const l = human.fingertip('L', f);
        const r = human.fingertip('R', f);
        expect(Math.hypot(l.x - r.x, l.y - r.y, l.z + r.z), `${name ?? 'at ease'} ${f}`).toBeLessThan(0.004);
      }
    }
  });

  it('hangs the hands at ease with the palms toward the thighs and the fingers loosely curled', () => {
    const k = relaxed(human.body, 0);
    human.update(k, handsFor(null, k));
    for (const s of ['L', 'R'] as const) {
      const side = s === 'L' ? 1 : -1;
      const wrist = joint(k, `wrist${s}`);
      const tips = ['index', 'middle', 'ring', 'pinky'].map((f) => human.fingertip(s, f));
      for (const t of tips) {
        // Below the wrist, curled toward the leg rather than away from it, and not a fist.
        expect(t.y, s).toBeLessThan(wrist.y - 0.1);
        expect(side * (t.z - wrist.z), s).toBeLessThan(0.01);
      }
      // The thumb is in front of the fingers: the palm faces the thigh, not forward or back.
      expect(human.fingertip(s, 'thumb').x, s).toBeGreaterThan(human.fingertip(s, 'pinky').x + 0.03);
    }
  });

  it('lays the hands flat on the floor in a push-up', () => {
    for (const p of [0, 0.5, 1]) {
      const k = skeletonAt(MOTIONS['Pushups']!, p, human.body);
      human.update(k, handsFor(MOTIONS['Pushups']!, k));
      for (const s of ['L', 'R'] as const)
        for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
          const tip = human.fingertip(s, f);
          expect(tip.y, `p=${p} ${s} ${f}`).toBeGreaterThan(0.002);
          expect(tip.y, `p=${p} ${s} ${f}`).toBeLessThan(0.03);
        }
    }
  });

  it('has a weight for every muscle group of the library, so any exercise can light up its muscles', async () => {
    const lib = await loadExercises();
    expect([...BODY_MUSCLES].sort()).toEqual([...lib.muscles].sort());
    human.setHighlight(['chest'], ['triceps']);
    human.setHighlightVisible(false);
  });

  it('divides every muscle group into parts the model lists, and every part has skin of its own', () => {
    const groups = new Set(human.heads.map((h) => h.group));
    expect([...groups].sort()).toEqual([...BODY_MUSCLES].sort());
    expect(new Set(human.heads.map((h) => h.name)).size).toBe(human.heads.length);
    // Each vertex names its two strongest parts as (number + 0.5) / 64 with a weight each: count the vertices where a part leads.
    const packed = human.skin.geometry.getAttribute('_muscle');
    const leads = human.heads.map(() => 0);
    for (let i = 0; i < packed.count; i++) {
      const first = Math.floor(packed.getX(i) * 64);
      const second = Math.floor(packed.getZ(i) * 64);
      expect(first).toBeLessThan(human.heads.length);
      expect(second).toBeLessThan(human.heads.length);
      expect(packed.getY(i) + packed.getW(i)).toBeLessThan(1.02);
      if (packed.getY(i) > 0.5) leads[first]!++;
    }
    human.heads.forEach((h, i) => expect(leads[i], h.name).toBeGreaterThan(15));
  });

  it('has twist bones that keep the skin from wringing: near the shoulder and hip they do not turn with the elbow and knee, and the one of the forearm turns with the hand', () => {
    for (const s of ['l', 'r']) for (const n of ['upperarm_twist', 'lowerarm_twist', 'thigh_twist']) expect(human.bones.has(`${n}_${s}`), `${n}_${s}`).toBe(true);
    // A curl turns the palms up: the forearm's twist bone turns about the forearm with the hand, away from the forearm bone itself.
    const k = skeletonAt(MOTIONS['Barbell Curl']!, 0.5, human.body);
    human.update(k, handsFor(MOTIONS['Barbell Curl']!, k));
    const q = (n: string) => human.bones.get(n)!.quaternion;
    expect(2 * Math.acos(Math.min(1, Math.abs(q('lowerarm_twist_l').w)))).toBeGreaterThan(0.3);
  });
});
