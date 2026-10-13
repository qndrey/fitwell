import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t } from '../i18n';
import { Button } from './Button';
import { Icon } from './Icon';
import { sheetStack } from './sheetStack';
import { ToastView } from './Toaster';

let counter = 0;

/**
 * Modal bottom sheet on native <dialog>: focus trap, Escape and inert background come from the browser.
 * `pinned` stays fixed under the title (e.g. a search field); the rest scrolls. `tall` keeps the height
 * stable so results appearing never make the sheet jump (important with the on-screen keyboard open).
 */
/** The last button or link pressed and when, kept weakly so a removed control can be collected. */
let lastPressed: { el: WeakRef<HTMLElement>; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('button, a, summary') : null;
      if (el) lastPressed = { el: new WeakRef(el), at: Date.now() };
    },
    true,
  );
}

/** What had focus when a sheet opened. Safari focuses the page area, not the button you clicked, so a control pressed a moment ago wins. */
function openerFor(active: Element | null): HTMLElement | null {
  const pressed = lastPressed && Date.now() - lastPressed.at < 1500 ? lastPressed.el.deref() : undefined;
  if (pressed?.isConnected) return pressed;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

export function Sheet({
  title,
  subtitle,
  onClose,
  pinned,
  tall,
  children,
}: {
  title: string;
  /** One quiet line under the title, e.g. a food's description. */
  subtitle?: string;
  onClose: () => void;
  pinned?: ComponentChildren;
  tall?: boolean;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useRef(`sheet-${++counter}`);
  const num = useRef(counter);
  useEffect(() => {
    const d = ref.current;
    // Remember what had focus so it can go back there: the sheet is removed from the page, which loses the browser's own restore.
    const opener = openerFor(document.activeElement);
    if (d && !d.open) d.showModal();
    sheetStack.value = [...sheetStack.value, num.current];
    return () => {
      sheetStack.value = sheetStack.value.filter((n) => n !== num.current);
      if (d?.open) d.close();
      requestAnimationFrame(() => {
        if (opener?.isConnected && !document.querySelector('dialog[open]')) opener.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class={tall ? 'sheet tall' : 'sheet'}
      aria-labelledby={id.current}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="sheet-body">
        <span class="sheet-grab" aria-hidden="true" />
        <div class="sheet-head">
          <h2 id={id.current}>{title}</h2>
          <Button icon onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></Button>
        </div>
        {subtitle && <p class="sheet-sub">{subtitle}</p>}
        {pinned && <div class="sheet-pinned">{pinned}</div>}
        <div class="sheet-scroll">{children}</div>
        {sheetStack.value[sheetStack.value.length - 1] === num.current && (
          <div class="toast-region stack gap-2" role="status" aria-live="polite">
            <ToastView />
          </div>
        )}
      </div>
    </dialog>
  );
}
