/**
 * The sideways swipe of a card track on a touch screen. There the track is not a native horizontal scroller (the CSS gives it
 * `overflow-x: hidden; touch-action: pan-y` under `pointer: coarse`): a scroller nested in a view keeps every touch that
 * starts on it in the mobile apps, so the chat around the view could not be scrolled up or down from the cards. The browser
 * still pans up and down; a sideways drag reaches here instead, moves the track with the finger and, on release, calls `goTo`
 * with the next card for a flick or the nearest one otherwise. Elsewhere (a mouse, a trackpad) the track scrolls natively and
 * this does nothing.
 */
export function touchSwipe(track: HTMLElement, goTo: (index: number) => void): { dragging: () => boolean; destroy: () => void } {
  interface Drag { id: number; x: number; y: number; left: number; from: number; moved: boolean; lastX: number; lastT: number; v: number }
  let drag: Drag | null = null;
  let swallowClick = false;
  const owned = () => getComputedStyle(track).overflowX === 'hidden';
  const last = () => track.children.length - 1;
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary || !owned()) return;
    const w = track.clientWidth;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: track.scrollLeft, from: w > 0 ? Math.round(track.scrollLeft / w) : 0, moved: false, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    // Until the drag is clearly sideways the browser may still take it as a vertical pan (and send pointercancel).
    if (!drag.moved && (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - drag.y))) return;
    drag.moved = true;
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.v = 0.8 * ((e.clientX - drag.lastX) / dt) + 0.2 * drag.v;
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
    track.scrollLeft = drag.left - dx;
  });
  const release = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    if (e.type === 'pointerup') {
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), 400);
    }
    const w = track.clientWidth;
    // A flick (a finger still moving faster than 0.3 px/ms when it lifts) goes one card on; a slow drag goes to the nearest.
    const fresh = e.timeStamp - d.lastT < 100;
    const to = fresh && Math.abs(d.v) > 0.3 ? d.from - Math.sign(d.v) : w > 0 ? Math.round(track.scrollLeft / w) : d.from;
    goTo(clamp(clamp(to, d.from - 1, d.from + 1), 0, last()));
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  // A drag that ends on a button is not a tap on it.
  track.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  // With no scroll snap the track keeps its offset in pixels when its width changes (a turn of the phone): keep it on its card.
  let width = 0;
  const ro =
    'ResizeObserver' in window
      ? new ResizeObserver(() => {
          const w = track.clientWidth;
          if (width > 0 && w > 0 && w !== width && !drag && owned()) track.scrollLeft = Math.round(track.scrollLeft / width) * w;
          width = w;
        })
      : null;
  ro?.observe(track);
  return { dragging: () => drag?.moved ?? false, destroy: () => ro?.disconnect() };
}
