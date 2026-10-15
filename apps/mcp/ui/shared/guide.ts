import { BODY_HEIGHT, BODY_VIEWS, BODY_WIDTH, SILHOUETTE } from '../../src/exercises/bodyMap';
import type { ExerciseGuide } from '../../src/exercises/guide';
import { MACHINE_FOOTNOTE } from '../../src/exercises/machines';
import { h, svg } from './dom';

const MIRROR = `matrix(-1 0 0 1 ${BODY_WIDTH} 0)`;

/** One side of the body with the worked muscles filled: primary dark, secondary light, the rest only outlined. */
function bodyMap(view: 'front' | 'back', primary: Set<string>, secondary: Set<string>): SVGElement {
  const el = svg('svg', { class: 'body', viewBox: `0 0 ${BODY_WIDTH} ${BODY_HEIGHT}`, 'aria-hidden': 'true' });
  const shape = (cls: string, d: string, mirror: boolean, muscle?: string) => {
    for (const flip of mirror ? [false, true] : [false]) {
      const p = svg('path', { class: cls, d, ...(flip ? { transform: MIRROR } : {}) });
      if (muscle) p.dataset.muscle = muscle;
      el.append(p);
    }
  };
  for (const part of SILHOUETTE) shape('sil', part.d, part.mirror);
  for (const r of BODY_VIEWS[view]) shape(primary.has(r.muscle) ? 'm primary' : secondary.has(r.muscle) ? 'm secondary' : 'm', r.d, r.mirror, r.muscle);
  return el;
}

const list = (items: string[]) => h('ul', { className: 'bullets' }, ...items.map((t) => h('li', {}, t)));

/**
 * The guide card: animation (when there is one), muscles, steps, machine setup and a demo link. `openLink` asks the host to open the demo search;
 * if the host refuses, the address is shown to copy.
 */
export function renderGuide(g: ExerciseGuide, openLink: (url: string) => Promise<boolean>, motion?: HTMLElement | null): HTMLElement {
  const primary = new Set(g.primary);
  const secondary = new Set(g.secondary.filter((m) => !primary.has(m)));
  const fallback = h('p', { className: 'muted small', hidden: true }, 'Could not open the link here. Search for: ', h('code', {}, `${g.name} exercise how to`));
  const demo = h('button', {
    type: 'button',
    className: 'demo',
    onclick: () => {
      void openLink(g.demoUrl).then((ok) => {
        fallback.hidden = ok;
      });
    },
  }, 'Find a demo video');
  const facts = [g.equipment !== 'none' ? g.equipment : 'no equipment', g.level, g.category].filter((x): x is string => !!x);
  return h(
    'section',
    { className: 'guide', 'aria-label': `How to do ${g.name}` },
    h('h2', {}, g.name),
    h('p', { className: 'muted small' }, facts.join(' · ')),
    g.motion && motion ? motion : null,
    h(
      'figure',
      { className: 'maps' },
      h('div', { className: 'map' }, bodyMap('front', primary, secondary), h('span', { className: 'muted small' }, 'Front')),
      h('div', { className: 'map' }, bodyMap('back', primary, secondary), h('span', { className: 'muted small' }, 'Back')),
      h(
        'figcaption',
        {},
        h('span', { className: 'key' }, h('i', { className: 'sw primary' }), `Main: ${g.primary.join(', ') || 'not listed'}`),
        secondary.size > 0 && h('span', { className: 'key' }, h('i', { className: 'sw secondary' }), `Also: ${[...secondary].join(', ')}`),
      ),
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
    demo,
    fallback,
  );
}
