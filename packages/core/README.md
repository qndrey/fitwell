# @fitwell/core

Platform-neutral code used by Fitwell for Claude (`apps/mcp`, the MCP server). No runtime dependencies, no DOM, no IndexedDB: it is type-checked against plain ES2023 so it runs in browsers, Node and Cloudflare Workers.

| Path | What |
|---|---|
| `schema.ts` | The data model (food entries, workouts, body, goals) |
| `domain/*` | Pure logic: dates, units, nutrition, totals, workouts, MET, stats, body, streaks |
| `data/*` | Bundled datasets (Frida 5.5 foods, free-exercise-db, cardio activities, measurement presets), lazy-loaded |
| `search/*` | Typo-tolerant ranking for foods and exercises |
| `off/*` | Open Food Facts client (inject `fetch`), response normalisation, rate limiter |
| `ean.ts` | Barcode checks |

Import by path, e.g. `import { dayTotals } from '@fitwell/core/domain/totals'`. The package ships TypeScript source (no build step); Vite and Wrangler bundle it like local code, so lazy `import()` of the datasets still splits into separate chunks.

Rebuilding the datasets: see [data/README.md](data/README.md). Checks: `npm run check -w @fitwell/core`.
