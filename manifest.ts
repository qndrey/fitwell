// The web app manifest, in one place so a unit test can check it against the icon files in public/.
import type { ManifestOptions } from 'vite-plugin-pwa';

export const MANIFEST: Partial<ManifestOptions> & { id: string; start_url: string; scope: string; icons: { src: string; sizes: string; type: string; purpose: string }[] } = {
  name: 'Fitwell',
  short_name: 'Fitwell',
  description: 'A calm, private fitness and meal tracker. Your data stays on your device.',
  // Same address as start_url, written out so Android keeps one identity for the installed app.
  id: './',
  start_url: './',
  scope: './',
  lang: 'en',
  categories: ['health', 'fitness', 'lifestyle'],
  display: 'standalone',
  background_color: '#faf8f5',
  theme_color: '#faf8f5',
  // Android reads these in different ways: "any" for plain shortcuts and the install dialog, "maskable" for the
  // adaptive launcher icon (cropped to a circle or squircle), "monochrome" for Android 13 themed icons.
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icon-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
  ],
};
