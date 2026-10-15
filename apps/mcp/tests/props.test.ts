import { describe, expect, it } from 'vitest';
import { MOTIONS, skeletonAt } from '../src/exercises/motion';
import { buildProps, makeMaterials } from '../ui/shared/props';

const palette = { tint: 0xe4572e, body: 0xc9bfb2, load: 0x2f5d50, steel: 0xb0b0b0, furniture: 0x8a8378, floor: 0xddd6cc };

describe('props', () => {
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
