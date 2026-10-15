import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MOTIONS, skeletonAt, standing, type Skeleton } from '../src/exercises/motion';
import { BODY_MUSCLES, loadHumanBody, type HumanBody } from '../ui/shared/humanBody';

const palette = { tint: 0xe4572e, body: 0xd9b8a0, muscle: 0xd9b8a0, joint: 0xd9b8a0, load: 0x2f5d50, steel: 0xb0b0b0, furniture: 0x8a8378, floor: 0xddd6cc };
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
      human.update(name === 'standing' ? standing(human.body) : skeletonAt(MOTIONS[name]!, p, human.body));
      const mesh = human.skin;
      const v = new Vector3();
      let low = Infinity;
      const count = mesh.geometry.getAttribute('position').count;
      mesh.skeleton.update();
      for (let i = 0; i < count; i += 7) low = Math.min(low, mesh.getVertexPosition(i, v).applyMatrix4(human.group.matrixWorld).y);
      expect(low, `${name} p=${p}`).toBeGreaterThan(-0.04);
    }
  });

  it('knows the muscle groups of the library', () => {
    expect(BODY_MUSCLES).toHaveLength(17);
    human.setHighlight(['chest'], ['triceps']);
    human.setHighlightVisible(false);
  });
});
