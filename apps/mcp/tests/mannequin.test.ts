import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MOTIONS, skeletonAt, standing } from '../src/exercises/motion';
import { buildMannequin, buildProps, makeMaterials } from '../ui/shared/mannequin';

const palette = { body: 0xc9bfb2, joint: 0xa99f92, load: 0x2f5d50, steel: 0xb0b0b0, furniture: 0x8a8378, floor: 0xddd6cc };

describe('mannequin', () => {
  it('stretches every limb part between its two joints in every pose', () => {
    const mats = makeMaterials(palette);
    const man = buildMannequin(mats);
    for (const name of Object.keys(MOTIONS)) {
      for (const p of [0, 0.5, 1]) {
        const k = skeletonAt(MOTIONS[name]!, p);
        man.update(k);
        for (const seg of man.segments) {
          const up = new Vector3(0, 1, 0).applyQuaternion(seg.mesh.quaternion);
          const half = seg.mesh.scale.y / 2;
          const near = seg.mesh.position.clone().addScaledVector(up, -half);
          const far = seg.mesh.position.clone().addScaledVector(up, half);
          const a = k[seg.from];
          const b = k[seg.to];
          expect(near.distanceTo(new Vector3(a.x, a.y, a.z)), `${name} p=${p} ${seg.from}`).toBeLessThan(0.001);
          expect(far.distanceTo(new Vector3(b.x, b.y, b.z)), `${name} p=${p} ${seg.to}`).toBeLessThan(0.001);
        }
      }
    }
  });

  it('keeps the soles on the floor and builds a modest number of parts', () => {
    const mats = makeMaterials(palette);
    const man = buildMannequin(mats);
    for (const name of ['Barbell Squat', 'Barbell Deadlift', 'Barbell Bench Press - Medium Grip']) {
      for (const p of [0, 1]) {
        man.update(skeletonAt(MOTIONS[name]!, p));
        const feet = man.group.children.filter((c) => c.scale.y === 1 && Math.abs(c.position.y - 0.035) < 0.001);
        expect(feet.length, name).toBe(2);
      }
    }
    expect(man.group.children.length).toBeLessThan(60);
    man.update(standing());
  });

  it('builds the load and furniture for each kind of exercise', () => {
    const mats = makeMaterials(palette);
    const count = (name: string) => buildProps(MOTIONS[name]!, mats).group.children.length;
    expect(count('Barbell Squat')).toBe(2); // floor + barbell
    expect(count('Bodyweight Squat')).toBe(1); // floor only
    expect(count('Dumbbell Squat')).toBe(3); // floor + two dumbbells
    expect(count('Goblet Squat')).toBe(2); // floor + kettlebell
    expect(count('Barbell Bench Press - Medium Grip')).toBe(3); // floor + bench + barbell
    const props = buildProps(MOTIONS['Barbell Squat']!, mats);
    props.update(skeletonAt(MOTIONS['Barbell Squat']!, 1));
    const bar = props.group.children[1]!;
    expect(bar.position.y).toBeCloseTo(skeletonAt(MOTIONS['Barbell Squat']!, 1).bar.y, 6);
  });
});
