// The load and the furniture of the exercise animation: barbell, dumbbells, kettlebell, bench and floor, plus the colours
// they take from the host theme. Plain three.js geometry; nothing here needs WebGL, so tests can build and move it in Node.
import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, BoxGeometry, Vector3, type Material, type Object3D } from 'three';
import { BAR_RADIUS, BENCH_HEIGHT, PLATE_RADIUS, type MotionSpec, type Skeleton, type Vec3 } from '../../src/exercises/motion';

export interface Materials {
  load: Material;
  steel: Material;
  furniture: Material;
  floor: Material;
  shadow: Material;
}

export interface Palette {
  /** The tint laid over the muscles an exercise works. */
  tint: number;
  /** The skin. */
  body: number;
  load: number;
  steel: number;
  furniture: number;
  floor: number;
}

export function makeMaterials(p: Palette): Materials {
  const std = (color: number, roughness = 0.8) => new MeshStandardMaterial({ color, roughness, metalness: 0.05 });
  return {
    load: std(p.load, 0.6),
    steel: new MeshStandardMaterial({ color: p.steel, roughness: 0.35, metalness: 0.6 }),
    furniture: std(p.furniture),
    floor: new MeshBasicMaterial({ color: p.floor, transparent: true, opacity: 0.55 }),
    shadow: new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }),
  };
}

export function setPalette(m: Materials, p: Palette): void {
  (m.load as MeshStandardMaterial).color.setHex(p.load);
  (m.steel as MeshStandardMaterial).color.setHex(p.steel);
  (m.furniture as MeshStandardMaterial).color.setHex(p.furniture);
  (m.floor as MeshBasicMaterial).color.setHex(p.floor);
}

const v3 = (a: Vec3) => new Vector3(a.x, a.y, a.z);

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
