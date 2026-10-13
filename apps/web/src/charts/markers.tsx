import type { JSX } from 'preact';

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'plus' | 'none';
export const MARKERS: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus'];

/** Shape for a point: series are told apart by shape as well as colour. `r` is the half-size. */
export function Marker({ shape, x, y, color, r = 4 }: { shape: MarkerShape; x: number; y: number; color: string; r?: number }): JSX.Element | null {
  const fill = `var(${color})`;
  switch (shape) {
    case 'circle': return <circle cx={x} cy={y} r={r} fill={fill} />;
    case 'square': return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} />;
    case 'triangle': return <path d={`M${x} ${y - r - 1} L${x + r + 1} ${y + r} L${x - r - 1} ${y + r} Z`} fill={fill} />;
    case 'diamond': return <path d={`M${x} ${y - r - 1} L${x + r + 1} ${y} L${x} ${y + r + 1} L${x - r - 1} ${y} Z`} fill={fill} />;
    case 'cross': return <path d={`M${x - r} ${y - r} L${x + r} ${y + r} M${x + r} ${y - r} L${x - r} ${y + r}`} stroke={fill} stroke-width="2.2" fill="none" />;
    case 'plus': return <path d={`M${x - r - 1} ${y} L${x + r + 1} ${y} M${x} ${y - r - 1} L${x} ${y + r + 1}`} stroke={fill} stroke-width="2.2" fill="none" />;
    default: return null;
  }
}
