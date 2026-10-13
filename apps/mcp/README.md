# Fitwell for Claude (`@fitwell/mcp`)

A remote MCP server on Cloudflare Workers that lets Claude log food, plan meals, build and run workouts, and show progress. Plan, decisions and phases: [PLAN.md](PLAN.md).

**Status: phase 0b.** Reference tools plus the interactive workout player (no accounts, nothing stored yet). Until sign-in exists, `/mcp` is served only locally (`DEV_UNAUTHENTICATED=true` in `.dev.vars`) or, on a deployed test server, at `/mcp/<SPIKE_TOKEN>` (a Cloudflare secret, 32+ characters). Anything else gets 503.

| Tool | What it does |
|---|---|
| `search_foods` | Frida 5.5 foods (macros per 100 g); optionally Open Food Facts for packaged products |
| `lookup_barcode` | A packaged product by EAN/UPC from Open Food Facts |
| `search_exercises` | 876 exercises by name, muscle and equipment |
| `get_exercise` | One exercise with step-by-step instructions |
| `start_workout` | Opens the workout player (MCP Apps view `ui://fitwell/workout.html`) for a planned workout |
| `log_set` | Called by the player for each set (acknowledged, not stored until phase 1) |

## Develop
From the repository root:

```bash
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars
```

```bash
npm run dev:mcp
```

That serves `http://127.0.0.1:8787/mcp` in the real Workers runtime (workerd). In a second terminal, call it like Claude would:

```bash
npm run smoke -w @fitwell/mcp
```

To try the workout player the way Claude shows it, run a local MCP Apps host (needs `npm run dev:mcp` running) and open http://127.0.0.1:8788:

```bash
npm run dev:host -w @fitwell/mcp
```

Or connect Claude Code to the local server:

```bash
claude mcp add --transport http fitwell-local http://127.0.0.1:8787/mcp
```

| Command | What it does |
|---|---|
| `npm run check -w @fitwell/mcp` | typecheck + lint + tests (a real MCP client against the Worker's fetch handler, Open Food Facts stubbed) |
| `npm run build:ui -w @fitwell/mcp` | Bundle each view in `ui/<name>` into one HTML string (`src/ui/generated`, git-ignored); runs automatically before dev, deploy, typecheck and tests |
| `npm run types -w @fitwell/mcp` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |

Data sources: Frida 5.5, DTU National Food Institute (CC BY 4.0); Open Food Facts (ODbL); free-exercise-db (The Unlicense). Tool results carry the attribution.
