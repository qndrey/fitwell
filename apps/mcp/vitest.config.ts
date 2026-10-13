import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Workers-only module used by the OAuth library; a tiny stand-in lets the whole Worker run in Node.
    alias: { 'cloudflare:workers': join(import.meta.dirname, 'tests/support/cloudflare-workers.ts') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Processed by Vite (not Node's loader) so the alias above applies inside the package.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
