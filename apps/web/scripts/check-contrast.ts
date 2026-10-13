// Verifies WCAG contrast of the design tokens in both themes (NFR-8) and that the
// two dark blocks in tokens.css are identical. Run: npm run contrast
import { readFileSync } from 'node:fs';
import { colourDistance, contrastRatio, VISIONS } from '../src/domain/contrast.ts';

const css = readFileSync('src/styles/tokens.css', 'utf8');

function blockText(re: RegExp): string {
  const m = re.exec(css);
  if (!m) throw new Error(`Block not found: ${re}`);
  return m[1]!;
}
const decls = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim().toLowerCase()]));

const light = decls(blockText(/^:root \{([\s\S]*?)^\}/m));
const dark = decls(blockText(/^:root\[data-theme='dark'\] \{([\s\S]*?)^\}/m));
const darkMedia = decls(blockText(/:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)^ {2}\}/m));

// [foreground, background, minimum ratio, why]
const PAIRS: [string, string, number, string][] = [
  ['text', 'bg', 4.5, 'body text'],
  ['text', 'surface', 4.5, 'text on cards'],
  ['text', 'surface-2', 4.5, 'text on raised surface'],
  ['text-muted', 'bg', 4.5, 'secondary text'],
  ['text-muted', 'surface', 4.5, 'secondary text on cards'],
  ['text-muted', 'surface-2', 4.5, 'secondary text on raised surface'],
  ['accent', 'bg', 4.5, 'links / accent text'],
  ['accent', 'surface', 4.5, 'accent text on cards'],
  ['accent', 'accent-soft', 4.5, 'ghost button hover'],
  ['on-accent', 'accent', 4.5, 'primary button label'],
  ['on-accent', 'accent-strong', 4.5, 'primary button label (hover)'],
  ['on-accent-soft', 'accent-soft', 4.5, 'notice / badge text'],
  ['border', 'bg', 3, 'input / control boundary'],
  ['border', 'surface', 3, 'control boundary on cards'],
  ['focus', 'bg', 3, 'focus ring'],
  ['focus', 'surface', 3, 'focus ring on cards'],
  ['accent', 'bg', 3, 'active tab indicator'],
  ['danger', 'bg', 4.5, 'destructive confirmation text'],
  ['danger', 'surface', 4.5, 'destructive button on cards'],
  ['chart-axis', 'surface', 4.5, 'chart axis labels'],
  ['chart-axis', 'bg', 4.5, 'chart axis labels on page'],
  ...[1, 2, 3, 4, 5, 6].flatMap((n): [string, string, number, string][] => [
    [`chart-${n}`, 'surface', 3, `chart series ${n} on cards`],
    [`chart-${n}`, 'bg', 3, `chart series ${n} on page`],
  ]),
];

let failed = 0;
for (const [name, t] of [['light', light], ['dark', dark]] as const) {
  for (const [fg, bg, min, why] of PAIRS) {
    const f = t[fg], b = t[bg];
    if (!f?.startsWith('#') || !b?.startsWith('#')) { console.error(`✗ [${name}] missing token ${fg} or ${bg}`); failed++; continue; }
    const r = contrastRatio(f, b);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} [${name}] ${fg} on ${bg}: ${r.toFixed(2)} (min ${min}) — ${why}`);
  }
}

// Chart series must be tellable apart by sight (ΔE >= 20) and, in the worst case, with colour-vision deficiency (ΔE >= 8).
// Charts must still add markers/labels: colour never carries meaning alone.
for (const [name, t] of [['light', light], ['dark', dark]] as const) {
  for (let i = 1; i <= 6; i++) for (let j = i + 1; j <= 6; j++) {
    for (const vision of VISIONS) {
      const d = colourDistance(t[`chart-${i}`]!, t[`chart-${j}`]!, vision);
      const min = vision === 'normal' ? 20 : 8;
      if (d < min) { console.error(`✗ [${name}] chart-${i} vs chart-${j} (${vision}): ΔE ${d.toFixed(1)} < ${min}`); failed++; }
    }
  }
}

// Every themed token defined in light must exist in dark, and the two dark blocks must match exactly.
for (const k of Object.keys(light)) if (!(k in dark)) { console.error(`✗ --${k} has no dark value`); failed++; }
for (const k of new Set([...Object.keys(dark), ...Object.keys(darkMedia)])) {
  if (dark[k] !== darkMedia[k]) { console.error(`✗ dark blocks differ on --${k}: ${dark[k]} vs ${darkMedia[k]}`); failed++; }
}

if (failed) { console.error(`\n${failed} contrast/consistency problem(s).`); process.exit(1); }
console.log('\nAll token pairs pass.');
