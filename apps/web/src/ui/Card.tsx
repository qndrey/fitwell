import type { ComponentChildren } from 'preact';

/** Grouped content on a raised surface. Name it (aria-label or heading) so it is a landmark-like region. */
export function Card({
  label,
  labelledBy,
  compact,
  class: cls,
  children,
}: {
  label?: string;
  labelledBy?: string;
  compact?: boolean;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <section class={['card', compact && 'compact', cls].filter(Boolean).join(' ')} aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}
