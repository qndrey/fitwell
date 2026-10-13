# Fitwell for Claude (`@fitwell/mcp`)

A remote MCP server on Cloudflare Workers that lets Claude log food, plan meals, build and run workouts, and show progress. Plan, decisions and phases: [PLAN.md](PLAN.md).

**Status: phase 3 built and tested locally; phases 1 and 2 are deployed.** Invite-only email sign-in (OAuth 2.1), and per-person data in D1: profile, goals, food log, own foods, workouts, templates, weight and measurements, with a progress dashboard.

| Area | Tools |
|---|---|
| Profile and goals | `get_profile`, `update_profile`, `suggest_targets` (Mifflin-St Jeor, nothing saved), `set_goals` |
| Foods | `search_foods` (own foods, Frida, optionally Open Food Facts), `lookup_barcode`, `save_custom_food` |
| Food log | `log_food` (several items; macros resolved from the source; estimates marked), `get_day`, `get_nutrition_summary`, `edit_food_entry`, `delete_food_entry` |
| Exercises and workouts | `search_exercises`, `get_exercise`, `start_workout` (opens the player; saves the workout; weights from the progression rule), `log_set` and `finish_workout` (from the player), `get_workout_history`, `suggest_progression`, templates (`save_/list_/delete_workout_template`), `log_cardio`, `log_past_workout`, `delete_workout` |
| Body and progress | `log_weight`, `delete_weight_entry`, `log_measurements`, `delete_measurements`, `get_progress`, `show_dashboard` (opens the dashboard; `get_dashboard_data` is called by the view) |
| Import | `import_fitwell_backup` (one-time upload link for a backup from the private Fitwell app), `get_last_import` |
| Account | `export_my_data`, `delete_my_account` (erases everything, signs out everywhere) |

**Sign-in:** Claude registers itself (dynamic registration or a Client ID Metadata Document) and opens `/authorize`. The person enters their email and ticks consent; invited addresses get a 6-digit code and a link (single use, 10 minutes, stored hashed). The code works from any device; the link only in the browser that started the sign-in. Privacy notice: `/privacy`.

## Develop
From the repository root, once:

```bash
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars
```

```bash
npm run db:migrate -w @fitwell/mcp
```

Then start the server (the real Workers runtime, with local D1, KV and email):

```bash
npm run dev:mcp
```

On `http://127.0.0.1:8787/mcp`, requests *without* a token run as a local dev person (`dev@localhost`), so tools are easy to try:

```bash
npm run smoke -w @fitwell/mcp
```

To try the real sign-in locally, invite a test address and connect any MCP client to the same URL. Local sign-in emails are not sent; Wrangler prints the path of each one in its output.

```bash
npm run invite -w @fitwell/mcp -- tester@fitwell.test
```

To see the workout player or the dashboard the way Claude shows them, run a local MCP Apps host and open http://127.0.0.1:8788 (add `?view=dashboard` for the dashboard; `/raw/dashboard` serves a view as a plain page to see console errors):

```bash
npm run dev:host -w @fitwell/mcp
```

| Command | What it does |
|---|---|
| `npm run check -w @fitwell/mcp` | typecheck + lint + tests (a real MCP client against the Worker's fetch handler, Open Food Facts stubbed) |
| `npm run build:ui -w @fitwell/mcp` | Bundle each view in `ui/<name>` into one HTML string (`src/ui/generated`, git-ignored); runs automatically before dev, deploy, typecheck and tests |
| `npm run invite -w @fitwell/mcp -- <email> [--remote]` | Add someone to the invite list (local or deployed database). On the free plan they must also be a verified destination address in Email Routing |
| `npm run types -w @fitwell/mcp` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |

Data sources: Frida 5.5, DTU National Food Institute (CC BY 4.0); Open Food Facts (ODbL); free-exercise-db (The Unlicense). Tool results carry the attribution.
