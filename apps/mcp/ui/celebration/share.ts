// The "Make a card" panel of the milestone view (F4): choices, a live preview, and saving or copying the picture.
// The canvas is the preview and the saved image at once, and its text alternative lists exactly the words on it.
import type { App } from '@modelcontextprotocol/ext-apps';
import type { Celebration } from '../../src/analytics/celebrationTypes';
import { h } from '../shared/dom';
import { textButton } from '../shared/icons';
import { drawCard } from '../shared/shareCard';
import { defaultOptions, describeCard, FORMATS, type CardFormat, type CardOptions } from '../shared/shareCardText';

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

export function sharePanel(c: Celebration, app: App): HTMLElement {
  const o: CardOptions = defaultOptions(c);
  const canvas = h('canvas', { className: 'card-canvas' });
  const status = h('p', { className: 'muted small', role: 'status' });
  const fallback = h('div', {});
  const nameInput = h('input', { type: 'text', maxLength: 40, placeholder: 'Your name', className: 'name-input', 'aria-label': 'Name on the card', hidden: true, oninput: (e: Event) => { o.name = (e.target as HTMLInputElement).value; redraw(); } });

  const redraw = () => {
    const content = drawCard(canvas, c, o);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Card preview: ${describeCard(content)}`);
    fallback.replaceChildren();
    status.textContent = '';
  };

  /** A row of choices of which exactly one is on. */
  const choice = <T extends string>(label: string, entries: [T, string][], get: () => T, set: (v: T) => void) => {
    const buttons = entries.map(([value, text]) => textButton(null, text, () => { set(value); sync(); redraw(); }, { pressed: get() === value }));
    const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(entries[i]![0] === get())));
    return h('div', { className: 'choices wrap', role: 'group', 'aria-label': label }, ...buttons);
  };
  const check = (text: string, get: () => boolean, set: (v: boolean) => void, after?: () => void) =>
    h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); after?.(); redraw(); } }), text);

  const showImage = (message: string) => {
    status.textContent = message;
    fallback.replaceChildren(h('img', { className: 'card-image', src: canvas.toDataURL('image/png'), alt: canvas.getAttribute('aria-label') ?? 'The card' }));
  };

  async function save() {
    // A sandboxed view cannot download by itself: the host does it (and usually asks first), when it can.
    if (!app.getHostCapabilities()?.downloadFile) return showImage('This app cannot save files from here. Press and hold the picture to save it.');
    try {
      const r = await app.downloadFile({ contents: [{ type: 'resource', resource: { uri: `file:///fitwell-${c.kind}-${c.threshold}.png`, mimeType: 'image/png', blob: canvas.toDataURL('image/png').split(',')[1]! } }] });
      status.textContent = r.isError ? 'Not saved.' : 'Saved.';
    } catch {
      showImage('Saving did not work here. Press and hold the picture to save it.');
    }
  }

  async function copy() {
    try {
      const blob = await toBlob(canvas);
      if (!blob || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      status.textContent = 'Copied.';
    } catch {
      showImage('Copying is blocked here. Press and hold the picture to copy or save it.');
    }
  }

  const panel = h(
    'div',
    { className: 'share' },
    h('h2', {}, 'Make a card'),
    choice<CardFormat>('Format', (Object.keys(FORMATS) as CardFormat[]).map((k) => [k, FORMATS[k].label]), () => o.format, (v) => { o.format = v; }),
    choice<CardOptions['theme']>('Theme', [['light', 'Light'], ['dark', 'Dark']], () => o.theme, (v) => { o.theme = v; }),
    h(
      'div',
      { className: 'checks' },
      ...c.took.map((t, i) => check(`${t.label}`, () => o.numbers[i]!, (v) => { o.numbers[i] = v; })),
      check('Date', () => o.showDate, (v) => { o.showDate = v; }),
      ...(c.kind === 'goal_weight' && c.goalKg !== null ? [check('Goal weight', () => o.showGoalWeight, (v) => { o.showGoalWeight = v; })] : []),
      check('My name', () => o.showName, (v) => { o.showName = v; }, () => { nameInput.hidden = !o.showName; if (o.showName) nameInput.focus(); }),
      check('Fitwell', () => o.showBrand, (v) => { o.showBrand = v; }),
    ),
    nameInput,
    canvas,
    h('div', { className: 'share-actions' }, textButton(null, 'Save picture', () => void save()), textButton(null, 'Copy picture', () => void copy())),
    status,
    fallback,
    h('p', { className: 'muted small' }, 'The picture is made here, on your device. Fitwell does not keep or post it. Your name and weight are on it only when you turn them on.'),
  );
  redraw();
  return panel;
}
