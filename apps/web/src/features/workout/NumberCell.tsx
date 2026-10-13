import { useEffect, useRef, useState } from 'preact/hooks';
import { parseAmount } from '../../domain/nutrition';

/** A numeric input that keeps what you type ("6.", "") while you type, and only reports finite numbers. */
export function NumberCell({ value, onValue, label, placeholder, integer }: { value: number; onValue: (n: number) => void; label: string; placeholder?: string; integer?: boolean }) {
  const show = (n: number) => (n ? String(n) : '');
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  return (
    <input
      class="input num"
      inputMode={integer ? 'numeric' : 'decimal'}
      autocomplete="off"
      aria-label={label}
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
        if (n !== null) onValue(integer ? Math.round(n) : n);
      }}
    />
  );
}
