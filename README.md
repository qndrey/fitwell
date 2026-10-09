# Fitwell

A calm, private fitness and meal tracker. It runs entirely in your browser: **no accounts, no server, no analytics, no ads.** Meals, cardio and strength workouts, weight, body measurements and progress charts, with the aim that logging a whole day takes under 30 seconds.

## Privacy, in plain words
- Everything you log is stored **on your device** (IndexedDB). There is no Fitwell server to send it to.
- Fitwell goes online **only** when you ask it to look up a food (Search online, scanning a barcode) or when a food you logged without nutrition is waiting for a lookup. It then sends only the words you typed, or the barcode digits, to [Open Food Facts](https://world.openfoodfacts.org), with no cookies and no referrer. You can switch this off in Settings.
- Camera images for barcode scanning are read on your device and never leave it.
- No third-party scripts, fonts or CDNs: a strict Content-Security-Policy enforces this and tests check it.
- Clearing your browser data erases your history, so save a backup file now and then (Settings → Your data). "Delete all data" erases everything on purpose.

## Using it
Install from the browser menu ("Install" / "Add to Home Screen") for an app-like, offline-first experience. See [About](#about-the-data) in the app for sources and licences.

## Develop
| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm run preview` | Production build / serve it on :4173 |
| `npm run check` | typecheck + lint + unit tests + contrast + token lint |
| `npm run test:e2e` | Playwright (builds and serves the app itself) |
| `npm run lighthouse` | Lighthouse (mobile) against the build; fails under the thresholds |
| `npm run licenses` · `check:about` · `size` | Licence allow-list · About screen licences are current · bundle budget |
| `npm run build:foods` · `build:exercises` · `build:licenses` | Regenerate bundled data (see `data/README.md`) |
| `npm run smoke:off` | Manual check of the real Open Food Facts API (be polite) |

Docs: [PLAN.md](PLAN.md) (architecture), [TECH_SPEC.md](TECH_SPEC.md) (specs, decisions, gate status), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (live at `/#/design`), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Deploy
It is a static site. Build with `npm run build` and publish `dist/`.
- **Cloudflare Pages / Netlify:** build command `npm run build`, output `dist`. The `_headers` file in `dist` sets the security headers and CSP automatically.
- **GitHub Pages (sub-path):** build with `VITE_BASE=/your-repo/ npm run build`. GitHub Pages ignores `_headers`, so the CSP and other headers will not be sent; prefer Cloudflare Pages or Netlify.
- Use HTTPS (required for the service worker and the camera).

## About the data
Food data: Frida 5.5, DTU National Food Institute (CC BY 4.0). Exercises: free-exercise-db (public domain). Packaged foods: Open Food Facts (ODbL), looked up on request. Activity effort levels follow the Compendium of Physical Activities (rounded). Typeface: Figtree (SIL OFL). Full credits and licence texts are in the app: Settings → About and data sources.
