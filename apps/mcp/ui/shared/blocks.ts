// Building blocks of a card in the dashboard and the review: a tinted block with the big number, hairline rows, text toggles.
// Text goes through textContent only (the `h` helper).
import { h, type Child } from './dom';

export const empty = (text: string) => h('p', { className: 'muted small' }, text);
export const caption = (text: string) => h('p', { className: 'cap' }, text);
/** The heading a screen reader lands on after ‹ ›; the label row names the card for everyone else. */
export const heading = (name: string) => h('h2', { className: 'sr-only', tabIndex: -1, 'data-focus': '' }, name);
/** The one tinted block of a card: the big number, its sentence, and what goes with them (a chart and its caption). */
export const tint = (number: string | null, sentence: string | null, ...rest: Child[]) => h('div', { className: 'tint' }, number && h('p', { className: 'big' }, number), sentence && h('p', { className: 'muted small' }, sentence), ...rest);
/** A 44 px row: the label on the left, the value on the right (a muted note after it), and an optional muted line under both. */
export const hrow = (label: string, value: string, note?: string | null, sub?: string | null) => h('div', { className: 'hrow' }, h('span', { className: 'name' }, label), h('span', { className: 'val' }, value, note && h('span', { className: 'muted' }, ` ${note}`)), sub && h('span', { className: 'hsub' }, sub));
export const subhead = (text: string) => h('h3', { className: 'sub' }, text);
/** Text buttons that pick one of a few views: the chosen one is semibold and underlined. */
export const toggle = (label: string, options: readonly (readonly [string, string])[], current: string, pick: (key: string) => void, disabled = false) =>
  h('div', { className: 'toggle', role: 'group', 'aria-label': label }, ...options.map(([key, text]) => h('button', { type: 'button', className: 'link', disabled, 'data-key': `toggle-${label}-${key}`, 'aria-pressed': String(key === current), onclick: () => pick(key) }, text)));
