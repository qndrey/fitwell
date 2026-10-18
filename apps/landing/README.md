# Landing page (fitwell.fyi)

The page at https://fitwell.fyi and www.fitwell.fyi: a Cloudflare Worker with static assets only (`fitwell-landing`, see `wrangler.jsonc`). The MCP server stays at mcp.fitwell.fyi.

The page is edited in this repository: `site/` is the source (TanStack Start, React and Tailwind). It started as a Lovable design (project "Fitwell Coach"), but Lovable is no longer the source of truth, so do not import from it: that would overwrite the changes made here. `site/` is not an npm workspace, so it has its own `package-lock.json`.

| Command (from the repository root) | What it does |
|---|---|
| `npm --prefix apps/landing/site ci` | Install the site's dependencies once |
| `npm --prefix apps/landing/site run dev:cf` | Build and serve it on :8789 with the real Cloudflare runtime and headers |
| `npm --prefix apps/landing/site run deploy` | Build and deploy to fitwell.fyi |

## How the static build works

`build:static` sets `FITWELL_STATIC=1`.

- The one route is prerendered to `site/.output/public/index.html`, so no server code runs.
- Screenshots: plain PNGs in `site/src/assets`, one light and one dark file per view (`<name>-light.png`, `<name>-dark.png`), taken from the real views by `apps/mcp/scripts/screenshots.ts`. `index.tsx` loads them with `import.meta.glob` and shows the one that matches the visitor's theme (`<picture>`); `SIZES` in `index.tsx` holds their pixel sizes, so update it when you re-shoot. The 1200×630 sharing card is `site/public/og.png`.
- Images from the Lovable days (`src/assets/*.png.asset.json`, `/__l5e/...`): a small Vite plugin in `vite.config.ts` points those at the PNG beside them. New images are plain PNG imports and need none of this.
- Headers: `scripts/static-headers.mjs` writes `_headers` with the same strict CSP as the rest of Fitwell. TanStack's few inline bootstrap scripts are allowed by their exact hashes, which are recomputed on every build.

## Changing the page

**Support section.** `SUPPORT` at the top of `site/src/routes/index.tsx` lists Liberapay, Ko-fi and GitHub Sponsors with an empty `url` each. A provider is shown once its `url` is set; while all are empty the "Support Fitwell" section is not rendered, so there is never a dead link. Set the URLs, then `deploy`.

Edit `site/src/routes/index.tsx` (copy and layout), `site/src/styles.css` (colours and tokens) and the screenshots (see above). Run `dev:cf` to check it on the real Cloudflare runtime, then `deploy` to publish.
