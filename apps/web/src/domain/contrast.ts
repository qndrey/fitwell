/** WCAG 2.x relative luminance and contrast ratio for #rrggbb colours. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Converts a computed `rgb(r, g, b)` string to `#rrggbb`; returns null when it has transparency or another format. */
export function rgbToHex(rgb: string): string | null {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/.exec(rgb.trim());
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

// ---- Telling colours apart (for chart series) ----
type RGB = [number, number, number];
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const rgbOf = (hex: string): RGB => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as RGB;

/** Colour-vision-deficiency simulation (Machado et al. 2009, full severity) on linear RGB. */
const CVD: Record<'protanopia' | 'deuteranopia' | 'tritanopia', number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export type Vision = 'normal' | keyof typeof CVD;
export const VISIONS: Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

function lab(rgb: RGB): RGB {
  const [r, g, b] = rgb;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Perceptual distance (CIE76 ΔE) between two colours as seen with the given vision. ≥ ~20 reads as clearly different. */
export function colourDistance(a: string, b: string, vision: Vision = 'normal'): number {
  const seen = (hex: string): RGB => {
    const c = rgbOf(hex);
    if (vision === 'normal') return c;
    const m = CVD[vision];
    return m.map((row) => Math.min(1, Math.max(0, row[0]! * c[0] + row[1]! * c[1] + row[2]! * c[2]))) as RGB;
  };
  const [p, q] = [lab(seen(a)), lab(seen(b))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
void fromLinear;
