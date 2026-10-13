import { useId } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './Icon';

export interface ControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: 'true';
}

/**
 * Label + control + hint + error, wired together for assistive tech.
 * Errors are calm text with an ⓘ marker (never colour alone) and say what to do.
 */
export function Field({
  label,
  hint,
  error,
  labelHidden,
  class: cls,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  labelHidden?: boolean;
  class?: string;
  children: (control: ControlProps) => ComponentChildren;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div class={['field', cls].filter(Boolean).join(' ')}>
      <label for={id} class={labelHidden ? 'sr-only' : 'field-label'}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {error ? <span id={`${id}-err`} class="field-error"><Icon name="info" size="sm" /><span>{error}</span></span> : hint ? <span id={`${id}-hint`} class="hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({ class: cls, ...rest }: Omit<JSX.IntrinsicElements['input'], 'class'> & { class?: string }) {
  // Preact 11's input typings are a per-`type` union that doesn't survive spreading; the props are checked above.
  return <input type="text" class={['input', cls].filter(Boolean).join(' ')} {...(rest as Record<string, unknown>)} />;
}

export function Select({ class: cls, children, ...rest }: Omit<JSX.IntrinsicElements['select'], 'class' | 'children'> & { class?: string; children?: ComponentChildren }) {
  return (
    <select class={['input', cls].filter(Boolean).join(' ')} {...(rest as Record<string, unknown>)}>
      {children}
    </select>
  );
}
