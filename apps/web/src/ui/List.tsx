import type { ComponentChildren } from 'preact';

export function List({ children, class: cls }: { children: ComponentChildren; class?: string }) {
  return <ul class={['list', cls].filter(Boolean).join(' ')}>{children}</ul>;
}

/** A row: bold main line, muted sub line. Tappable when `onClick` is given, otherwise static. `action` adds a button at the end (e.g. quick add). */
export function ListRow({ main, sub, onClick, lead, action }: { main: ComponentChildren; sub?: ComponentChildren; onClick?: () => void; lead?: ComponentChildren; action?: ComponentChildren }) {
  const text = (
    <>
      <span class="row-main">{main}</span>
      {sub ? <span class="row-sub">{sub}</span> : null}
    </>
  );
  const inner = lead ? (
    <>
      <span class="row-lead" aria-hidden="true">{lead}</span>
      <span class="row-text">{text}</span>
    </>
  ) : (
    text
  );
  const cls = lead ? 'row has-lead' : 'row';
  if (action && onClick) {
    return (
      <li class="row-split">
        <button type="button" class={cls} onClick={onClick}>{inner}</button>
        {action}
      </li>
    );
  }
  return onClick ? (
    <li>
      <button type="button" class={cls} onClick={onClick}>{inner}</button>
    </li>
  ) : (
    <li class={`${cls} static`}>{inner}</li>
  );
}

/** Small uppercase heading above a list or group. */
export function SectionTitle({ children }: { children: ComponentChildren }) {
  return <h3 class="t-overline section-title">{children}</h3>;
}
