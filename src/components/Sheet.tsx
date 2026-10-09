import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t } from '../i18n';

let counter = 0;

/** Modal bottom sheet on native <dialog>: focus trap, Escape and inert background come from the browser. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
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
      class="sheet"
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
          <button type="button" class="btn" onClick={onClose}>{t('common.close')}</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
