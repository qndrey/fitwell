// A hidden log of what a touch does inside a view, to debug gestures in a host we cannot inspect (the Claude iOS app). Five quick
// taps on `trigger` turn it on or off; while on, the last lines are shown over the bottom of the view and never take a touch.
// Temporary: it goes once the iPhone scrolling is understood.

const LINES = 16;

export function attachTouchLog(trigger: HTMLElement): void {
  let taps: number[] = [];
  let box: HTMLPreElement | null = null;
  const lines: string[] = [];
  const out = (s: string) => {
    if (!box) return;
    lines.push(s);
    if (lines.length > LINES) lines.shift();
    box.textContent = lines.join('\n');
  };
  const where = (t: EventTarget | null) => {
    const e = t instanceof Element ? t : null;
    const card = e?.closest<HTMLElement>('.pcard');
    if (card) return `card(top ${Math.round(card.scrollTop)} of ${card.scrollHeight - card.clientHeight})`;
    return e?.closest('.track') ? 'track' : e?.closest('header') ? 'header' : (e?.tagName.toLowerCase() ?? '?');
  };

  let x0 = 0;
  let y0 = 0;
  let moves = 0;
  const onStart = (e: TouchEvent) => {
    const t = e.touches[0]!;
    x0 = t.clientX;
    y0 = t.clientY;
    moves = 0;
    out(`touchstart ${where(e.target)} y=${Math.round(y0)}${e.touches.length > 1 ? ` (${e.touches.length} fingers)` : ''}`);
  };
  const onMove = (e: TouchEvent) => {
    const t = e.touches[0]!;
    moves++;
    if (moves <= 3 || moves % 10 === 0) out(`  move #${moves} dx=${Math.round(t.clientX - x0)} dy=${Math.round(t.clientY - y0)}${e.cancelable ? '' : ' (not cancelable)'}`);
  };
  const onEnd = (e: TouchEvent) => out(`${e.type} after ${moves} moves`);
  const onCancel = (e: PointerEvent) => out(`pointercancel (${e.pointerType})`);
  let lastCard = -1;
  let lastLeft = -1;
  const onScroll = (e: Event) => {
    const t = e.target;
    if (t === document) return out(`  window scrollY=${Math.round(window.scrollY)}`);
    if (!(t instanceof HTMLElement)) return;
    if (t.classList.contains('pcard') && Math.round(t.scrollTop) !== lastCard) {
      lastCard = Math.round(t.scrollTop);
      out(`  card scrollTop=${lastCard} of ${t.scrollHeight - t.clientHeight}`);
    } else if (t.classList.contains('track') && Math.round(t.scrollLeft) !== lastLeft) {
      lastLeft = Math.round(t.scrollLeft);
      out(`  track scrollLeft=${lastLeft}`);
    }
  };
  const opts = { capture: true, passive: true } as const;

  function on() {
    box = document.createElement('pre');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;max-height:45%;overflow:hidden;margin:0;padding:6px;font:11px/1.3 ui-monospace,monospace;background:rgba(0,0,0,.82);color:#7f7;z-index:99999;pointer-events:none;white-space:pre-wrap';
    document.body.append(box);
    const card = document.querySelector<HTMLElement>('.pcard:not([inert])');
    const cs = card ? getComputedStyle(card) : null;
    out(`view ${innerWidth}x${innerHeight}, page ${document.documentElement.scrollHeight}, dpr ${devicePixelRatio}, coarse ${matchMedia('(pointer: coarse)').matches}`);
    out(`card ${card ? `${card.clientHeight}/${card.scrollHeight} overflow-y ${cs!.overflowY} touch ${cs!.touchAction}` : 'none'}`);
    out(navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 110));
    addEventListener('touchstart', onStart, opts);
    addEventListener('touchmove', onMove, opts);
    addEventListener('touchend', onEnd, opts);
    addEventListener('touchcancel', onEnd, opts);
    addEventListener('pointercancel', onCancel, opts);
    addEventListener('scroll', onScroll, opts);
  }
  function off() {
    box?.remove();
    box = null;
    lines.length = 0;
    removeEventListener('touchstart', onStart, opts);
    removeEventListener('touchmove', onMove, opts);
    removeEventListener('touchend', onEnd, opts);
    removeEventListener('touchcancel', onEnd, opts);
    removeEventListener('pointercancel', onCancel, opts);
    removeEventListener('scroll', onScroll, opts);
  }

  trigger.addEventListener('pointerup', (e) => {
    const now = e.timeStamp;
    taps = [...taps.filter((t) => now - t < 2000), now];
    if (taps.length < 5) return;
    taps = [];
    if (box) off();
    else on();
  });
}
