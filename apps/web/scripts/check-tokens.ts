// Design-system lint: components may only use design tokens. Run: npm run tokens
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STYLE_DIR = 'src/styles';
const TOKEN_FILES = ['tokens.css', 'scale.css'];
const COMPONENT_FILES = readdirSync(STYLE_DIR).filter((f) => f.endsWith('.css') && !TOKEN_FILES.includes(f));
const LOCAL_PROPS = new Set(['gap', 'cols', 'p']); // set per element via utilities / inline style
// Rules allowed to use literal lengths (visually-hidden helper, off-screen skip link).
const LITERAL_OK = ['.sr-only'];
// The only places the danger colour may appear: destructive buttons, menu items and text links.
const DANGER_OK = ['.btn.danger', '.menu-item.danger', '.link-btn.danger'];
const LENGTH_PROPS = /^(font-size|margin(-\w+)*|padding(-\w+)*|gap|row-gap|column-gap|border-radius|letter-spacing|line-height)$/;

const errors: string[] = [];
const err = (file: string, line: number, msg: string) => errors.push(`${file}:${line}  ${msg}`);

const defined = new Set<string>();
for (const f of TOKEN_FILES) for (const m of readFileSync(join(STYLE_DIR, f), 'utf8').matchAll(/--([\w-]+)\s*:/g)) defined.add(m[1]!);
for (const p of LOCAL_PROPS) defined.add(p);

for (const file of COMPONENT_FILES) {
  const path = join(STYLE_DIR, file);
  let selector = '';
  readFileSync(path, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.replace(/\/\*.*?\*\//g, '');
    const sel = /^\s*([^{}]+)\{/.exec(line);
    if (sel && !line.trim().startsWith('@')) selector = sel[1]!.trim();
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) err(path, i + 1, 'raw hex colour: use a colour token');
    if (/\b(rgb|rgba|hsl|hsla)\(/.test(line)) err(path, i + 1, 'raw colour function: use a colour token');
    if (/var\(--danger\)/.test(line) && !DANGER_OK.includes(selector)) err(path, i + 1, `--danger is only for destructive actions (${DANGER_OK.join(', ')})`);
    if (!LITERAL_OK.some((s) => selector.startsWith(s))) {
      // declarations on this line (also handles several per line)
      for (const d of line.replace(/^[^{]*\{/, '').split(';')) {
        const m = /^\s*([\w-]+)\s*:\s*(.+?)\s*\}?\s*$/.exec(d);
        if (!m || !LENGTH_PROPS.test(m[1]!)) continue;
        const withoutVars = m[2]!.replace(/var\([^)]*\)/g, '').replace(/env\([^)]*\)/g, '');
        if (/-?\d*\.?\d+(px|rem|em)\b/.test(withoutVars)) err(path, i + 1, `literal length in "${m[1]}: ${m[2]}": use a spacing/type/radius token`);
      }
    }
  });
}

// Every var(--x) in styles and components resolves to a token.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
for (const f of walk('src').filter((p) => /\.(css|tsx?)$/.test(p))) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/var\(--([\w-]+)/g)) {
      const name = m[1]!;
      // Dynamic names like var(--space-${n}) end in "-": require the prefix to match at least one token.
      const ok = name.endsWith('-') ? [...defined].some((d) => d.startsWith(name)) : defined.has(name);
      if (!ok) err(f, i + 1, `unknown token --${name}`);
    }
    if (/\.tsx$/.test(f) && /#[0-9a-fA-F]{6}\b/.test(line)) err(f, i + 1, 'raw hex colour in a component');
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} design-token violation(s).`);
  process.exit(1);
}
console.log(`Design tokens OK (${COMPONENT_FILES.length} stylesheets, ${defined.size} tokens).`);
