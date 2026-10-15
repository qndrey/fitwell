// The load and the furniture of the exercise animation: barbell, dumbbells, kettlebell, bench and floor, plus the colours
// they take from the host theme. Plain three.js geometry; nothing here needs WebGL, so tests can build and move it in Node.
import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, BoxGeometry, Vector3, type Material, type Object3D } from 'three';
import { BAR_RADIUS, BENCH_HEIGHT, PLATE_RADIUS, PULLUP_BAR_HEIGHT, type MotionSpec, type Skeleton, type Vec3 } from '../../src/exercises/motion';

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
  /** The camera's turn around the figure (0 is the side view). Seen from the side, the plates nearest the camera would hide the figure, so they are left out. */
  setCamera(azimuth: number): void;
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

/** A flat bench, an incline bench (the back raised `incline` degrees), or an upright seat with a back pad (`seated`). */
function bench(m: Materials, incline = 0, seated = false): Group {
  const g = new Group();
  if (incline === 0 && !seated) {
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
  // The hips sit at the foot of the back pad; the pad runs up along the trunk, a little behind it.
  const theta = ((seated ? 90 : incline) * Math.PI) / 180;
  const hip = seated ? { x: -0.15, y: 0.5 } : { x: 0, y: BENCH_HEIGHT + 0.1 };
  const t = { x: -Math.cos(theta), y: Math.sin(theta) };
  const front = { x: Math.sin(theta), y: Math.cos(theta) };
  const pad = new Mesh(new BoxGeometry(0.9, 0.08, 0.3), m.furniture);
  pad.position.set(hip.x - front.x * 0.14 + t.x * 0.3, hip.y - front.y * 0.14 + t.y * 0.3, 0);
  pad.rotation.z = -theta;
  g.add(pad);
  const seat = new Mesh(new BoxGeometry(0.5, 0.08, 0.3), m.furniture);
  seat.position.set(hip.x + 0.18, BENCH_HEIGHT - 0.04, 0);
  g.add(seat);
  for (const [x, h] of [[hip.x + 0.38, BENCH_HEIGHT - 0.08], [pad.position.x, pad.position.y - 0.04]] as const) {
    for (const z of [0.1, -0.1]) {
      const leg = new Mesh(new BoxGeometry(0.05, h, 0.05), m.furniture);
      leg.position.set(x, h / 2, z);
      g.add(leg);
    }
  }
  return g;
}

/** A pull-up bar on two posts. */
function pullupBar(m: Materials): Group {
  const g = new Group();
  const bar = new Mesh(new CylinderGeometry(BAR_RADIUS * 1.2, BAR_RADIUS * 1.2, 1.1, 10), m.steel);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, PULLUP_BAR_HEIGHT, 0);
  g.add(bar);
  for (const z of [0.55, -0.55]) {
    const post = new Mesh(new BoxGeometry(0.06, PULLUP_BAR_HEIGHT + 0.05, 0.06), m.furniture);
    post.position.set(0, (PULLUP_BAR_HEIGHT + 0.05) / 2, z);
    post.userData.screen = z > 0 ? true : undefined;
    g.add(post);
  }
  return g;
}

/** A lat pulldown station: seat, knee pad, a frame with a pulley overhead, and the cable down to the bar. */
function pulldownStation(m: Materials, seatX: number, barLength: number): { group: Group; bar: Group; cable: Mesh; pulley: Vector3 } {
  const g = new Group();
  const seat = new Mesh(new BoxGeometry(0.5, 0.08, 0.34), m.furniture);
  seat.position.set(seatX + 0.1, BENCH_HEIGHT - 0.04, 0);
  g.add(seat);
  const seatStem = new Mesh(new BoxGeometry(0.06, BENCH_HEIGHT - 0.08, 0.06), m.furniture);
  seatStem.position.set(seatX + 0.1, (BENCH_HEIGHT - 0.08) / 2, 0);
  g.add(seatStem);
  const kneePad = new Mesh(new CylinderGeometry(0.045, 0.045, 0.34, 12), m.steel);
  kneePad.rotation.x = Math.PI / 2;
  kneePad.position.set(seatX + 0.4, 0.6, 0);
  g.add(kneePad);
  const frameX = seatX - 0.7;
  const post = new Mesh(new BoxGeometry(0.08, 2.5, 0.08), m.furniture);
  post.position.set(frameX, 1.25, 0);
  const beam = new Mesh(new BoxGeometry(0.7, 0.06, 0.08), m.furniture);
  beam.position.set(frameX + 0.35, 2.5, 0);
  g.add(post, beam);
  const pulley = new Vector3(-0.12, 2.42, 0);
  const wheel = new Mesh(new CylinderGeometry(0.06, 0.06, 0.04, 16), m.steel);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.copy(pulley);
  g.add(wheel);
  const cable = new Mesh(new CylinderGeometry(0.006, 0.006, 1, 6), m.steel);
  g.add(cable);
  const bar = new Group();
  const handle = new Mesh(new CylinderGeometry(0.016, 0.016, barLength, 10), m.steel);
  handle.rotation.x = Math.PI / 2;
  bar.add(handle);
  g.add(bar);
  return { group: g, bar, cable, pulley };
}

/** The load and furniture for an exercise; they follow the pose through `update`. */
export function buildProps(spec: MotionSpec, m: Materials): Props {
  const group = new Group();
  const floor = new Mesh(new CircleGeometry(1.3, 40), m.floor);
  floor.rotation.x = -Math.PI / 2;
  const lying = spec.pattern === 'bench' || spec.pattern === 'incline';
  floor.position.set(lying ? -0.15 : spec.pattern === 'pushup' ? 0.6 : spec.pattern === 'lunge' ? -0.3 : 0.05, 0.001, 0);
  group.add(floor);
  if (spec.pattern === 'bench') group.add(bench(m));
  if (spec.pattern === 'incline') group.add(bench(m, spec.variant.incline));
  if (spec.pattern === 'press' && spec.variant.seated) group.add(bench(m, 0, true));
  if (spec.pattern === 'pull' && !spec.variant.seated) group.add(pullupBar(m));
  const station = spec.pattern === 'pull' && spec.variant.seated ? pulldownStation(m, -0.28, spec.variant.grip === 'wide' ? 1.15 : spec.variant.grip === 'close' ? 0.5 : 0.9) : null;
  if (station) group.add(station.group);

  const load = spec.variant.load;
  const bar = load === 'barbell-back' || load === 'barbell-front' || load === 'barbell-hands' ? barbell(m) : null;
  const bells = load === 'dumbbells' ? [dumbbell(m), dumbbell(m)] : [];
  const kettle = load === 'goblet' ? kettlebell(m) : null;
  for (const o of [bar, kettle, ...bells]) if (o) group.add(o);

  /** Which side of the figure the camera is on while it looks along the figure (+1 or -1), or 0 when it looks from the front or back. */
  let near = 0;
  const screens: Object3D[] = [];
  group.traverse((o) => {
    if (o.userData.screen) screens.push(o);
  });
  const world = new Vector3();
  const applySide = () => {
    group.updateMatrixWorld(true);
    for (const o of screens) o.visible = !(near !== 0 && Math.sign(o.getWorldPosition(world).z) === near);
  };

  return {
    group,
    setCamera(azimuth: number) {
      const across = Math.cos(azimuth);
      near = Math.abs(across) > 0.5 ? Math.sign(across) : 0;
      applySide();
    },
    update(k: Skeleton) {
      bar?.position.copy(v3(k.bar));
      kettle?.position.copy(v3(k.bar));
      if (station) {
        station.bar.position.copy(v3(k.bar));
        // The cable runs from the pulley down to the middle of the bar.
        const from = station.pulley;
        const to = v3(k.bar);
        const d = to.clone().sub(from);
        station.cable.position.copy(from).addScaledVector(d, 0.5);
        station.cable.scale.set(1, d.length(), 1);
        station.cable.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
      }
      if (bells.length) {
        bells[0]!.position.copy(v3(k.gripL));
        bells[1]!.position.copy(v3(k.gripR));
      }
      if (near !== 0) applySide();
    },
  };
}

/** The floor alone, for the standing figure with no exercise. */
export function buildStandingProps(m: Materials): Props {
  const group = new Group();
  const floor = new Mesh(new CircleGeometry(1.3, 40), m.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0.05, 0.001, 0);
  group.add(floor);
  return { group, update() {}, setCamera() {} };
}
