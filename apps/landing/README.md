# Landing page (fitwell.fyi)

The page at https://fitwell.fyi and www.fitwell.fyi: a Cloudflare Worker with static assets only (`fitwell-landing`, see `wrangler.jsonc`). The MCP server stays at mcp.fitwell.fyi.

The design lives in Lovable (project "Fitwell Coach", https://lovable.dev/projects/38702e48-c52e-4674-874b-8a023d134731). `site/` is its source: TanStack Start, React and Tailwind. It is not an npm workspace, so it has its own `package-lock.json`.

| Command (from the repository root) | What it does |
|---|---|
| `npm --prefix apps/landing/site ci` | Install the site's dependencies once |
| `npm --prefix apps/landing/site run dev:cf` | Build and serve it on :8789 with the real Cloudflare runtime and headers |
| `npm --prefix apps/landing/site run deploy` | Build and deploy to fitwell.fyi |

## How the static build differs from Lovable

`build:static` sets `FITWELL_STATIC=1`. Lovable's own builds don't set it, so they behave as before.

- The one route is prerendered to `site/.output/public/index.html`, so no server code runs.
- Images: Lovable refers to its own asset host (`src/assets/*.png.asset.json`, `/__l5e/...`). A small Vite plugin in `vite.config.ts` points each of those at the PNG beside it, which is copied into the build with a hashed name.
- Headers: `scripts/static-headers.mjs` writes `_headers` with the same strict CSP as the rest of Fitwell. TanStack's few inline bootstrap scripts are allowed by their exact hashes, which are recomputed on every build.

## Bringing in a new design from Lovable

Copy the changed files from the Lovable project into `site/`, or connect the Lovable project to GitHub and copy from there. A new screenshot needs its PNG in `src/assets/` next to the `.asset.json` Lovable creates. Then run `dev:cf` to check it and `deploy` to publish.
