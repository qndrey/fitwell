import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { SECURITY_HEADERS, headersFile } from './csp.ts';

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
      manifest: {
        name: 'Fitwell',
        short_name: 'Fitwell',
        description: 'A calm, private fitness and meal tracker. Your data stays on your device.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#faf8f5',
        theme_color: '#faf8f5',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
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
