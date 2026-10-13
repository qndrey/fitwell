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
  /** A calendar button between the arrows that opens the browser's date picker. */
  pick?: { label: string; value: string; onPick: (day: string) => void };
}

/**
 * Screen wrapper: moves focus to the heading on navigation for screen-reader users.
 * `onSubtitle` makes the subtitle (a date) a button, e.g. to jump back to that day; `subtitleAction` names what it does.
 * `back` adds a back arrow before the title, for pages you open from somewhere else (a workout, Review, AI, About).
 */
export function Screen({ title, subtitle, onSubtitle, subtitleAction, nav, back, children }: { title: string; subtitle?: string; onSubtitle?: () => void; subtitleAction?: string; nav?: ScreenNav; back?: { label: string; onBack: () => void }; children: ComponentChildren }) {
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
  if (back) {
    return (
      <>
        <header class="topbar">
          <Button icon onClick={back.onBack} aria-label={back.label}><Icon name="back" /></Button>
          {heading}
        </header>
        <div class="page">{children}</div>
      </>
    );
  }
  if (!nav) return <><header>{heading}</header><div class="page">{children}</div></>;
  return (
    <>
      <header class="daybar">
        {heading}
        <div class="daybar-nav">
          <Button icon onClick={nav.onPrev} aria-label={nav.prevLabel}><Icon name="prev" /></Button>
          {nav.pick && <DayPicker {...nav.pick} />}
          <Button icon onClick={nav.onNext} aria-label={nav.nextLabel}><Icon name="next" /></Button>
        </div>
      </header>
      <div class="page">{children}</div>
    </>
  );
}

/** Calendar button that opens the native date picker; where the browser has none it opens the History calendar. */
function DayPicker({ label, value, onPick }: NonNullable<ScreenNav['pick']>) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span class="day-picker">
      <Button
        icon
        aria-label={label}
        onClick={() => {
          const el = input.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            location.hash = '#/history'; // no picker in this browser: the History calendar does the same job
          }
        }}
      >
        <Icon name="pickDay" />
      </Button>
      <input ref={input} class="day-picker-input" type="date" tabIndex={-1} aria-hidden="true" value={value} onChange={(e) => (e.target as HTMLInputElement).value && onPick((e.target as HTMLInputElement).value)} />
    </span>
  );
}
