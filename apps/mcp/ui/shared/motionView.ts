// The animated 3D figure for the exercise guide and the workout player. One player per view (phones limit how many
// WebGL contexts a page may hold); `show` swaps the exercise. Returns null when WebGL is not available, so callers
// simply leave the animation out.
import { Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { progressAt, skeletonAt, standing, type MotionSpec } from '../../src/exercises/motion';
import { h } from './dom';
import { buildMannequin, buildProps, makeMaterials, setPalette, type Mannequin, type Palette, type Props } from './mannequin';

export interface MotionPlayer {
  /** Put this in the page. It stays the same element for the life of the view. */
  element: HTMLElement;
  /** Show an exercise's movement, or hide the animation when it has none. */
  show(spec: MotionSpec | null, label: string): void;
  /** Stop animating (the panel is closed or the exercise changed). */
  stop(): void;
  /** Re-read the colours after the host theme changed. */
  setTheme(): void;
}

type ViewName = 'side' | 'front' | 'angle';
const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'side', label: 'Side' },
  { id: 'front', label: 'Front' },
  { id: 'angle', label: '45°' },
];

const LIGHT: Palette = { body: 0xcfc5b8, joint: 0xa89d8f, load: 0x2f5d50, steel: 0xaeb2b6, furniture: 0x9a9184, floor: 0xe2dbd0 };
const DARK: Palette = { body: 0xb8ad9f, joint: 0x8f8579, load: 0x8fc7b4, steel: 0x9a9ea3, furniture: 0x6e675e, floor: 0x34312d };

function cssColor(name: string): Color | null {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return raw ? new Color(raw) : null;
  } catch {
    return null;
  }
}

/** Colours follow the theme: warm neutrals for the figure, the accent colour for the load. */
function readPalette(): Palette {
  const bg = cssColor('--bg') ?? cssColor('--surface');
  const dark = bg ? bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.45 : window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  const base = dark ? DARK : LIGHT;
  const accent = cssColor('--accent');
  return accent ? { ...base, load: accent.getHex() } : base;
}

export function createMotionPlayer(): MotionPlayer | null {
  const canvas = document.createElement('canvas');
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0xb8b0a5, 1.15));
  const sun = new DirectionalLight(0xffffff, 1.3);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new PerspectiveCamera(28, 4 / 3, 0.1, 30);
  const materials = makeMaterials(readPalette());
  const mannequin: Mannequin = buildMannequin(materials);
  mannequin.update(standing());
  scene.add(mannequin.group);
  let props: Props | null = null;
  const propsHolder = new Group();
  scene.add(propsHolder);

  let current: MotionSpec | null = null;
  /** Showing the standing figure with no exercise (used for checking the look of the figure). */
  let standingMode = false;
  let label = '';
  let view: ViewName = 'side';
  let paused = false;
  let visible = true;
  let started = 0;
  let frozenAt = 0;
  let raf = 0;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  // ----- controls -----
  const play = h('button', { type: 'button', className: 'motion-play', 'aria-pressed': 'false', onclick: () => setPaused(!paused) }, 'Pause');
  const viewButtons = VIEWS.map((v) => h('button', { type: 'button', 'aria-pressed': String(v.id === view), onclick: () => setView(v.id) }, v.label));
  const element = h(
    'div',
    { className: 'motion', hidden: true },
    canvas,
    h('div', { className: 'motion-controls', role: 'group', 'aria-label': 'Animation controls' }, play, ...viewButtons),
    h('p', { className: 'muted small' }, 'Schematic animation: follow the written cues for detail.'),
  );

  function frame(): void {
    if (!current && !standingMode) return;
    const bench = current?.pattern === 'bench';
    const target = bench ? { x: -0.2, y: 0.8 } : { x: 0.02, y: 0.88 };
    const d = bench ? 3.3 : 3.9;
    props?.setSideView(view === 'side');
    const sign = bench ? -1 : 1; // the front view of the lying figure is from the head end
    const pos = view === 'side' ? [target.x, target.y, d] : view === 'front' ? [target.x + sign * d, target.y, 0] : [target.x + sign * d * 0.6, target.y + 0.35, d * 0.8];
    camera.position.set(pos[0]!, pos[1]!, pos[2]!);
    camera.lookAt(target.x, target.y, 0);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Animation of ${label}, ${VIEWS.find((v) => v.id === view)!.label.toLowerCase()} view`);
  }

  function draw(p: number): void {
    if (standingMode && !current) {
      mannequin.update(standing());
      renderer.render(scene, camera);
      return;
    }
    if (!current) return;
    const k = skeletonAt(current, p);
    mannequin.update(k);
    props?.update(k);
    renderer.render(scene, camera);
  }

  const now = () => performance.now() / 1000;
  const currentP = () => (current ? progressAt((paused ? frozenAt : now() - started) % 1000, current) : 0);

  function tick(): void {
    raf = 0;
    if (!current || paused || !visible || document.hidden) return;
    draw(currentP());
    raf = requestAnimationFrame(tick);
  }
  function kick(): void {
    if (!raf && current && !paused && visible && !document.hidden) raf = requestAnimationFrame(tick);
  }

  function setPaused(next: boolean): void {
    if (next === paused) return;
    if (next) frozenAt = now() - started;
    else started = now() - frozenAt;
    paused = next;
    play.textContent = paused ? 'Play' : 'Pause';
    play.setAttribute('aria-pressed', String(paused));
    if (paused) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else kick();
  }

  function setView(next: ViewName): void {
    view = next;
    viewButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(VIEWS[i]!.id === view)));
    frame();
    draw(currentP());
  }

  function resize(): void {
    const w = Math.max(160, Math.round(element.clientWidth || canvas.clientWidth || 320));
    const hgt = Math.round((w * 3) / 4);
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    draw(currentP());
  }

  new ResizeObserver(resize).observe(element);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) kick();
  }).observe(element);
  document.addEventListener('visibilitychange', () => kick());
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    element.hidden = true;
  });

  const player: MotionPlayer = {
    element,
    show(spec, name) {
      if (!spec) {
        current = null;
        element.hidden = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      current = spec;
      standingMode = false;
      propsHolder.visible = true;
      label = name;
      propsHolder.clear();
      props = buildProps(spec, materials);
      propsHolder.add(props.group);
      props.setSideView(view === 'side');
      started = now();
      paused = false;
      play.textContent = 'Pause';
      play.setAttribute('aria-pressed', 'false');
      element.hidden = false;
      frame();
      resize();
      // Under reduced motion the figure waits at the bottom of the movement until the person starts it.
      if (reduced) {
        paused = true;
        frozenAt = 0;
        play.textContent = 'Play';
        play.setAttribute('aria-pressed', 'true');
        draw(1);
      } else kick();
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!paused) setPaused(true);
    },
    setTheme() {
      setPalette(materials, readPalette());
      draw(currentP());
    },
  };

  // For checking the pose and the camera from a script (screenshots, tests in a browser).
  (globalThis as unknown as { fitwellMotion?: unknown }).fitwellMotion = {
    seek(p: number) {
      setPaused(true);
      draw(Math.min(1, Math.max(0, p)));
    },
    view(name: ViewName) {
      setView(name);
    },
    pause() {
      setPaused(true);
    },
    standing() {
      current = null;
      standingMode = true;
      propsHolder.visible = false;
      label = 'the standing figure';
      element.hidden = false;
      frame();
      resize();
    },
  };
  return player;
}
