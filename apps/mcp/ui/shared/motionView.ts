// The animated 3D figure for the exercise guide and the workout player. One player per view (phones limit how many
// WebGL contexts a page may hold); `show` swaps the exercise. Drag to turn the figure around. Returns null when WebGL is not
// available, so callers simply leave the figure out.
import { Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { BREATH_SECONDS, gripFor, progressAt, relaxed, skeletonAt, type MotionSpec } from '../../src/exercises/motion';
import bodyGz from '../assets/body.glb.gz';
import { h } from './dom';
import { loadHumanBody, type HumanBody } from './humanBody';
import { buildProps, buildStandingProps, makeMaterials, setPalette, type Palette, type Props } from './props';

/** Unzips the embedded model. Needs `DecompressionStream`; rejects when the browser has none (the caller then leaves the animation out). */
async function unzip(gz: Uint8Array): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
  const stream = new Blob([gz as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export interface MotionPlayer {
  /** Put this in the page. It stays the same element for the life of the view. */
  element: HTMLElement;
  /** Show an exercise's movement with its muscles lit up; with no movement, the standing figure with the muscles lit. */
  show(spec: MotionSpec | null, label: string, muscles?: { primary: string[]; secondary: string[] }): void;
  /** Stop animating (the panel is closed or the exercise changed). */
  stop(): void;
  /** Re-read the colours after the host theme changed. */
  setTheme(): void;
}

/** Where the camera is: `az` turns it around the figure (0 is the side, π/2 the front of a standing figure), `el` lifts it. */
interface View {
  az: number;
  el: number;
}
/** Where the camera looks and how far back it stands, per movement (the figure is 1.7 m tall; a pull-up bar is 2.3 m up). */
const FRAMING: Record<string, { x: number; y: number; d: number }> = {
  rest: { x: 0.02, y: 0.88, d: 3.7 },
  squat: { x: 0.02, y: 0.88, d: 3.9 },
  bench: { x: -0.2, y: 0.8, d: 3.3 },
  incline: { x: -0.2, y: 0.9, d: 3.5 },
  press: { x: 0.02, y: 1.12, d: 5.0 },
  row: { x: 0.0, y: 0.8, d: 3.9 },
  curl: { x: 0.02, y: 0.88, d: 3.9 },
  pull: { x: 0.0, y: 1.25, d: 5.8 },
  pullup: { x: 0.0, y: 1.3, d: 6.4 },
  lunge: { x: -0.3, y: 0.88, d: 4.1 },
  pushup: { x: 0.6, y: 0.5, d: 3.6 },
  legpress: { x: 0.35, y: 0.7, d: 4.8 },
  kneemachine: { x: 0.1, y: 0.6, d: 3.9 },
  lyingcurl: { x: 0.1, y: 0.55, d: 4.0 },
  chestpress: { x: 0.1, y: 0.85, d: 4.2 },
  machinerow: { x: 0.2, y: 0.85, d: 4.2 },
  pecdeck: { x: 0.0, y: 0.85, d: 5.2 },
  armmachine: { x: 0.0, y: 0.8, d: 4.0 },
  calf: { x: 0.0, y: 0.95, d: 4.4 },
  hipmachine: { x: 0.0, y: 0.7, d: 4.0 },
  seatedrow: { x: 0.6, y: 0.7, d: 5.0 },
  pushdown: { x: 0.2, y: 1.15, d: 5.0 },
  facepull: { x: 0.5, y: 1.0, d: 4.6 },
  straightarm: { x: 0.3, y: 1.15, d: 5.0 },
  crossover: { x: 0.1, y: 1.05, d: 5.4 },
};
const EL_MIN = -0.35;
const EL_MAX = 1.1;

const LIGHT: Palette = { tint: 0xe4572e, body: 0xd9b8a0, load: 0x2f5d50, steel: 0xaeb2b6, furniture: 0x9a9184, floor: 0xe2dbd0 };
const DARK: Palette = { tint: 0xff7a4d, body: 0xbf9a83, load: 0x8fc7b4, steel: 0x9a9ea3, furniture: 0x6e675e, floor: 0x34312d };

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
  scene.add(new HemisphereLight(0xffffff, 0xc9bcb0, 1.05));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(2.5, 4, 3.5);
  scene.add(sun);
  const camera = new PerspectiveCamera(28, 4 / 3, 0.1, 30);
  const materials = makeMaterials(readPalette());
  let props: Props | null = null;
  const propsHolder = new Group();
  scene.add(propsHolder);

  // The body loads on first use. When it cannot (no DecompressionStream, a bad file) the figure is left out.
  let human: HumanBody | null = null;
  let humanState: 'idle' | 'loading' | 'failed' = 'idle';
  let worked: { primary: string[]; secondary: string[] } = { primary: [], secondary: [] };
  function loadHuman(): void {
    if (humanState !== 'idle') return;
    humanState = 'loading';
    unzip(bodyGz)
      .then((buf) => loadHumanBody(buf, readPalette()))
      .then((body) => {
        human = body;
        human.setHighlight(worked.primary, worked.secondary);
        human.setHighlightVisible(musclesOn);
        scene.add(human.group);
        draw(currentP());
      })
      .catch(() => {
        humanState = 'failed';
        current = null;
        element.hidden = true;
      });
  }

  /** The movement on show; null while the standing figure is shown. */
  let current: MotionSpec | null = null;
  let label = '';
  let view: View = { az: 0, el: 0.06 };
  /** A camera target chosen from a script (`look`), for close-ups. */
  let closeup: { x: number; y: number; d: number } | null = null;
  let musclesOn = true;
  let paused = false;
  let visible = true;
  let started = 0;
  let frozenAt = 0;
  let raf = 0;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  // ----- controls -----
  const play = h('button', { type: 'button', className: 'motion-play', 'aria-pressed': 'false', onclick: () => setPaused(!paused) }, 'Pause');
  const muscleButton = h('button', { type: 'button', className: 'motion-muscles', 'aria-pressed': 'true', onclick: () => setMuscles(!musclesOn) }, 'Highlight');
  const resetButton = h('button', { type: 'button', className: 'motion-reset', onclick: () => turnTo(defaultView()) }, 'Reset view');
  const hint = h('p', { className: 'muted small' });
  const element = h(
    'div',
    { className: 'motion', hidden: true },
    canvas,
    h('div', { className: 'motion-controls', role: 'group', 'aria-label': 'Figure controls' }, play, muscleButton, resetButton),
    hint,
  );

  /** The side for a movement, the front for the standing figure; a lying figure is first seen from the side too. */
  const defaultView = (): View => (current ? { az: 0, el: 0.06 } : { az: Math.PI / 2, el: 0.06 });

  function frame(): void {
    const key = current?.pattern === 'pull' && !current.variant.seated ? 'pullup' : current?.pattern;
    const base = key ? FRAMING[key] ?? FRAMING.squat! : FRAMING.rest!;
    // A Smith machine is 2.3 m tall: stand further back so its frame shows.
    const where = current?.variant.rails ? { ...base, y: Math.max(base.y, 1.05), d: base.d + 0.9 } : base;
    const target = closeup ?? where;
    const d = closeup?.d ?? where.d;
    props?.setCamera(view.az);
    const flat = Math.cos(view.el);
    camera.position.set(target.x + d * Math.sin(view.az) * flat, target.y + d * Math.sin(view.el), d * Math.cos(view.az) * flat);
    camera.lookAt(target.x, target.y, 0);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${current ? `Animation of ${label}` : `The muscles worked by ${label}`}. Drag or use the arrow keys to turn it.`);
  }

  function draw(p: number): void {
    if (!human) return; // nothing to draw until the body has loaded
    if (!current) {
      // At ease: the arms hang, and the figure breathes.
      const seconds = reduced ? 0 : now();
      human.update(relaxed(human.body, seconds), 0.25, 'inward');
      human.setBreath(reduced ? 0 : Math.sin((2 * Math.PI * seconds) / BREATH_SECONDS));
      renderer.render(scene, camera);
      return;
    }
    const k = skeletonAt(current, p, human.body);
    human.update(k, gripFor(current), current.variant.palm);
    props?.update(k);
    renderer.render(scene, camera);
  }

  const now = () => performance.now() / 1000;
  /** A position chosen from a script (`seek`); while set, redraws (a resize, a turn) keep it. */
  let forced: number | null = null;
  const currentP = () => (current ? (forced ?? progressAt((paused ? frozenAt : now() - started) % 1000, current)) : 0);

  function tick(): void {
    raf = 0;
    if (!running()) return;
    draw(currentP());
    raf = requestAnimationFrame(tick);
  }
  /** The figure moves while it is on screen: the movement when there is one (unless paused), the breathing at ease. */
  let stopped = false;
  const running = () => !stopped && visible && !document.hidden && (current ? !paused : !reduced);
  function kick(): void {
    if (!raf && running() && !element.hidden) raf = requestAnimationFrame(tick);
  }

  function setPaused(next: boolean): void {
    if (next === paused) return;
    forced = null;
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

  function setMuscles(on: boolean): void {
    musclesOn = on;
    human?.setHighlightVisible(on);
    muscleButton.setAttribute('aria-pressed', String(on));
    draw(currentP());
  }

  function turnTo(next: View): void {
    view = { az: next.az, el: Math.min(EL_MAX, Math.max(EL_MIN, next.el)) };
    frame();
    draw(currentP());
  }

  // Drag to turn: sideways turns the figure around, up and down tilts the view. On a touch screen the page still scrolls
  // up and down (`touch-action: pan-y`), so only the sideways part reaches the figure there.
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  canvas.tabIndex = 0;
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    turnTo({ az: view.az - dx * 0.012, el: view.el + dy * 0.008 });
  });
  const release = () => {
    drag = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('keydown', (e) => {
    const step = 0.15;
    const next = e.key === 'ArrowLeft' ? { az: view.az + step, el: view.el } : e.key === 'ArrowRight' ? { az: view.az - step, el: view.el } : e.key === 'ArrowUp' ? { az: view.az, el: view.el - step } : e.key === 'ArrowDown' ? { az: view.az, el: view.el + step } : null;
    if (!next) return;
    e.preventDefault();
    turnTo(next);
  });

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
    show(spec, name, muscles) {
      if (humanState === 'failed') {
        element.hidden = true;
        return;
      }
      current = spec;
      forced = null;
      stopped = false;
      worked = { primary: muscles?.primary ?? [], secondary: muscles?.secondary ?? [] };
      human?.setHighlight(worked.primary, worked.secondary);
      human?.setHighlightVisible(musclesOn);
      loadHuman();
      label = name;
      propsHolder.clear();
      props = spec ? buildProps(spec, materials) : buildStandingProps(materials);
      propsHolder.add(props.group);
      view = defaultView();
      play.hidden = !spec;
      hint.textContent = spec ? 'Drag to turn the figure. Schematic animation: follow the written cues for detail.' : 'Drag to turn the figure.';
      started = now();
      paused = false;
      play.textContent = 'Pause';
      play.setAttribute('aria-pressed', 'false');
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      element.hidden = false;
      frame();
      resize();
      // Under reduced motion the figure waits at the bottom of the movement until the person starts it.
      if (spec && reduced) {
        paused = true;
        frozenAt = 0;
        play.textContent = 'Play';
        play.setAttribute('aria-pressed', 'true');
        draw(1);
      } else kick();
    },
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!paused) setPaused(true);
    },
    setTheme() {
      setPalette(materials, readPalette());
      human?.setPalette(readPalette());
      draw(currentP());
    },
  };

  // For checking the pose and the camera from a script (screenshots, tests in a browser).
  (globalThis as unknown as { fitwellMotion?: unknown }).fitwellMotion = {
    seek(p: number) {
      setPaused(true);
      forced = Math.min(1, Math.max(0, p));
      draw(forced);
    },
    /** Turns the camera: `side`, `front`, `angle` or `back` for a standing or lifting figure (a lying one is seen from its head for `front`). */
    view(name: 'side' | 'front' | 'angle' | 'back') {
      const sign = current?.pattern === 'bench' || current?.pattern === 'incline' ? -1 : 1;
      turnTo({ side: { az: 0, el: 0.06 }, front: { az: sign * (Math.PI / 2), el: 0.06 }, back: { az: -sign * (Math.PI / 2), el: 0.06 }, angle: { az: sign * (Math.PI / 4), el: 0.3 } }[name]);
    },
    rotate(az: number, el: number) {
      turnTo({ az, el });
    },
    pause() {
      setPaused(true);
    },
    look(x?: number, y?: number, d?: number) {
      closeup = x === undefined ? null : { x, y: y ?? 0.88, d: d ?? 1 };
      frame();
      draw(currentP());
    },
    /** Whether the body has loaded. */
    bodyReady() {
      return human !== null;
    },
  };
  return player;
}
