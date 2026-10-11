import { useEffect, useRef, useState } from 'preact/hooks';
import { parseAmount } from '../../domain/nutrition';

/** A numeric input that keeps what you type ("6.", "") while you type, and only reports finite numbers. */
/** `planned`: a value carried over from last time, not done yet (shown muted). */
export function NumberCell({ value, onValue, label, placeholder, planned, readOnly }: { value: number; onValue: (n: number) => void; label: string; placeholder?: string; planned?: boolean; readOnly?: boolean }) {
  const show = (n: number) => (n ? String(n) : '');
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  return (
    <input
      class={planned ? 'input num planned' : 'input num'}
      inputMode="decimal"
      autocomplete="off"
      aria-label={label}
      readOnly={readOnly}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        (e.target as HTMLInputElement).select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(show(value));
      }}
      onInput={(e) => {
        const s = (e.target as HTMLInputElement).value;
        setText(s);
        const n = s.trim() === '' ? 0 : parseAmount(s);
        if (n !== null) onValue(n);
      }}
    />
  );
}
