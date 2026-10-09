import type { ComponentChildren } from 'preact';

/** Calm inline message. Use role="alert" only for things the user must react to (e.g. a failed import). */
export function Notice({ quiet, role, children }: { quiet?: boolean; role?: 'status' | 'alert'; children: ComponentChildren }) {
  return (
    <div class={quiet ? 'notice quiet' : 'notice'} role={role}>
      {children}
    </div>
  );
}

/** Small status pill, e.g. "pending". Text always carries the meaning. */
export function Badge({ children }: { children: ComponentChildren }) {
  return <span class="badge">{children}</span>;
}

export function EmptyState({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}
