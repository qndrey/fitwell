// Builds the ZIP for OpenAI's plugin portal: npm run package:openai -w @fitwell/mcp
// Writes .wrangler/openai/fitwell-plugin.zip with plugin.json, mcp.json and assets/ at the root of the archive.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ASSET_SOURCES, assetInPackage, demoRecordingMissing, PLUGIN_DIR, validatePlugin } from './openai-plugin.ts';

const read = (f: string) => JSON.parse(readFileSync(join(PLUGIN_DIR, f), 'utf8')) as unknown;
const errors = validatePlugin(read('plugin.json'), read('mcp.json'), assetInPackage);
if (errors.length) {
  console.error(`Not ready:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

const out = join(import.meta.dirname, '..', '.wrangler', 'openai');
const stage = join(out, 'stage');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(stage, 'assets'), { recursive: true });
for (const f of ['plugin.json', 'mcp.json']) copyFileSync(join(PLUGIN_DIR, f), join(stage, f));
for (const [path, source] of Object.entries(ASSET_SOURCES)) {
  if (statSync(source).size > 5 * 1024 * 1024) throw new Error(`${path} is over 5 MiB`);
  mkdirSync(dirname(join(stage, path)), { recursive: true });
  copyFileSync(source, join(stage, path));
}
const zip = join(out, 'fitwell-plugin.zip');
execFileSync('zip', ['-r', '-X', zip, '.'], { cwd: stage, stdio: 'inherit' });
console.log(`\n${zip}`);
if (demoRecordingMissing(read('plugin.json'))) console.warn('\nWarning: no extensions.com.openai.review.demo_recording_url yet; the portal needs it before you can submit for review.');
