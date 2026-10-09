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
- **Cloudflare Pages (automated):** `.github/workflows/ci.yml` runs every check, then deploys the exact build that passed with Wrangler: pushes to `main` go to production, pull requests from this repository get a preview URL. After deploying it fetches the site and fails if the Content-Security-Policy header is missing. One-time setup:
  1. Create the project: `npx wrangler pages project create <name> --production-branch=main`.
  2. Create an API token (Cloudflare dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* template is too broad; use a custom token with **Account → Cloudflare Pages → Edit**), and note your Account ID.
  3. In the GitHub repository (Settings → Secrets and variables → Actions) add secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and the variable `CLOUDFLARE_PAGES_PROJECT` with the project name.
  4. Optional: add your own domain under the Pages project's *Custom domains*.
  Until those three are set, the deploy job is skipped (CI stays green). The `_headers` file in `dist` sets the security headers and the CSP; `sw.js` is served with `no-cache` so updates reach people.
- **Cloudflare Pages with its own Git integration (no GitHub Action needed):** Workers & Pages → Create → Pages → Connect to Git → pick the repository. Framework preset *None*, build command `npm run build`, build output directory `dist`, root directory empty. `.node-version` (22) selects the Node version. Cloudflare then builds on every push (production branch `main`, previews for other branches). It does not run the tests; GitHub CI does, so consider protecting `main` until CI is green. If you use this route you can delete the `deploy` job in `ci.yml` (it skips itself while the Cloudflare secrets are unset).
- **Netlify:** the same build command and output directory.
- **GitHub Pages (sub-path):** build with `VITE_BASE=/your-repo/ npm run build`. GitHub Pages ignores `_headers`, so the CSP and other headers will not be sent; prefer Cloudflare Pages or Netlify.
- Use HTTPS (required for the service worker and the camera).

## About the data
Food data: Frida 5.5, DTU National Food Institute (CC BY 4.0). Exercises: free-exercise-db (public domain). Packaged foods: Open Food Facts (ODbL), looked up on request. Activity effort levels follow the Compendium of Physical Activities (rounded). Typeface: Figtree (SIL OFL). Full credits and licence texts are in the app: Settings → About and data sources.
