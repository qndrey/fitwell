import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

/**
 * Calm inline message. Use role="alert" only for things the user must react to (e.g. a failed import).
 * `attention` (amber, with an icon) is for something waiting on the user: items to confirm, a backup due.
 */
export function Notice({ quiet, attention, role, children }: { quiet?: boolean; attention?: boolean; role?: 'status' | 'alert'; children: ComponentChildren }) {
  if (attention) {
    return (
      <div class="notice attention" role={role}>
        <Icon name="alert" />
        <div class="notice-body">{children}</div>
      </div>
    );
  }
  return (
    <div class={quiet ? 'notice quiet' : 'notice'} role={role}>
      {children}
    </div>
  );
}

/** Small status pill. `neutral` for passive facts (Last time, Superset), `attention` for something waiting on the user. Text always carries the meaning. */
export function Badge({ tone, children }: { tone?: 'neutral' | 'attention'; children: ComponentChildren }) {
  return <span class={tone ? `badge ${tone}` : 'badge'}>{children}</span>;
}

export function EmptyState({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}
