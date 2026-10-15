import { loadExercises } from '@fitwell/core/data/exercises';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MOTIONS, skeletonAt, standing } from '../src/exercises/motion';
import { buildMannequin, buildProps, makeMaterials, MUSCLE_NAMES } from '../ui/shared/mannequin';

const palette = { body: 0xc9bfb2, muscle: 0xbba996, joint: 0xa99f92, load: 0x2f5d50, steel: 0xb0b0b0, furniture: 0x8a8378, floor: 0xddd6cc };

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
    expect(man.group.children.length).toBeLessThan(90);
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

describe('muscles', () => {
  it('draws every muscle of the library, so any exercise can light up its muscles', async () => {
    const lib = await loadExercises();
    for (const name of lib.muscles) expect(MUSCLE_NAMES, name).toContain(name);
    const man = buildMannequin(makeMaterials(palette));
    const drawn = new Set(man.muscles.map((x) => x.muscle));
    for (const name of lib.muscles) expect(drawn.has(name), name).toBe(true);
    for (const name of drawn) expect(lib.muscles, `${name} is a library muscle`).toContain(name);
  });

  it('keeps each limb muscle on its limb in every pose', () => {
    const man = buildMannequin(makeMaterials(palette));
    const limbOf: Record<string, [string, string]> = { biceps: ['shoulder', 'elbow'], triceps: ['shoulder', 'elbow'], forearms: ['elbow', 'wrist'], quadriceps: ['hip', 'knee'], hamstrings: ['hip', 'knee'], calves: ['knee', 'ankle'] };
    for (const name of ['Barbell Squat', 'Front Barbell Squat', 'Barbell Deadlift', 'Barbell Bench Press - Medium Grip']) {
      for (const p of [0, 0.5, 1]) {
        const k = skeletonAt(MOTIONS[name]!, p);
        man.update(k);
        for (const { muscle, mesh } of man.muscles) {
          const joints = limbOf[muscle];
          if (!joints) continue;
          // The muscle's centre lies within 8 cm of the line between the two joints of one of the two limbs.
          const near = (['L', 'R'] as const).some((sfx) => {
            const a = k[`${joints[0]}${sfx}` as keyof typeof k] as { x: number; y: number; z: number };
            const b = k[`${joints[1]}${sfx}` as keyof typeof k] as { x: number; y: number; z: number };
            const A = new Vector3(a.x, a.y, a.z);
            const B = new Vector3(b.x, b.y, b.z);
            const t = Math.max(0, Math.min(1, mesh.position.clone().sub(A).dot(B.clone().sub(A)) / B.clone().sub(A).lengthSq()));
            return mesh.position.distanceTo(A.clone().lerp(B, t)) < 0.08;
          });
          expect(near, `${muscle} ${name} p=${p}`).toBe(true);
        }
      }
    }
  });

  it('lights up the main muscles in the accent tone and the secondary ones lighter, and can hide the layer', () => {
    const mats = makeMaterials(palette);
    const man = buildMannequin(mats);
    man.setHighlight(['quadriceps'], ['glutes', 'calves']);
    const tone = (muscle: string) => man.muscles.find((x) => x.muscle === muscle)!.mesh.material;
    expect(tone('quadriceps')).toBe(mats.musclePrimary);
    expect(tone('glutes')).toBe(mats.muscleSecondary);
    expect(tone('calves')).toBe(mats.muscleSecondary);
    expect(tone('biceps')).toBe(mats.muscle);
    man.setHighlight([], []);
    expect(tone('quadriceps')).toBe(mats.muscle);
    man.setMusclesVisible(false);
    expect(man.muscles.every((x) => !x.mesh.visible)).toBe(true);
    man.setMusclesVisible(true);
    expect(man.muscles.every((x) => x.mesh.visible)).toBe(true);
  });
});
