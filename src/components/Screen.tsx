import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

let firstScreen = true;

/** Screen wrapper: moves focus to the heading on navigation for screen-reader users. */
export function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ComponentChildren }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Fitwell`;
    // Don't steal focus on the initial load: it would skip past the skip link.
    if (firstScreen) firstScreen = false;
    else h1.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>{title}</h1>
      {subtitle && <p class="muted">{subtitle}</p>}
      {children}
    </>
  );
}
