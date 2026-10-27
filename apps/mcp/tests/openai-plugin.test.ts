// The OpenAI plugin package (directory/openai/plugin) must meet the portal's limits, and must point at what the Worker serves.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetInPackage, PLUGIN_DIR, validatePlugin } from '../scripts/openai-plugin';

interface Manifest { extensions: { 'com.openai': { interface: Record<string, string> } } }
interface McpConfig { mcpServers: { fitwell: { url: string } } }
const read = <T>(f: string) => JSON.parse(readFileSync(join(PLUGIN_DIR, f), 'utf8')) as T;

describe('OpenAI plugin package', () => {
  it('meets the submission limits', () => {
    expect(validatePlugin(read('plugin.json'), read('mcp.json'), assetInPackage)).toEqual([]);
  });

  it('points at the production server and its legal pages', () => {
    const ui = read<Manifest>('plugin.json').extensions['com.openai'].interface;
    expect(ui.privacyPolicyURL).toBe('https://mcp.fitwell.fyi/privacy');
    expect(ui.termsOfServiceURL).toBe('https://mcp.fitwell.fyi/terms');
    expect(ui.supportURL).toBe('https://mcp.fitwell.fyi/support');
    expect(read<McpConfig>('mcp.json').mcpServers.fitwell.url).toBe('https://mcp.fitwell.fyi/mcp');
  });

  it('catches what the portal would refuse', () => {
    const bad = { name: 'Fit Well', version: '1', description: 'x', author: {}, extensions: { 'com.openai': { interface: { displayName: 'x'.repeat(31), supportURL: 'mailto:a@b.c', defaultPrompt: ['a', 'b', 'c', 'd'] } } } };
    const errors = validatePlugin(bad, { mcpServers: {} }, () => false);
    expect(errors.join('\n')).toMatch(/name: lowercase/);
    expect(errors.join('\n')).toMatch(/displayName is 31/);
    expect(errors.join('\n')).toMatch(/supportURL must be an https/);
    expect(errors.join('\n')).toMatch(/defaultPrompt/);
    expect(errors.join('\n')).toMatch(/exactly one MCP server/);
  });
});
