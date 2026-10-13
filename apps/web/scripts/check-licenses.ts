// Fails if any production dependency of the web app has a licence outside the allow-list. Run: npm run licenses
import { prodDeps } from './prod-deps.ts';

const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'OFL-1.1']);

/** SPDX expression check: "(A OR B)" needs one allowed licence, "A AND B" needs all of them. */
function allowed(expr: string): boolean {
  const ids = expr.replace(/[()]/g, ' ').split(/\s+(?:OR|AND)\s+|\s+/).filter(Boolean);
  return / AND /.test(expr) ? ids.every((id) => ALLOWED.has(id)) : ids.some((id) => ALLOWED.has(id));
}

const deps = prodDeps();
const bad = deps.filter((d) => !allowed(d.license));
for (const d of bad) console.error(`Not allowed: ${d.name}@${d.version} is licensed "${d.license}"`);
if (bad.length) process.exit(1);
console.log(`Licences OK (${deps.length} production packages).`);
