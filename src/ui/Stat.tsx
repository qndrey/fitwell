import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** A value with its label underneath (value is read first by screen readers' dl semantics). `meter` adds a thin bar (0–1) and `note` a caption, e.g. against a goal. */
export function StatGrid({ items }: { items: { label: string; value: ComponentChildren; meter?: number; note?: string; tone?: 1 | 2 | 3 | 4 }[] }) {
  return (
    <dl class="stat-grid" style={{ '--cols': items.length }}>
      {items.map((i) => (
        <div class="stat" key={i.label}>
          <dd>{i.value}</dd>
          <dt>{i.label}</dt>
          {(i.meter !== undefined || i.note) && (
            <dd class="stat-extra">
              {i.meter !== undefined && <Meter value={i.meter} tone={i.tone} />}
              {i.note && <span class="t-caption">{i.note}</span>}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Thin progress bar, 0–1 (capped at full). Decorative: the number next to it carries the meaning. */
export function Meter({ value, tone = 1 }: { value: number; tone?: 1 | 2 | 3 | 4 }) {
  const p = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span class="meter" aria-hidden="true">
      <span class={`meter-fill tone-${tone}`} style={{ '--p': String(p) }} />
    </span>
  );
}

/** Tiny trend line for a handful of values, oldest first. Decorative: pair it with a text summary. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 32;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - lo) / span) * (h - 6)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg class="sparkline" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <polyline points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.5" />
    </svg>
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

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that glides to its new value (about a third of a second) instead of jumping; instant under reduced motion. */
export function useCountUp(target: number, ms = 350): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (calm() || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      setShown(a + (target - a) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target]);
  return shown;
}
