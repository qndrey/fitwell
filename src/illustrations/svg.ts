import { HEAD_R, SIZE, draw, type Drawing, type Pt, type Template } from './figure';

const n = (v: number) => String(Math.round(v * 10) / 10);
const line = (a: Pt, b: Pt, cls: string) => `<line class="${cls}" x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}"/>`;
const poly = (pts: Pt[], cls: string) => `<polyline class="${cls}" fill="none" points="${pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}"/>`;

/** The inside of the <svg> (viewBox 0 0 120 80). Colours come from the `fig-*` classes in components.css. */
export function figureMarkup(d: Drawing): string {
  const { frame: f } = d;
  const parts: string[] = [];
  if (!d.bar) parts.push(`<line class="fig-floor" x1="6" y1="${SIZE.floor + 1.5}" x2="114" y2="${SIZE.floor + 1.5}"/>`);
  if (d.bench) {
    const b = d.bench;
    parts.push(`<rect class="fig-prop" x="${n(b.x1)}" y="${n(b.top)}" width="${n(b.x2 - b.x1)}" height="3" rx="1.2"/>`);
    parts.push(line([b.x1 + 4, b.top + 3], [b.x1 + 4, SIZE.floor + 1.5], 'fig-propline'), line([b.x2 - 4, b.top + 3], [b.x2 - 4, SIZE.floor + 1.5], 'fig-propline'));
  }
  if (d.bar) parts.push(line([30, d.bar.y], [90, d.bar.y], 'fig-prop-bar'), line([30, d.bar.y], [30, d.bar.y + 5], 'fig-propline'), line([90, d.bar.y], [90, d.bar.y + 5], 'fig-propline'));
  if (d.hold?.anchor) parts.push(line(d.hold.at, d.hold.anchor, 'fig-cable'));
  if (f.far) parts.push(poly([f.hip, f.far.knee, f.far.ankle, f.far.toe], 'fig-limb fig-far'));
  parts.push(poly([f.hip, f.knee, f.ankle, f.toe], 'fig-limb'));
  parts.push(poly([f.hip, f.shoulder], 'fig-torso'));
  parts.push(poly([f.shoulder, f.elbow, f.wrist], 'fig-limb'));
  parts.push(`<circle class="fig-head" cx="${n(f.head[0])}" cy="${n(f.head[1])}" r="${n(HEAD_R)}"/>`);
  if (d.hold?.kind === 'barbell') parts.push(`<circle class="fig-implement" cx="${n(f.wrist[0])}" cy="${n(f.wrist[1])}" r="6"/>`);
  if (d.hold?.kind === 'dumbbell') parts.push(`<circle class="fig-implement solid" cx="${n(f.wrist[0])}" cy="${n(f.wrist[1])}" r="3.4"/>`);
  return parts.join('');
}

export const figureAt = (tpl: Template, t: number) => figureMarkup(draw(tpl, t));
