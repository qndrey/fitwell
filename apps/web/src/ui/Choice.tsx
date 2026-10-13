import type { ComponentChildren } from 'preact';

/** Radio or checkbox row with a 44 px target; `help` is secondary text under the label. */
export function Choice({
  type,
  name,
  checked,
  onChange,
  label,
  help,
}: {
  type: 'radio' | 'checkbox';
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ComponentChildren;
  help?: string;
}) {
  return (
    <label class="choice">
      <input type={type as 'checkbox'} name={name} checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>
        {label}
        {help && <span class="choice-help">{help}</span>}
      </span>
    </label>
  );
}

export function Fieldset({ legend, children, class: cls }: { legend: string; children: ComponentChildren; class?: string }) {
  return (
    <fieldset class={cls}>
      <legend class="fieldset-legend">{legend}</legend>
      {children}
    </fieldset>
  );
}
