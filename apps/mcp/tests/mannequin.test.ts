import { loadExercises } from '@fitwell/core/data/exercises';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MOTIONS, skeletonAt, standing } from '../src/exercises/motion';
import { buildMannequin, buildProps, makeMaterials, MUSCLE_NAMES } from '../ui/shared/mannequin';

const palette = { tint: 0xe4572e, body: 0xc9bfb2, muscle: 0xbba996, joint: 0xa99f92, load: 0x2f5d50, steel: 0xb0b0b0, furniture: 0x8a8378, floor: 0xddd6cc };

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
        const feet = man.group.children.filter((c) => c.scale.y === 0.04 && Math.abs(c.position.y - 0.03) < 0.001);
        expect(feet.length, name).toBe(2);
      }
    }
    expect(man.group.children.length).toBeLessThan(140); // includes one hidden tint overlay per muscle
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

  it('lays the chest as two mirrored diagonal fans meeting at the breastbone, and the glutes as two diagonal plates', () => {
    const man = buildMannequin(makeMaterials(palette));
    man.update(skeletonAt(MOTIONS['Bodyweight Squat']!, 0));
    man.group.updateMatrixWorld(true);
    const pair = (muscle: string) => {
      const both = man.muscles.filter((x) => x.muscle === muscle).map((x) => ({ box: new Box3().setFromObject(x.mesh), mesh: x.mesh }));
      return { left: both.find((p) => p.mesh.position.z > 0)!, right: both.find((p) => p.mesh.position.z < 0)!, count: both.length };
    };
    const chest = pair('chest');
    expect(chest.count).toBe(4); // an upper and a lower head on each side
    // The inner ends reach the midline without crossing it much, and the two sides mirror each other.
    expect(chest.left.box.min.z).toBeGreaterThan(-0.04);
    expect(chest.left.box.min.z).toBeLessThan(0.03);
    expect(chest.right.box.max.z).toBeLessThan(0.04);
    expect(chest.left.box.max.z + chest.right.box.min.z).toBeCloseTo(0, 2);
    expect(chest.left.box.max.z - chest.left.box.min.z).toBeGreaterThan(0.03);
    // The glutes sit behind the pelvis, are thin, and mirror each other.
    const glutes = pair('glutes');
    expect(glutes.count).toBe(2);
    expect(glutes.left.mesh.position.x).toBeLessThan(0);
    expect(glutes.left.box.max.x - glutes.left.box.min.x).toBeLessThan(0.16);
    expect(glutes.left.box.max.z + glutes.right.box.min.z).toBeCloseTo(0, 2);
    // A diagonal muscle: wider than it is tall for the chest, and tilted the other way on the other side.
    const q = (m: typeof chest.left) => new Vector3(0, 1, 0).applyQuaternion(m.mesh.quaternion);
    expect(Math.sign(q(chest.left).z)).toBe(-Math.sign(q(chest.right).z));
    // The neck has its own side muscles, and the trapezius slopes run to both shoulders.
    expect(man.muscles.filter((x) => x.muscle === 'neck').length).toBe(3); // the neck itself and the two sternocleidomastoids
    expect(man.muscles.filter((x) => x.muscle === 'traps').length).toBe(3); // the back diamond and the two slopes
    const abs = man.muscles.filter((x) => x.muscle === 'abdominals');
    expect(abs.length).toBe(4); // two columns and two flanks
    for (const x of abs) expect(Number.isFinite(x.mesh.position.x + x.mesh.position.y + x.mesh.position.z)).toBe(true);
  });

  it('tints the main muscles strongly and the secondary ones lightly as a film over the skin, and the tint can be turned off', () => {
    const mats = makeMaterials(palette);
    const man = buildMannequin(mats);
    const part = (muscle: string) => man.muscles.find((x) => x.muscle === muscle)!;
    man.setHighlight(['quadriceps'], ['glutes', 'calves']);
    expect(part('quadriceps').overlay.visible).toBe(true);
    expect(part('quadriceps').overlay.material).toBe(mats.musclePrimary);
    expect(part('glutes').overlay.material).toBe(mats.muscleSecondary);
    expect(part('calves').overlay.visible).toBe(true);
    expect(part('biceps').overlay.visible).toBe(false);
    // The muscle shapes themselves always stay skin-coloured contours.
    expect(man.muscles.every((x) => x.mesh.material === mats.muscle)).toBe(true);
    // Turning the tint off hides every overlay but leaves the contours.
    man.setHighlightVisible(false);
    expect(man.muscles.every((x) => !x.overlay.visible && x.mesh.visible)).toBe(true);
    man.setHighlightVisible(true);
    expect(part('quadriceps').overlay.visible).toBe(true);
    man.setHighlight([], []);
    expect(man.muscles.every((x) => !x.overlay.visible)).toBe(true);
  });
});

describe('collarbones', () => {
  it('run from the top of the breastbone to the tip of each shoulder, in front of the ribcage', () => {
    const man = buildMannequin(makeMaterials(palette));
    const k = skeletonAt(MOTIONS['Bodyweight Squat']!, 0);
    man.update(k);
    man.group.updateMatrixWorld(true);
    expect(man.collarbones.map((c) => c.side).sort()).toEqual([-1, 1]);
    for (const c of man.collarbones) {
      const box = new Box3();
      for (const part of c.parts) box.union(new Box3().setFromObject(part));
      const inner = c.side === 1 ? box.min.z : -box.max.z; // the end nearest the midline
      const outer = c.side === 1 ? box.max.z : -box.min.z;
      expect(inner, 'starts near the midline').toBeLessThan(0.04);
      expect(outer, 'reaches the shoulder').toBeGreaterThan(0.16);
      expect(box.max.x, 'lies in front of the body').toBeGreaterThan(0.08);
      expect(Math.abs((box.min.y + box.max.y) / 2 - k.neckBase.y), 'at the height of the neck base').toBeLessThan(0.07);
      expect(box.max.y - box.min.y, 'slender, a ridge and not a slab').toBeLessThan(0.09);
    }
  });
});
