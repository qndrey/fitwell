import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { SECURITY_HEADERS, headersFile } from './csp.ts';
import { MANIFEST } from './manifest.ts';

const version = (JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }).version;

function headersPlugin(): Plugin {
  return {
    name: 'fitwell-headers',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile() });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    preact(),
    headersPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: MANIFEST,
      workbox: {
        // wasm = the barcode decoder (~1 MB). Precached so scanning works in a shop with no signal, on first use too.
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // The style guide is reachable by URL only; no need to cache it for offline use.
        globIgnores: ['**/Design-*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  preview: { headers: SECURITY_HEADERS },
  // Fonts must stay separate files: the CSP allows font-src 'self' but not data: URIs.
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
});
