// Verifies WCAG contrast of token pairs in both themes (NFR-8) and that the
// two dark blocks in tokens.css are identical. Run: npm run contrast
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/tokens.css', 'utf8');

function block(re: RegExp): Record<string, string> {
  const m = re.exec(css);
  if (!m) throw new Error(`Block not found: ${re}`);
  return Object.fromEntries([...m[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((x) => [x[1]!, x[2]!.toLowerCase()]));
}

const light = block(/^:root \{([\s\S]*?)^\}/m);
const dark = block(/^:root\[data-theme='dark'\] \{([\s\S]*?)^\}/m);
const darkMedia = block(/:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)^ {2}\}/m);

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

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
  ['on-accent', 'accent', 4.5, 'primary button label'],
  ['on-accent-soft', 'accent-soft', 4.5, 'notice text'],
  ['border', 'bg', 3, 'input / control boundary'],
  ['border', 'surface', 3, 'control boundary on cards'],
  ['focus', 'bg', 3, 'focus ring'],
  ['focus', 'surface', 3, 'focus ring on cards'],
  ['accent', 'bg', 3, 'active tab indicator'],
  ['danger', 'bg', 4.5, 'destructive confirmation text'],
];

let failed = 0;
for (const [name, t] of [['light', light], ['dark', dark]] as const) {
  for (const [fg, bg, min, why] of PAIRS) {
    const f = t[fg], b = t[bg];
    if (!f || !b) { console.error(`✗ [${name}] missing token ${fg} or ${bg}`); failed++; continue; }
    const r = ratio(f, b);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} [${name}] ${fg} on ${bg}: ${r.toFixed(2)} (min ${min}) — ${why}`);
  }
}

const keys = new Set([...Object.keys(dark), ...Object.keys(darkMedia)]);
for (const k of keys) {
  if (dark[k] !== darkMedia[k]) {
    console.error(`✗ dark blocks differ on --${k}: ${dark[k]} vs ${darkMedia[k]}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} contrast/consistency problem(s).`);
  process.exit(1);
}
console.log('\nAll token pairs pass.');
