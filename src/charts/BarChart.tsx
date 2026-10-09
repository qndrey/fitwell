import { useState } from 'preact/hooks';
import { linear, niceDomain, niceTicks } from './scale';

export interface BarPart {
  id: string;
  label: string;
  color: string;
  /** Hatched fill, so stacked parts are not told apart by colour alone. */
  hatch?: boolean;
}

export interface BarGroup {
  key: string;
  /** Axis label for this group. */
  label: string;
  values: Record<string, number>;
}

export interface BarLine {
  label: string;
  color: string;
  /** One value per group index; undefined = no line there. */
  values: (number | undefined)[];
}

const W = 300;
const H = 170;
const M = { l: 38, r: 10, t: 10, b: 24 };

/** Bars per day/week (stacked when there are several parts), optional line overlay and rule. Tap or ←/→ for exact values. */
export function BarChart({
  groups,
  parts,
  line,
  rule,
  yFormat = (v) => String(v),
  readout,
  label,
}: {
  groups: BarGroup[];
  parts: BarPart[];
  line?: BarLine;
  rule?: { y: number; label: string };
  yFormat?: (v: number) => string;
  readout: (g: BarGroup, i: number) => string;
  label: string;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const totals = groups.map((g) => parts.reduce((s, p) => s + (g.values[p.id] ?? 0), 0));
  const max = Math.max(1, ...totals, ...(line?.values.filter((v): v is number => v !== undefined) ?? []), rule?.y ?? 0);
  const domain = niceDomain(0, max, { includeZero: true, pad: 0.05 });
  const y = linear(domain, [H - M.b, M.t]);
  const n = Math.max(1, groups.length);
  const slot = (W - M.l - M.r) / n;
  const bw = Math.max(1.5, Math.min(22, slot * 0.72));
  const cx = (i: number) => M.l + slot * (i + 0.5);
  const yTicks = niceTicks(domain[0], domain[1], 4);
  const labelIdx = n <= 6 ? groups.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1];
  const pick = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    setCursor(Math.max(0, Math.min(n - 1, Math.floor((vx - M.l) / slot))));
  };
  const lineD = line
    ? line.values
        .map((v, i) => (v === undefined ? null : `${cx(i).toFixed(1)} ${y(v).toFixed(1)}`))
        .reduce<string[]>((acc, p, i, arr) => (p === null ? acc : [...acc, `${i === 0 || arr[i - 1] === null ? 'M' : 'L'}${p}`]), [])
        .join(' ')
    : '';

  return (
    <div class="chart">
      <svg
        class="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        tabindex={0}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerMove={(e) => e.buttons === 1 && pick(e.clientX, e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setCursor((c) => Math.max(0, (c ?? n) - 1));
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setCursor((c) => Math.min(n - 1, (c ?? -1) + 1));
          }
          else if (e.key === 'Escape') setCursor(null);
        }}
      >
        <defs>
          {parts.filter((p) => p.hatch).map((p) => (
            <pattern key={p.id} id={`hatch-${p.id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill={`var(${p.color})`} opacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="5" stroke={`var(${p.color})`} stroke-width="2.4" />
            </pattern>
          ))}
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} class="chart-grid" />
            <text x={M.l - 5} y={y(v)} class="chart-text" text-anchor="end" dominant-baseline="middle">{yFormat(v)}</text>
          </g>
        ))}
        {labelIdx.map((i, k) => (
          <text key={i} x={cx(i)} y={H - 6} class="chart-text" text-anchor={k === 0 && n > 6 ? 'start' : k === labelIdx.length - 1 && n > 6 ? 'end' : 'middle'}>{groups[i]?.label}</text>
        ))}
        {groups.map((g, i) => {
          let acc = 0;
          return (
            <g key={g.key} opacity={cursor === null || cursor === i ? 1 : 0.55}>
              {parts.map((p) => {
                const v = g.values[p.id] ?? 0;
                if (v <= 0) return null;
                const top = y(acc + v);
                const bottom = y(acc);
                acc += v;
                return <rect key={p.id} x={cx(i) - bw / 2} y={top} width={bw} height={Math.max(0.5, bottom - top)} fill={p.hatch ? `url(#hatch-${p.id})` : `var(${p.color})`} stroke={p.hatch ? `var(${p.color})` : 'none'} stroke-width="0.8" rx="1" />;
              })}
            </g>
          );
        })}
        {rule && (
          <g>
            <line x1={M.l} x2={W - M.r} y1={y(rule.y)} y2={y(rule.y)} class="chart-rule" />
            <text x={W - M.r} y={y(rule.y) - 4} class="chart-text" text-anchor="end">{rule.label}</text>
          </g>
        )}
        {line && lineD && <path d={lineD} fill="none" stroke={`var(${line.color})`} stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />}
        {cursor !== null && <line x1={cx(cursor)} x2={cx(cursor)} y1={M.t} y2={H - M.b} class="chart-cursor" />}
      </svg>
      <p class="t-caption chart-readout" aria-live="polite">{cursor === null ? ' ' : readout(groups[cursor]!, cursor)}</p>
      <ul class="legend" aria-label="Legend">
        {parts.map((p) => (
          <li key={p.id}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <defs>
                <pattern id={`lg-${p.id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill={`var(${p.color})`} opacity="0.25" />
                  <line x1="0" y1="0" x2="0" y2="5" stroke={`var(${p.color})`} stroke-width="2.4" />
                </pattern>
              </defs>
              <rect width="14" height="14" rx="2" fill={p.hatch ? `url(#lg-${p.id})` : `var(${p.color})`} stroke={`var(${p.color})`} />
            </svg>
            {p.label}
          </li>
        ))}
        {line && (
          <li>
            <svg width="16" height="14" viewBox="-8 -7 16 14" aria-hidden="true"><path d="M-8 0 H8" stroke={`var(${line.color})`} stroke-width="2.4" /></svg>
            {line.label}
          </li>
        )}
      </ul>
    </div>
  );
}
