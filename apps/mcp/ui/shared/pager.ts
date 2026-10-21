import { h } from './dom';

export interface PagerCard {
  title: string;
  el: HTMLElement;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const behavior = (): ScrollBehavior => (reduced() ? 'auto' : 'smooth');

/**
 * A strip of card titles over a horizontal scroll-snap track (the same swipe as the workout player), so a view takes the height of
 * one card instead of all of them. `active` is the card to show; `onChange` is told when a swipe or a tap moves to another.
 * The track is as tall as the card in view.
 */
export function buildPager(cards: PagerCard[], active: number, onChange: (index: number) => void): HTMLElement[] {
  let current = Math.min(Math.max(active, 0), cards.length - 1);
  const slides = cards.map((c) => h('div', { className: 'slide', role: 'group', 'aria-roledescription': 'card', 'aria-label': c.title }, c.el));
  const tabs = cards.map((c, i) => h('button', { type: 'button', onclick: () => goTo(i) }, c.title));
  const strip = h('div', { className: 'tabs', role: 'group', 'aria-label': 'Cards' }, ...tabs);
  const track = h('div', { className: 'pager', 'aria-roledescription': 'carousel', 'aria-label': 'Swipe for more' }, ...slides);

  const fit = () => {
    const slide = slides[current]!;
    track.style.height = `${slide.offsetHeight}px`;
  };
  const mark = () => {
    tabs.forEach((t, i) => (i === current ? t.setAttribute('aria-current', 'true') : t.removeAttribute('aria-current')));
    const t = tabs[current]!;
    strip.scrollTo({ left: t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2, behavior: behavior() });
  };
  /** The card a tap or key is scrolling to; scroll events on the way there must not move the highlight back. */
  let heading = -1;
  function goTo(i: number) {
    heading = i;
    track.scrollTo({ left: i * track.clientWidth, behavior: behavior() });
    if (i !== current) settle(i);
  }
  function settle(i: number) {
    if (i === current) return;
    current = i;
    mark();
    fit();
    onChange(i);
  }
  const nearest = () => (track.clientWidth > 0 ? Math.min(Math.max(Math.round(track.scrollLeft / track.clientWidth), 0), cards.length - 1) : current);
  let timer: number | undefined;
  track.addEventListener('scroll', () => {
    // Follow the swipe as it crosses the halfway point; no need to wait for it to stop.
    const i = nearest();
    if (heading >= 0) {
      if (i === heading) heading = -1;
    } else if (i !== current) settle(i);
    window.clearTimeout(timer);
    timer = window.setTimeout(fit, 120);
  });
  track.addEventListener('pointerdown', () => (heading = -1));
  track.addEventListener('keydown', (e) => {
    const to = e.key === 'ArrowLeft' ? current - 1 : e.key === 'ArrowRight' ? current + 1 : null;
    if (to === null || to < 0 || to >= cards.length) return;
    e.preventDefault();
    goTo(to);
  });
  track.tabIndex = 0;

  // Once in the page: put the track on the card to show, with no animation, and size it. Content that loads later (fonts) re-sizes it.
  queueMicrotask(() => {
    track.scrollTo({ left: current * track.clientWidth });
    mark();
    fit();
  });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(fit);
    for (const slide of slides) ro.observe(slide);
  }
  return [strip, track];
}
