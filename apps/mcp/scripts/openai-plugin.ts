// Checks directory/openai/plugin against the limits in OpenAI's plugin submission guide
// (https://developers.openai.com/apps-sdk/deploy/submission), so a bad package is caught here and not in the portal.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems with the manifest and MCP config; empty when the package is ready. `assetExists` says whether a ./path in the package is there. */
export function validatePlugin(manifest: unknown, mcp: unknown, assetExists: (path: string) => boolean): string[] {
  const errors: string[] = [];
  const m = isObj(manifest) ? manifest : {};
  const ui = (isObj(m.extensions) && isObj(m.extensions['com.openai']) && isObj((m.extensions['com.openai'] as Json).interface) ? (m.extensions['com.openai'] as Json).interface : {}) as Json;
  const str = (o: Json, k: string, max: number, label = k) => {
    const v = o[k];
    if (typeof v !== 'string' || !v.trim()) errors.push(`${label} is required`);
    else if (v.length > max) errors.push(`${label} is ${v.length} characters, at most ${max}`);
  };

  str(m, 'name', 64);
  if (typeof m.name === 'string' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.name)) errors.push('name: lowercase letters, numbers and single hyphens only');
  str(m, 'version', 64);
  str(m, 'description', 1000);
  if (!isObj(m.author) || typeof m.author.name !== 'string' || !m.author.name) errors.push('author.name is required');

  str(ui, 'displayName', 30, 'interface.displayName');
  str(ui, 'shortDescription', 30, 'interface.shortDescription');
  str(ui, 'longDescription', 4000, 'interface.longDescription');
  str(ui, 'developerName', 80, 'interface.developerName');
  str(ui, 'category', 100, 'interface.category');
  if (!Array.isArray(ui.capabilities) || ui.capabilities.length > 20 || ui.capabilities.some((c) => typeof c !== 'string' || c.length > 120)) errors.push('interface.capabilities: at most 20 labels of at most 120 characters');
  for (const k of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (typeof ui[k] !== 'string' || !ui[k].startsWith('https://')) errors.push(`interface.${k} must be an https:// URL`);
  }
  const prompts = ui.defaultPrompt;
  if (!Array.isArray(prompts) || prompts.length > 3 || prompts.some((p) => typeof p !== 'string' || p.length > 128)) errors.push('interface.defaultPrompt: at most 3 prompts of at most 128 characters');

  const assets = [ui.logo, ui.composerIcon, ...(Array.isArray(ui.screenshots) ? ui.screenshots : [])];
  if (typeof ui.logo !== 'string') errors.push('interface.logo is required');
  if (typeof ui.composerIcon !== 'string') errors.push('interface.composerIcon is required');
  for (const a of assets) {
    if (typeof a !== 'string') continue;
    if (!a.startsWith('./')) errors.push(`${a}: asset paths start with ./`);
    else if (!assetExists(a.slice(2))) errors.push(`${a}: file not found in the package`);
  }

  const servers = isObj(mcp) && isObj(mcp.mcpServers) ? Object.entries(mcp.mcpServers) : [];
  if (servers.length !== 1) errors.push('mcp.json: exactly one MCP server');
  for (const [name, s] of servers) {
    const server = isObj(s) ? s : {};
    if (server.type !== 'streamable-http') errors.push(`mcp.json ${name}: type must be streamable-http`);
    if (typeof server.url !== 'string' || !server.url.startsWith('https://')) errors.push(`mcp.json ${name}: url must be https://`);
    if (server.headers !== undefined) errors.push(`mcp.json ${name}: no headers (tokens must not be in the package)`);
  }
  return errors;
}

export const PLUGIN_DIR = join(import.meta.dirname, '..', 'directory', 'openai', 'plugin');
/** The package's ./assets files are the directory listing's own images, copied in when the ZIP is built (not kept twice). */
export const ASSET_SOURCES: Record<string, string> = {
  'assets/logo.png': join(import.meta.dirname, '..', 'directory', 'icon-512.png'),
  'assets/screenshot-1.png': join(import.meta.dirname, '..', 'directory', '1-workout-player.png'),
  'assets/screenshot-2.png': join(import.meta.dirname, '..', 'directory', '2-dashboard.png'),
  'assets/screenshot-3.png': join(import.meta.dirname, '..', 'directory', '3-weekly-review.png'),
  'assets/screenshot-4.png': join(import.meta.dirname, '..', 'directory', '4-shopping-list.png'),
  'assets/screenshot-5.png': join(import.meta.dirname, '..', 'directory', '5-exercise-guide.png'),
};
export const assetInPackage = (path: string) => existsSync(ASSET_SOURCES[path] ?? join(PLUGIN_DIR, path));
