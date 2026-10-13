import type { ComponentChildren } from 'preact';

/** A value with its label underneath (value is read first by screen readers' dl semantics). */
export function StatGrid({ items }: { items: { label: string; value: ComponentChildren }[] }) {
  return (
    <dl class="stat-grid" style={{ '--cols': items.length }}>
      {items.map((i) => (
        <div class="stat" key={i.label}>
          <dd>{i.value}</dd>
          <dt>{i.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Hero number with a unit, e.g. calories. */
export function BigNumber({ value, unit }: { value: ComponentChildren; unit?: string }) {
  return (
    <p class="t-stat">
      {value} {unit && <span class="t-unit">{unit}</span>}
    </p>
  );
}
