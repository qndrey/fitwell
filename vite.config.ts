import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { SECURITY_HEADERS, headersFile } from './csp.ts';

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
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  preview: { headers: SECURITY_HEADERS },
  build: { target: 'es2022', sourcemap: false },
});
