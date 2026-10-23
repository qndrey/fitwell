// The views' icon set: inline SVG on a 24 px grid, stroke in currentColor, drawn at 20 px (see .icon in base.css). Built with svg() from dom.ts,
// never parsed from a string (host CSP). An icon is decoration: the button that holds it carries the accessible name (iconButton does).
import { h, svg, type Child } from './dom';
import { ICONS, type IconName } from './iconShapes';

export { ICONS, type IconName };

/** One icon, hidden from assistive technology: whoever uses it names the button or row it sits in. */
export function icon(name: IconName): SVGElement {
  return svg('svg', { viewBox: '0 0 24 24', class: 'icon', 'data-icon': name, 'aria-hidden': 'true', focusable: 'false' }, ...ICONS[name].map(([tag, attrs]) => svg(tag, attrs)));
}

interface ButtonOptions {
  /** Extra classes next to `quiet` (for example `inline`). */
  className?: string;
  /** For a toggle: the state it is in. Leave out for a plain button. */
  pressed?: boolean;
  disabled?: boolean;
  /** For a short visible word (30d): the full name assistive technology reads (30 days). */
  label?: string;
}

/** A quiet button with only an icon: the label is its accessible name and its tooltip. */
export function iconButton(name: IconName, label: string, onclick: (e: MouseEvent) => void, options: ButtonOptions = {}): HTMLButtonElement {
  return quietButton([icon(name)], label, onclick, options);
}

/** A quiet button with an icon and a word (or a word alone when `name` is null); the visible word is the accessible name. */
export function textButton(name: IconName | null, text: string, onclick: (e: MouseEvent) => void, options: ButtonOptions = {}): HTMLButtonElement {
  return quietButton([name ? icon(name) : null, text], options.label, onclick, options);
}

function quietButton(children: Child[], label: string | undefined, onclick: (e: MouseEvent) => void, { className, pressed, disabled }: ButtonOptions): HTMLButtonElement {
  const b = h('button', { type: 'button', className: className ? `quiet ${className}` : 'quiet', onclick, disabled: disabled ?? false }, ...children);
  if (label) {
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  return b;
}
