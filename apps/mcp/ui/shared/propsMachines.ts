// Frames, seats, pads and handles of gym machines for the exercise animation. Plain three.js geometry; each builder returns
// its group and the parts that follow the pose (the caller moves them from the skeleton each frame).
import { BoxGeometry, CylinderGeometry, Group, Mesh } from 'three';
import type { Materials } from './props';

/** The two uprights of a Smith machine with a sleeve on each that rides at the bar's height. */
export function smithFrame(m: Materials): { group: Group; sleeves: Mesh[] } {
  const g = new Group();
  const height = 2.3;
  const sleeves: Mesh[] = [];
  for (const z of [0.72, -0.72]) {
    const post = new Mesh(new BoxGeometry(0.07, height, 0.07), m.furniture);
    post.position.set(0, height / 2, z);
    post.userData.screen = z > 0 ? true : undefined;
    const foot = new Mesh(new BoxGeometry(0.5, 0.04, 0.09), m.furniture);
    foot.position.set(0, 0.02, z);
    foot.userData.screen = z > 0 ? true : undefined;
    const sleeve = new Mesh(new CylinderGeometry(0.045, 0.045, 0.1, 12), m.steel);
    sleeve.position.set(0, 1, z);
    sleeve.userData.screen = z > 0 ? true : undefined;
    sleeves.push(sleeve);
    g.add(post, foot, sleeve);
  }
  const beam = new Mesh(new BoxGeometry(0.07, 0.07, 1.5), m.furniture);
  beam.position.set(0, height, 0);
  g.add(beam);
  return { group: g, sleeves };
}
