export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** One row of equal radio segments (meal selector, theme, range). Keep to 2–5 short options. */
export function Segmented<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset class="segmented" style={{ '--cols': options.length }}>
      <legend class="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} class="segment">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
