import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Markdown imports are text, as the Wrangler rule makes them in the Worker (src/instructions).
  plugins: [{ name: 'markdown-as-text', transform: (code, id) => (id.endsWith('.md') ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined) }],
  resolve: {
    // Workers-only module used by the OAuth library; a tiny stand-in lets the whole Worker run in Node.
    alias: { 'cloudflare:workers': join(import.meta.dirname, 'tests/support/cloudflare-workers.ts') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The workout view tests drive a real browser, several files at once; the 5 s default is too tight for them.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each of those files starts its own Chromium; running all of them side by side starves the timing-sensitive ones.
    maxWorkers: 3,
    // Processed by Vite (not Node's loader) so the alias above applies inside the package.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
