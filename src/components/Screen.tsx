import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** Screen wrapper: moves focus to the heading on navigation for screen-reader users. */
export function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ComponentChildren }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Fitwell`;
    h1.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>{title}</h1>
      {subtitle && <p class="muted">{subtitle}</p>}
      {children}
    </>
  );
}
