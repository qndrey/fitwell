import { useRef, useState } from 'preact/hooks';
import { dayFromNumber } from '../domain/dates';
import { linear, niceDomain, niceTicks, spreadTicks } from './scale';
import { Marker, type MarkerShape } from './markers';

export interface LineSeries {
  id: string;
  label: string;
  /** CSS custom property holding the colour, e.g. "--chart-1". */
  color: string;
  marker: MarkerShape;
  /** x = day number (see dayNumber). */
  points: { x: number; y: number }[];
  /** Draw as light dots only (raw readings behind a smoothed line). */
  faint?: boolean;
  /** Draw markers on every point of the line. */
  markers?: boolean;
}

export interface Rule {
  y: number;
  label: string;
}

const W = 300;
const H = 170;
const M = { l: 38, r: 10, t: 10, b: 24 };

/**
 * Lines over time. Series differ by colour *and* marker shape. Tap, drag or use ←/→ to read exact values
 * (also announced to screen readers); the same numbers are available as a table under the chart.
 */
export function LineChart({
  series,
  xFrom,
  xTo,
  yDomain,
  rule,
  yFormat = (v) => String(v),
  xLabel,
  readout,
  label,
  includeZero,
}: {
  series: LineSeries[];
  xFrom: number;
  xTo: number;
  yDomain?: [number, number];
  rule?: Rule;
  yFormat?: (v: number) => string;
  xLabel: (x: number) => string;
  /** Text for a scrubbed day: receives the x and the nearest point of each series. */
  readout: (x: number, nearest: { series: LineSeries; point: { x: number; y: number } }[]) => string;
  label: string;
  includeZero?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points.map((p) => p.y)).concat(rule ? [rule.y] : []);
  const domain = yDomain ?? niceDomain(Math.min(...all), Math.max(...all), { includeZero });
  const x = linear([xFrom, Math.max(xTo, xFrom + 1)], [M.l, W - M.r]);
  const y = linear(domain, [H - M.b, M.t]);
  const yTicks = niceTicks(domain[0], domain[1], 4);
  // Four date labels fit a phone-width chart without the last two touching ("Sep 19Oct 11").
  const xTicks = spreadTicks(xFrom, xTo, 4);
  const line = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ');

  // The x values that can be scrubbed to: every day that has a reading in the primary (first non-faint) series.
  const primary = series.find((s) => !s.faint) ?? series[0];
  const stops = (primary?.points ?? []).map((p) => p.x);
  const nearestStop = (target: number) => stops.reduce<number | null>((best, s) => (best === null || Math.abs(s - target) < Math.abs(best - target) ? s : best), null);
  const nearestOf = (s: LineSeries, at: number) => s.points.reduce<{ x: number; y: number } | null>((b, p) => (b === null || Math.abs(p.x - at) < Math.abs(b.x - at) ? p : b), null);
  const atCursor = cursor === null ? [] : series.flatMap((s) => { const p = nearestOf(s, cursor); return p && Math.abs(p.x - cursor) <= 3 ? [{ series: s, point: p }] : []; });

  const scrub = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    setCursor(nearestStop(xFrom + ((vx - M.l) / (W - M.l - M.r)) * (xTo - xFrom)));
  };
  const step = (dir: -1 | 1) => {
    const i = cursor === null ? (dir === 1 ? -1 : stops.length) : stops.indexOf(cursor);
    const next = stops[Math.min(stops.length - 1, Math.max(0, i + dir))];
    if (next !== undefined) setCursor(next);
  };

  return (
    <div class="chart">
      <svg
        ref={svg}
        class="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        tabindex={0}
        onPointerDown={(e) => scrub(e.clientX)}
        onPointerMove={(e) => e.buttons === 1 && scrub(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            step(-1);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            step(1);
          }
          else if (e.key === 'Escape') setCursor(null);
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} class="chart-grid" />
            <text x={M.l - 5} y={y(v)} class="chart-text" text-anchor="end" dominant-baseline="middle">{yFormat(v)}</text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text key={v} x={x(v)} y={H - 6} class="chart-text" text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{xLabel(v)}</text>
        ))}
        {rule && (
          <g>
            <line x1={M.l} x2={W - M.r} y1={y(rule.y)} y2={y(rule.y)} class="chart-rule" />
            <text x={W - M.r} y={y(rule.y) - 4} class="chart-text" text-anchor="end">{rule.label}</text>
          </g>
        )}
        {series.map((s) =>
          s.faint ? (
            <g key={s.id} opacity="0.55">{s.points.map((p) => <Marker key={p.x} shape={s.marker} x={x(p.x)} y={y(p.y)} color={s.color} r={2.2} />)}</g>
          ) : (
            <g key={s.id}>
              <path d={line(s.points)} fill="none" stroke={`var(${s.color})`} stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
              {(s.markers ?? s.points.length <= 40) && s.points.map((p) => <Marker key={p.x} shape={s.marker} x={x(p.x)} y={y(p.y)} color={s.color} />)}
            </g>
          ),
        )}
        {cursor !== null && (
          <g>
            <line x1={x(cursor)} x2={x(cursor)} y1={M.t} y2={H - M.b} class="chart-cursor" />
            {atCursor.map((a) => <Marker key={a.series.id} shape={a.series.marker === 'none' ? 'circle' : a.series.marker} x={x(a.point.x)} y={y(a.point.y)} color={a.series.color} r={5.5} />)}
          </g>
        )}
      </svg>
      <p class="t-caption chart-readout" aria-live="polite">
        {cursor === null ? xLabel(xTo) === '' ? '' : ' ' : readout(cursor, atCursor)}
      </p>
      <ul class="legend" aria-label="Legend">
        {series.map((s) => (
          <li key={s.id}>
            <svg width="16" height="14" viewBox="-8 -7 16 14" aria-hidden="true">
              {s.faint ? <Marker shape={s.marker} x={0} y={0} color={s.color} r={2.6} /> : <><path d="M-8 0 H8" stroke={`var(${s.color})`} stroke-width="2.4" /><Marker shape={s.marker} x={0} y={0} color={s.color} r={3} /></>}
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Building an Intl.DateTimeFormat is slow (hundreds of microseconds): create each distinct one once.
const formatters = new Map<string, Intl.DateTimeFormat>();
export const shortDay = (n: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string => {
  const key = JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(undefined, opts)));
  const d = dayFromNumber(n);
  return f.format(new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
};
