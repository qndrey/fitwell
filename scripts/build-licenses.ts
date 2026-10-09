// Collects the licence text of every third-party package that ships inside the app, for the About screen.
// Output: src/about/generated/licenses.json. Run: npm run build:licenses   (CI runs it with --check)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Runtime libraries that end up in the bundle or are served with it. Build/test tools are not listed. */
const SHIPPED = ['preact', '@preact/signals', '@preact/signals-core', 'idb', 'valibot', 'lucide-preact', 'barcode-detector', 'zxing-wasm', '@fontsource-variable/figtree'];

const raw = execFileSync('npx', ['license-checker-rseidelsohn', '--production', '--json', '--excludePrivatePackages'], { encoding: 'utf8', maxBuffer: 50_000_000 });
const all = JSON.parse(raw) as Record<string, { licenses: string; repository?: string; licenseFile?: string }>;

const entries = SHIPPED.map((name) => {
  const key = Object.keys(all).find((k) => k.slice(0, k.lastIndexOf('@')) === name);
  if (!key) throw new Error(`Shipped package not found in dependency tree: ${name}`);
  const info = all[key]!;
  if (!info.licenseFile || !existsSync(info.licenseFile)) throw new Error(`No licence file for ${key}`);
  return {
    name,
    version: key.slice(key.lastIndexOf('@') + 1),
    license: info.licenses,
    url: (info.repository ?? '').replace(/^git\+/, '').replace(/\.git$/, ''),
    text: readFileSync(info.licenseFile, 'utf8').replace(/\r\n/g, '\n').trim(),
  };
});

// ZXing-C++ is compiled into the barcode reader (.wasm); it is Apache-2.0. The standard text ships with TypeScript.
const tsLicense = readFileSync('node_modules/typescript/LICENSE.txt', 'utf8').replace(/\r\n/g, '\n');
const apache = tsLicense.slice(tsLicense.indexOf('Apache License')).split('\nEND OF TERMS AND CONDITIONS')[0] + '\nEND OF TERMS AND CONDITIONS';

const out = JSON.stringify({ packages: entries.sort((a, b) => a.name.localeCompare(b.name)), apache2: apache.trim() }, null, 1) + '\n';
const target = 'src/about/generated/licenses.json';
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
    console.error('src/about/generated/licenses.json is out of date. Run: npm run build:licenses');
    process.exit(1);
  }
  console.log(`About licences up to date (${entries.length} packages).`);
} else {
  writeFileSync(target, out);
  console.log(`Wrote ${entries.length} package licences to ${target}`);
}
