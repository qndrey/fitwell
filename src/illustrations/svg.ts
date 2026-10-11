import { HEAD_R, PLATE_R, SIZE, draw, framePoints, keyPoses, traceJoint, tracePath, type Drawing, type Frame, type Pt, type Segment, type Shape, type Template } from './figure';

const n = (v: number) => String(Math.round(v * 10) / 10);
const line = (a: Pt, b: Pt, cls: string) => `<line class="${cls}" x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}"/>`;
const poly = (pts: Pt[], cls: string) => `<polyline class="${cls}" fill="none" points="${pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}"/>`;
const circle = (c: Pt, r: number, cls: string) => `<circle class="${cls}" cx="${n(c[0])}" cy="${n(c[1])}" r="${n(r)}"/>`;

/** The head is drawn a little larger than the skeleton's, so the filled head reads at thumbnail size. */
const HEAD_DRAWN = HEAD_R * 1.08;

function shape(s: Shape): string {
  if (s.kind === 'line') return line(s.a, s.b, s.cls);
  if (s.kind === 'circle') return circle(s.c, s.r, s.cls);
  return `<rect class="${s.cls}" x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="1.2"/>`;
}

/**
 * The body, one stroke per segment so each can have its own weight: far limbs first and lighter,
 * then the near leg, torso, head and near arm on top. Segments in `work` get the `hot` class (accent colour).
 */
function body(f: Frame, scale: number, work: readonly Segment[] = []): string {
  const seg = (s: Segment, extra = '') => `fig-seg fig-${s}${extra}${work.includes(s) ? ' hot' : ''}`;
  const parts: string[] = [];
  if (f.farArm) parts.push(poly([f.shoulder, f.farArm.elbow, f.farArm.wrist], 'fig-seg fig-farm fig-far'));
  if (f.far) parts.push(poly([f.hip, f.far.knee, f.far.ankle, f.far.toe], 'fig-seg fig-shin fig-far'));
  parts.push(poly([f.hip, f.knee], seg('thigh')));
  parts.push(poly([f.knee, f.ankle, f.toe], seg('shin')));
  parts.push(poly([f.hip, f.shoulder, f.neck], seg('torso')));
  parts.push(circle(f.head, HEAD_DRAWN * scale, 'fig-head'));
  parts.push(poly([f.shoulder, f.elbow], seg('uarm')));
  parts.push(poly([f.elbow, f.wrist], seg('farm')));
  return parts.join('');
}

/** A soft shadow under whatever touches the floor; a small one under the hips when the figure is in the air. */
function shadow(d: Drawing): string {
  if (!d.floor) return '';
  const xs = framePoints(d.frame).filter((q) => q[1] > SIZE.floor - 1.5).map((q) => q[0]);
  const [cx, rx] = xs.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2 + 7] : [d.frame.hip[0], 6];
  return `<ellipse class="fig-shadow" cx="${n(cx)}" cy="${n(SIZE.floor + 1.2)}" rx="${n(rx)}" ry="1.6"/>`;
}

function implement(d: Drawing): string {
  const h = d.hold;
  if (!h) return '';
  const [x, y] = h.at;
  const len = Math.hypot(x - h.from[0], y - h.from[1]) || 1;
  const along: Pt = [(x - h.from[0]) / len, (y - h.from[1]) / len];
  switch (h.kind) {
    case 'barbell':
      return circle(h.at, PLATE_R, 'fig-implement') + circle(h.at, 1.4, 'fig-implement-hole');
    case 'dumbbell':
      return circle(h.at, 3.3, 'fig-implement') + circle(h.at, 0.9, 'fig-implement-hole');
    case 'kettlebell': {
      // The bell hangs past the hand, or rests on the back of the wrist when the forearm points up.
      const up = along[1] < -0.5;
      const c: Pt = up ? [x - 3.2, y + 1.6] : [x + along[0] * 4.2, y + along[1] * 4.2];
      return line(h.at, c, 'fig-implement-handle') + circle(c, 3.3, 'fig-implement');
    }
    case 'wheel':
      return circle(h.at, 3.8, 'fig-implement') + circle(h.at, 1.3, 'fig-implement-hole');
    default:
      return circle(h.at, 1.7, 'fig-implement');
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
  /** Where the traced joint is now, marked on the path while the figure moves. */
  dot?: Pt;
  /** Body parts doing the work, drawn in the accent colour. */
  work?: readonly Segment[];
}

/** The inside of the <svg> (viewBox 0 0 120 80). Colours come from the `fig-*` classes in components.css. */
export function figureMarkup(d: Drawing, opts: FigureOptions = {}): string {
  const parts: string[] = [];
  if (d.floor) parts.push(line([6, SIZE.floor + 1.5], [114, SIZE.floor + 1.5], 'fig-floor'));
  parts.push(...d.props.map(shape));
  parts.push(shadow(d));
  if (d.hold?.anchor) parts.push(line(d.hold.at, d.hold.anchor, 'fig-cable'));
  if (opts.ghost) parts.push(`<g class="fig-ghost-g">${body(opts.ghost, d.scale)}</g>`);
  if (opts.trace) parts.push(poly(opts.trace, 'fig-trace'), arrow(opts.trace));
  parts.push(body(d.frame, d.scale, opts.work));
  parts.push(implement(d));
  if (opts.dot) parts.push(circle(opts.dot, 1.5, 'fig-trace-dot'));
  return parts.join('');
}

/**
 * The figure at `t`, with the working muscles in the accent colour.
 * `extras` adds the motion path (with a dot where the figure is now) and a faint copy of the other end.
 */
export function figureAt(tpl: Template, t: number, extras: { ghost?: boolean; trace?: boolean } = {}): string {
  const moves = keyPoses(tpl).some((p) => JSON.stringify(p) !== JSON.stringify(tpl.start));
  const d = draw(tpl, t);
  const opts: FigureOptions = { work: tpl.work };
  if (extras.ghost && moves) opts.ghost = draw(tpl, t >= 0.5 ? 0 : 1).frame;
  if (extras.trace && moves) {
    opts.trace = tracePath(tpl);
    const joint = traceJoint(tpl);
    if (opts.trace && joint !== 'none') opts.dot = d.frame[joint];
  }
  return figureMarkup(d, opts);
}
