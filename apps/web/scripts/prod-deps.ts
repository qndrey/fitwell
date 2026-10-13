// The web app's production dependency tree, read with `npm ls`. Works inside the npm workspace,
// where packages are hoisted to the repository root (license-checker only looks in ./node_modules).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export interface ProdDep {
  name: string;
  version: string;
  license: string;
  url: string;
  licenseFile?: string;
}

interface LsNode {
  version?: string;
  path?: string;
  dependencies?: Record<string, LsNode>;
}

interface PackageJson {
  license?: string | { type?: string };
  repository?: string | { url?: string };
}

// Same precedence as license-checker, minus README.
const LICENSE_NAMES = [/^LICENSE$/, /^LICENSE-\w+$/, /^LICENCE$/, /^LICENCE-\w+$/, /^MIT-LICENSE$/, /^COPYING$/];

function findLicenseFile(dir: string): string | undefined {
  const files = readdirSync(dir);
  for (const pattern of LICENSE_NAMES) {
    const hit = files.find((f) => pattern.test(basename(f, extname(f)).toUpperCase()));
    if (hit) return join(dir, hit);
  }
  return undefined;
}

function repoUrl(repo: PackageJson['repository']): string {
  const raw = (typeof repo === 'string' ? repo : repo?.url) ?? '';
  return raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^github:/, 'https://github.com/')
    .replace(/^([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
    .replace(/\.git$/, '');
}

export function prodDeps(): ProdDep[] {
  const raw = execFileSync('npm', ['ls', '--workspace', '@fitwell/web', '--omit=dev', '--all', '--json', '--long'], {
    encoding: 'utf8',
    maxBuffer: 50_000_000,
  });
  const root = (JSON.parse(raw) as LsNode).dependencies?.['@fitwell/web'];
  if (!root) throw new Error('npm ls did not return the @fitwell/web workspace');
  const seen = new Map<string, ProdDep>();
  const walk = (deps: Record<string, LsNode> | undefined) => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      if (!node.version || !node.path) continue;
      const key = `${name}@${node.version}`;
      if (seen.has(key)) continue;
      const pkg = JSON.parse(readFileSync(join(node.path, 'package.json'), 'utf8')) as PackageJson;
      const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
      seen.set(key, { name, version: node.version, license, url: repoUrl(pkg.repository), licenseFile: findLicenseFile(node.path) });
      walk(node.dependencies);
    }
  };
  walk(root.dependencies);
  if (seen.size === 0) throw new Error('No production dependencies found; refusing to report a vacuous pass');
  return [...seen.values()];
}
