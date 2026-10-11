import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Button } from './Button';
import { Icon } from './Icon';

let firstScreen = true;

export interface ScreenNav {
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Screen wrapper: moves focus to the heading on navigation for screen-reader users.
 * `onSubtitle` makes the subtitle (a date) a button, e.g. to jump back to that day; `subtitleAction` names what it does.
 */
export function Screen({ title, subtitle, onSubtitle, subtitleAction, nav, children }: { title: string; subtitle?: string; onSubtitle?: () => void; subtitleAction?: string; nav?: ScreenNav; children: ComponentChildren }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Fitwell`;
    // Don't steal focus on the initial load: it would skip past the skip link.
    if (firstScreen) firstScreen = false;
    else h1.current?.focus({ preventScroll: true });
  }, [title]);
  const heading = (
    <div class="screen-title">
      <h1 ref={h1} tabIndex={-1}>{title}</h1>
      {subtitle && !onSubtitle && <p class="muted">{subtitle}</p>}
      {subtitle && onSubtitle && (
        <button type="button" class="screen-date" onClick={onSubtitle} aria-label={subtitleAction ? `${subtitle}. ${subtitleAction}` : undefined}>
          <Icon name="today" size="sm" />{subtitle}
        </button>
      )}
    </div>
  );
  if (!nav) return <><header>{heading}</header><div class="page">{children}</div></>;
  return (
    <>
      <header class="daybar">
        <Button icon onClick={nav.onPrev} aria-label={nav.prevLabel}><Icon name="prev" size="lg" /></Button>
        {heading}
        <Button icon onClick={nav.onNext} aria-label={nav.nextLabel}><Icon name="next" size="lg" /></Button>
      </header>
      <div class="page">{children}</div>
    </>
  );
}
