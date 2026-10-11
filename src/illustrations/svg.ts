import { HEAD_R, PLATE_R, SIZE, draw, keyPoses, tracePath, type Drawing, type Frame, type Pt, type Shape, type Template } from './figure';

const n = (v: number) => String(Math.round(v * 10) / 10);
const line = (a: Pt, b: Pt, cls: string) => `<line class="${cls}" x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}"/>`;
const poly = (pts: Pt[], cls: string) => `<polyline class="${cls}" fill="none" points="${pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}"/>`;
const circle = (c: Pt, r: number, cls: string) => `<circle class="${cls}" cx="${n(c[0])}" cy="${n(c[1])}" r="${n(r)}"/>`;

function shape(s: Shape): string {
  if (s.kind === 'line') return line(s.a, s.b, s.cls);
  if (s.kind === 'circle') return circle(s.c, s.r, s.cls);
  return `<rect class="${s.cls}" x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="1.2"/>`;
}

/** The body: far limbs first and lighter, then the near leg, torso, head and near arm on top. */
function body(f: Frame, scale: number, ghost = false): string {
  const c = (cls: string) => (ghost ? `fig-ghost${cls === 'fig-torso' ? ' thick' : ''}` : cls);
  const parts: string[] = [];
  if (f.farArm) parts.push(poly([f.shoulder, f.farArm.elbow, f.farArm.wrist], ghost ? c('fig-limb') : 'fig-limb fig-far'));
  if (f.far) parts.push(poly([f.hip, f.far.knee, f.far.ankle, f.far.toe], ghost ? c('fig-limb') : 'fig-limb fig-far'));
  parts.push(poly([f.hip, f.knee, f.ankle, f.toe], c('fig-limb')));
  parts.push(poly([f.hip, f.shoulder, f.neck], c('fig-torso')));
  parts.push(circle(f.head, HEAD_R * scale, ghost ? 'fig-ghost-head' : 'fig-head'));
  parts.push(poly([f.shoulder, f.elbow, f.wrist], c('fig-limb')));
  return parts.join('');
}

function implement(d: Drawing): string {
  const h = d.hold;
  if (!h) return '';
  const [x, y] = h.at;
  const len = Math.hypot(x - h.from[0], y - h.from[1]) || 1;
  const along: Pt = [(x - h.from[0]) / len, (y - h.from[1]) / len];
  switch (h.kind) {
    case 'barbell':
      return circle(h.at, PLATE_R, 'fig-implement') + circle(h.at, 1.4, 'fig-implement solid');
    case 'dumbbell':
      return circle(h.at, 3.2, 'fig-implement solid');
    case 'kettlebell': {
      // The bell hangs past the hand, or rests on the back of the wrist when the forearm points up.
      const up = along[1] < -0.5;
      const c: Pt = up ? [x - 3.2, y + 1.6] : [x + along[0] * 4.2, y + along[1] * 4.2];
      return line(h.at, c, 'fig-implement-handle') + circle(c, 3.3, 'fig-implement solid');
    }
    case 'wheel':
      return circle(h.at, 3.8, 'fig-implement') + circle(h.at, 1.1, 'fig-implement solid');
    default:
      return circle(h.at, 1.6, 'fig-implement solid');
  }
}

function arrow(pts: Pt[]): string {
  const a = pts[pts.length - 2]!;
  const b = pts[pts.length - 1]!;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const tip: Pt = [b[0] + u[0] * 2, b[1] + u[1] * 2];
  const left: Pt = [b[0] - u[0] * 2 - u[1] * 2, b[1] - u[1] * 2 + u[0] * 2];
  const right: Pt = [b[0] - u[0] * 2 + u[1] * 2, b[1] - u[1] * 2 - u[0] * 2];
  return `<polygon class="fig-trace-head" points="${[tip, left, right].map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}"/>`;
}

export interface FigureOptions {
  /** A faint copy of the other end position behind the figure. */
  ghost?: Frame;
  /** The dotted path the hands (or another joint) travel, with an arrow at the end. */
  trace?: Pt[];
}

/** The inside of the <svg> (viewBox 0 0 120 80). Colours come from the `fig-*` classes in components.css. */
export function figureMarkup(d: Drawing, opts: FigureOptions = {}): string {
  const parts: string[] = [];
  if (d.floor) parts.push(line([6, SIZE.floor + 1.5], [114, SIZE.floor + 1.5], 'fig-floor'));
  parts.push(...d.props.map(shape));
  if (d.hold?.anchor) parts.push(line(d.hold.at, d.hold.anchor, 'fig-cable'));
  if (opts.ghost) parts.push(`<g class="fig-ghost-g">${body(opts.ghost, d.scale, true)}</g>`);
  if (opts.trace) parts.push(poly(opts.trace, 'fig-trace'), arrow(opts.trace));
  parts.push(body(d.frame, d.scale));
  parts.push(implement(d));
  return parts.join('');
}

/** The figure at `t`. `extras` adds the motion path and a faint copy of the other end, for pictures that stand still. */
export function figureAt(tpl: Template, t: number, extras: { ghost?: boolean; trace?: boolean } = {}): string {
  const moves = keyPoses(tpl).some((p) => JSON.stringify(p) !== JSON.stringify(tpl.start));
  const opts: FigureOptions = {};
  if (extras.ghost && moves) opts.ghost = draw(tpl, t >= 0.5 ? 0 : 1).frame;
  if (extras.trace && moves) opts.trace = tracePath(tpl);
  return figureMarkup(draw(tpl, t), opts);
}
