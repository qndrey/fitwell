import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** Destructive: shown in the danger colour. */
  danger?: boolean;
}

/**
 * A small pop-up list of actions under a button (⋯ by default). Arrow keys move, Escape or a tap elsewhere closes,
 * and focus goes back to the button.
 */
export function Menu({ label, items, children, buttonClass }: { label: string; items: MenuItem[]; children?: ComponentChildren; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const list = wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    list?.[0]?.focus();
    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) btn.current?.focus();
    };
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && close(false);
    const onKey = (e: KeyboardEvent) => {
      const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (e.key === 'Tab') {
        close(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span class="menu" ref={wrap}>
      <button ref={btn} type="button" class={buttonClass ?? 'btn icon'} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {children ?? <Icon name="more" />}
      </button>
      {open && (
        <div class="menu-list" role="menu" aria-label={label}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              class={it.danger ? 'menu-item danger' : 'menu-item'}
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size="sm" />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
