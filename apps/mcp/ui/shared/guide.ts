import type { ExerciseGuide } from '../../src/exercises/guide';
import { MACHINE_FOOTNOTE } from '../../src/exercises/machines';
import { h } from './dom';
import { textButton } from './icons';

const list = (items: string[]) => h('ul', { className: 'bullets' }, ...items.map((t) => h('li', {}, t)));

/**
 * The guide card: the figure (animated when the exercise has a movement) with its muscles lit, steps, machine setup and a demo link. `openLink` asks the host to open the demo search;
 * if the host refuses, the address is shown to copy. With `textFirst` the written part comes first and `textFirst` (a button that brings the animation, or the animation itself)
 * stands after it, so the card does not jump or load the figure unasked.
 */
export function renderGuide(g: ExerciseGuide, openLink: (url: string) => Promise<boolean>, motion?: HTMLElement | null, textFirst?: Node | null): HTMLElement {
  const primary = new Set(g.primary);
  const secondary = new Set(g.secondary.filter((m) => !primary.has(m)));
  const fallback = h('p', { className: 'muted small', hidden: true }, 'Could not open the link here. Search for: ', h('code', {}, `${g.name} exercise how to`));
  const demo = textButton('external-link', 'Demo video', () => {
    void openLink(g.demoUrl).then((ok) => {
      fallback.hidden = ok;
    });
  }, { className: 'demo' });
  const facts = [g.equipment !== 'none' ? g.equipment : 'no equipment', g.level, g.category].filter((x): x is string => !!x);
  return h(
    'section',
    { className: 'guide', 'aria-label': `How to do ${g.name}` },
    h('h2', {}, g.name),
    h('p', { className: 'muted small' }, facts.join(' · ')),
    textFirst === undefined ? (motion ?? null) : null,
    h(
      'p',
      { className: 'worked' },
      h('span', { className: 'key' }, h('i', { className: 'sw hot' }), `Main: ${g.primary.join(', ') || 'not listed'}`),
      secondary.size > 0 && h('span', { className: 'key' }, h('i', { className: 'sw warm' }), `Also: ${[...secondary].join(', ')}`),
    ),
    g.instructions.length > 0 && h('div', {}, h('h3', {}, 'How to do it'), h('ol', { className: 'steps' }, ...g.instructions.map((t) => h('li', {}, t)))),
    g.machine &&
      h(
        'div',
        { className: 'machine' },
        h('h3', {}, g.machine.title),
        h('h4', {}, 'Set it up'),
        list(g.machine.setup),
        h('h4', {}, 'What good form feels like'),
        list(g.machine.cues),
        h('h4', {}, 'Common mistakes'),
        list(g.machine.mistakes),
        h('p', { className: 'muted small' }, MACHINE_FOOTNOTE),
      ),
    textFirst ?? null,
    demo,
    fallback,
  );
}
