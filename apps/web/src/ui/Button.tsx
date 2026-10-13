import type { ComponentChildren, JSX } from 'preact';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'lg';

type ButtonAttrs = Omit<JSX.IntrinsicElements['button'], 'size' | 'type' | 'children' | 'class' | 'className'>;

export interface ButtonProps extends ButtonAttrs {
  /** primary: the one main action on a screen; secondary: default; ghost: low emphasis; danger: destructive confirmations only. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Square, icon-sized. Always pass an aria-label. */
  icon?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
  children?: ComponentChildren;
  class?: string;
}

export function Button({ variant = 'secondary', size = 'md', block, icon, type = 'button', class: cls, children, ...rest }: ButtonProps) {
  const classes = ['btn', variant !== 'secondary' && variant, size !== 'md' && size, block && 'block', icon && 'icon', cls].filter(Boolean).join(' ');
  return (
    <button type={type} class={classes} {...rest}>
      {children}
    </button>
  );
}

/** Text-style action, e.g. "Save as meal". Same 44 px target as a button. */
export function LinkButton({ class: cls, children, ...rest }: ButtonAttrs & { class?: string; children?: ComponentChildren }) {
  return (
    <button type="button" class={['link-btn', cls].filter(Boolean).join(' ')} {...rest}>
      {children}
    </button>
  );
}
