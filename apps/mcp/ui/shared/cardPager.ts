// The swipeable cards of the workout player, the dashboard and the review: a header (title, counter, ‹ ›, a strip of thin segments,
// an optional label row) over a horizontal scroll-snap track. The pager mechanics live here; what a card holds, and what the strip's
// fill means, belongs to the view. Text goes through textContent only (names come from data).
import { h } from './dom';
import { iconButton, type IconName } from './icons';

export type StripState = 'full' | 'half' | 'empty' | 'plain';

export interface PagerCardInfo {
  key: string;
  name: string;
  /** When every card has one, the strip is a row of icon tabs (the card's name is each tab's name) instead of thin segments. */
  icon?: IconName;
}

export interface CardPagerOptions {
  /** The view name in the title bar. */
  title: string;
  cards: PagerCardInfo[];
  /** The track's `aria-label`. */
  trackLabel?: string;
  /** What each strip segment shows; `plain` (the default) is a thin segment without fill. */
  stripState?: (pos: number) => StripState;
  /** A continuous bar in place of the segments, filled to this percentage; null for segments. The player uses it from 9 cards on. */
  bar?: () => number | null;
  /** Given, the strip is one button that calls this (the player: back to the Overview). Absent, each segment is a button that jumps to its card. */
  onStrip?: () => void;
  stripLabel?: (pos: number, count: number) => string;
  /** Goes between the counter and ›. */
  titleExtra?: Node;
  /** A row under the strip: the current card's name, a sub line and a control on the right (see `setLabel`). */
  labelRow?: boolean;
  /** The card the view considers current. Default: the pager keeps it. */
  getPos?: () => number;
  /** The scroll came to rest on another card. `auto` is true when the move was started with `goTo(.., { auto: true })`. */
  onSettle?: (pos: number, auto: boolean) => void;
  /** A move the person made (button, key, strip, `goTo` without `auto`). */
  onManualMove?: () => void;
  /** The strip was previewed on a card the scroll then did not stay on. Default: redraw the header. */
  onStale?: () => void;
  /** The text to announce 300 ms after a card settled. Default: "Nutrition, card 2 of 8". */
  announceText?: (pos: number) => string;
  /** Where announcements go. Default: a `role="status"` line in the header. */
  announce?: (text: string) => void;
  /** The element to focus in a card after ‹ › or a jump with `focus`. Default: the card's `[data-focus]`. */
  focusTarget?: (card: HTMLElement, pos: number) => HTMLElement | null;
}

export interface CardPager {
  header: HTMLElement;
  titlebar: HTMLElement;
  track: HTMLElement;
  strip: HTMLElement;
  /** One persistent section per card; the view fills them. */
  cards: () => HTMLElement[];
  setTitle(title: string): void;
  /** Names the cards (and builds or drops sections when the count changes, putting the track on `at`, else on the nearest card); returns the sections. */
  setCards(infos: PagerCardInfo[], at?: number): HTMLElement[];
  setLabel(label: { sub?: (pos: number) => string | null; right?: Node | null }): void;
  goTo(pos: number, opts?: { focus?: boolean; auto?: boolean }): void;
  /** The card in view now (the settled one). */
  pos(): number;
  /** Puts the track on a card with no animation. */
  snap(pos: number): void;
  refreshHeader(): void;
  refreshCards(): void;
  announce(text: string): void;
  destroy(): void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollBehavior = (): ScrollBehavior => (reduced() ? 'auto' : 'smooth');
const hasScrollEnd = 'onscrollend' in window;

export function createCardPager(opts: CardPagerOptions): CardPager {
  let infos = opts.cards.slice();
  let current = 0;
  let pointerDown = false;
  let pendingFocus = -1;
  /** The card an automatic move is heading for, so settling there is not mistaken for a manual move. */
  let autoPos = -1;
  /** The card the strip and the counter show while a scroll is under way: the one nearest the middle, or the one a jump is heading to. */
  let shown = -1;
  /** The card a button, key or tap is scrolling to; set until the scroll comes to rest. */
  let scrollTarget = -1;
  let fxFrame = 0;
  let settleTimer: number | undefined;
  let announceTimer: number | undefined;
  let announced = -1;
  let label: { sub?: (pos: number) => string | null; right?: Node | null } = {};
  const pos = () => (opts.getPos ? opts.getPos() : current);
  const stripAt = () => (shown >= 0 ? shown : pos());
  const count = () => infos.length;

  const prev = h('button', { type: 'button', className: 'navbtn', 'data-key': 'prev', onclick: () => stepBy(-1) }, '‹');
  const next = h('button', { type: 'button', className: 'navbtn', 'data-key': 'next', onclick: () => stepBy(1) }, '›');
  const counter = h('span', { className: 'counter' });
  const title = h('strong', { title: opts.title }, opts.title);
  const titlebar = h('div', { className: 'titlebar' }, prev, title, counter, opts.titleExtra, next);
  const strip = opts.onStrip
    ? h('button', { type: 'button', className: 'strip', 'data-strip': '', 'data-key': 'strip', onclick: opts.onStrip })
    : h('div', { className: 'strip', 'data-strip': '', role: 'group', 'aria-label': 'Cards' });
  const labelName = h('strong', {});
  const labelSub = h('span', { className: 'muted' });
  const labelRight = h('div', { className: 'lright' });
  const labelRow = opts.labelRow ? h('div', { className: 'labelrow' }, h('div', { className: 'lname' }, labelName, labelSub), labelRight) : null;
  const live = opts.announce ? null : h('p', { className: 'sr-only', role: 'status' });
  const header = h('header', { className: 'head' }, titlebar, strip, labelRow, live);

  const track = h('div', {
    className: 'track',
    'aria-roledescription': 'carousel',
    'aria-label': opts.trackLabel ?? 'Cards',
    'aria-keyshortcuts': 'ArrowLeft ArrowRight Home End',
    onscroll: () => {
      swipeEffect();
      if (hasScrollEnd) return;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, 120);
    },
    onscrollend: () => settle(),
    onpointerdown: () => {
      scrollTarget = -1;
      pointerDown = true;
    },
  });

  const announce = (text: string) => {
    if (opts.announce) return opts.announce(text);
    if (!live) return;
    live.textContent = '';
    window.setTimeout(() => (live.textContent = text), 50);
  };

  function makeCard(): HTMLElement {
    return h('section', {
      className: 'pcard',
      role: 'group',
      'aria-roledescription': 'card',
    });
  }

  let cards: HTMLElement[] = [];
  let ro: ResizeObserver | null = null;
  function build(n: number) {
    // The slide is what snaps; the card inside it is what tilts while dragged, so the snap position never moves with the effect.
    ro?.disconnect();
    cards = Array.from({ length: n }, makeCard);
    track.replaceChildren(...cards.map((card) => h('div', { className: 'slide' }, card)));
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(fitTrack);
      for (const card of cards) ro.observe(card);
    }
  }
  build(count());

  /** The card the track is showing: nearest card to the scroll position, read from the track itself. */
  function trackPos(): number {
    const w = track.clientWidth;
    return w > 0 ? clamp(Math.round(track.scrollLeft / w), 0, count() - 1) : pos();
  }

  /** Moves the highlight in the strip and the counter now, without waiting for the scroll to settle. */
  function previewPos(p: number) {
    if (p === stripAt()) return;
    shown = p;
    refreshHeader();
  }

  const iconTabs = () => count() > 0 && infos.every((i) => i.icon);

  function stripSegments(): Node[] {
    const n = count();
    if (iconTabs() && !opts.onStrip) {
      return infos.map((info, i) => {
        const tab = iconButton(info.icon!, `${info.name}, ${i + 1} of ${n}`, () => goTo(i, { focus: true }), { className: 'tab' });
        tab.setAttribute('data-key', `tab-${info.key}`);
        if (i === stripAt()) tab.setAttribute('aria-current', 'true');
        return tab;
      });
    }
    const fill = opts.bar?.() ?? null;
    if (fill !== null && n > 1) {
      const bar = h('span', { className: 'cbar', 'aria-hidden': 'true' }, h('span', { className: 'cfill' }), h('span', { className: 'cmark', 'data-marker': '' }));
      bar.style.setProperty('--fill', String(fill));
      bar.style.setProperty('--pos', String((stripAt() / (n - 1)) * 100));
      return [bar];
    }
    return Array.from({ length: n }, (_, i) => {
      const kind = opts.stripState?.(i) ?? 'plain';
      const seg = h('span', { className: `sg ${kind}${i === stripAt() ? ' current' : ''}`, 'data-seg': kind, 'aria-hidden': 'true' });
      if (opts.onStrip) return seg;
      return h('button', { type: 'button', tabIndex: -1, className: 'sgb', 'aria-label': `${infos[i]!.name}, ${i + 1} of ${n}`, onclick: () => goTo(i, { focus: true }) }, seg);
    });
  }

  /** ‹ and ›: they name the card they go to; at either end they stay in place, `aria-disabled`, and do nothing. */
  function updateNav(p: number) {
    const last = count() - 1;
    for (const [btn, to, word] of [[prev, p - 1, 'Previous'], [next, p + 1, 'Next']] as const) {
      const end = to < 0 || to > last;
      btn.setAttribute('aria-label', end ? `${word} card` : `${word} card: ${infos[to]!.name}`);
      btn.setAttribute('aria-disabled', String(end));
    }
  }

  function refreshHeader() {
    const at = stripAt();
    const n = count();
    strip.classList.toggle('icons', iconTabs() && !opts.onStrip);
    strip.replaceChildren(...stripSegments());
    if (opts.onStrip) strip.setAttribute('aria-label', opts.stripLabel ? opts.stripLabel(at, n) : `Card ${at + 1} of ${n}`);
    counter.textContent = `${at + 1} of ${n}`;
    updateNav(at);
    if (labelRow) {
      labelName.textContent = infos[at]?.name ?? '';
      labelSub.textContent = label.sub?.(at) ?? '';
      labelRight.replaceChildren(...(label.right ? [label.right] : []));
    }
  }

  function refreshCards() {
    const last = count() - 1;
    cards.forEach((card, i) => {
      card.setAttribute('aria-label', `${i + 1} of ${last + 1}: ${infos[i]!.name}`);
      card.inert = i !== pos();
    });
    fitTrack();
  }

  /**
   * The track is as tall as the card in view (at least --track-h, so short cards share one height and swiping between them does not
   * jump). A card never scrolls by itself: in the Claude iOS app the chat takes every up-and-down swipe that starts on a view, so the
   * chat scrolls a long card.
   */
  function fitTrack() {
    const slide = cards[pos()]?.parentElement;
    if (slide) track.style.height = `${slide.offsetHeight}px`;
  }

  /** The ‹ and › buttons: one card on from where the pager is heading (so two quick taps go two cards), focus on the new card's heading. */
  function stepBy(dir: -1 | 1) {
    const here = scrollTarget >= 0 ? scrollTarget : stripAt();
    const to = here + dir;
    if (to < 0 || to > count() - 1) return;
    goTo(to, { focus: true });
  }

  /**
   * While the track is being dragged, each card tilts, shrinks and fades by how far it is from the middle, pivoting from below
   * like a card being thrown: the one leaving turns away, the one coming in straightens up. A card at rest has no transform at all.
   */
  function swipeEffect() {
    if (scrollTarget < 0) previewPos(trackPos());
    if (fxFrame) return;
    fxFrame = window.requestAnimationFrame(() => {
      fxFrame = 0;
      const w = track.clientWidth;
      const off = reduced();
      cards.forEach((card, i) => {
        const d = w > 0 && !off ? clamp((i * w - track.scrollLeft) / w, -1, 1) : 0;
        const a = Math.abs(d);
        if (a < 0.002 || a > 0.998) {
          card.style.transform = '';
          card.style.opacity = '';
          return;
        }
        card.style.transformOrigin = '50% 140%';
        card.style.transform = `rotate(${(d * 7).toFixed(2)}deg) scale(${(1 - 0.08 * a).toFixed(3)})`;
        card.style.opacity = String((1 - 0.55 * a).toFixed(3));
      });
    });
  }

  /** The scroll came to rest: the card in view is the current one. */
  function settle() {
    const p = trackPos();
    const previewed = shown;
    shown = -1;
    scrollTarget = -1;
    // A hard fling can come to rest between two snap points: bring the card to the middle.
    const w = track.clientWidth;
    if (w > 0 && Math.abs(track.scrollLeft - p * w) > 2 && !pointerDown) track.scrollTo({ left: p * w, behavior: scrollBehavior() });
    if (p !== pos()) {
      const auto = p === autoPos;
      current = p;
      opts.onSettle?.(p, auto);
      queueAnnouncement(p);
      if (!opts.onSettle) {
        refreshHeader();
        refreshCards();
      }
    }
    if (previewed >= 0 && previewed !== p) (opts.onStale ?? refreshHeader)();
    autoPos = -1;
    if (pendingFocus === p) focusCard(p);
    pendingFocus = -1;
  }

  function focusCard(p: number) {
    const card = cards[p];
    if (!card) return;
    (opts.focusTarget ? opts.focusTarget(card, p) : card.querySelector<HTMLElement>('[data-focus]'))?.focus({ preventScroll: true });
  }

  /** Announces the card in view 300 ms after the scroll settled (after any log message), once per settled card. */
  function queueAnnouncement(p: number) {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      if (p !== pos() || p === announced) return;
      announced = p;
      announce(opts.announceText ? opts.announceText(p) : `${infos[p]!.name}, card ${p + 1} of ${count()}`);
    }, 300);
  }

  /** Moves the pager; never while a finger is down on the track (it would fight the swipe). */
  function goTo(p: number, o: { focus?: boolean; auto?: boolean } = {}) {
    if (pointerDown) return;
    const target = clamp(p, 0, count() - 1);
    if (o.auto) autoPos = target;
    else {
      autoPos = -1;
      opts.onManualMove?.();
    }
    pendingFocus = o.focus ? target : -1;
    if (trackPos() === target) {
      settle();
      return;
    }
    scrollTarget = target;
    previewPos(target);
    cards[target]!.parentElement!.scrollIntoView({ inline: 'center', block: 'nearest', behavior: scrollBehavior() });
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    // From the card the pager is heading to, so two quick key presses go two cards.
    const here = scrollTarget >= 0 ? scrollTarget : stripAt();
    const to = e.key === 'ArrowLeft' ? here - 1 : e.key === 'ArrowRight' ? here + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? count() - 1 : null;
    if (to === null) return;
    e.preventDefault();
    goTo(to);
  };
  const up = () => (pointerDown = false);
  document.addEventListener('keydown', onKey);
  window.addEventListener('pointerup', up, { capture: true });
  window.addEventListener('pointercancel', up, { capture: true });
  window.addEventListener('blur', up);

  function snap(p: number) {
    track.scrollLeft = clamp(p, 0, count() - 1) * track.clientWidth;
  }

  refreshHeader();

  return {
    header,
    titlebar,
    track,
    strip,
    cards: () => cards,
    setTitle(t) {
      title.textContent = t;
      title.title = t;
    },
    setCards(next, at) {
      infos = next.slice();
      if (infos.length !== cards.length) {
        build(infos.length);
        current = clamp(at ?? current, 0, Math.max(0, infos.length - 1));
        snap(current);
        window.requestAnimationFrame(() => snap(pos()));
      }
      refreshHeader();
      return cards;
    },
    setLabel(l) {
      label = l;
      refreshHeader();
    },
    goTo,
    pos,
    snap,
    refreshHeader,
    refreshCards,
    announce,
    destroy() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', up, { capture: true });
      window.removeEventListener('blur', up);
      window.clearTimeout(settleTimer);
      window.clearTimeout(announceTimer);
      ro?.disconnect();
    },
  };
}
