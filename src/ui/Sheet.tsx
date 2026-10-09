import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t } from '../i18n';
import { Button } from './Button';
import { Icon } from './Icon';

let counter = 0;

/**
 * Modal bottom sheet on native <dialog>: focus trap, Escape and inert background come from the browser.
 * `pinned` stays fixed under the title (e.g. a search field); the rest scrolls. `tall` keeps the height
 * stable so results appearing never make the sheet jump (important with the on-screen keyboard open).
 */
export function Sheet({
  title,
  onClose,
  pinned,
  tall,
  children,
}: {
  title: string;
  onClose: () => void;
  pinned?: ComponentChildren;
  tall?: boolean;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useRef(`sheet-${++counter}`);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
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
        <div class="sheet-head">
          <h2 id={id.current}>{title}</h2>
          <Button size="sm" onClick={onClose}><Icon name="close" size="sm" />{t('common.close')}</Button>
        </div>
        {pinned && <div class="sheet-pinned">{pinned}</div>}
        <div class="sheet-scroll">{children}</div>
      </div>
    </dialog>
  );
}
