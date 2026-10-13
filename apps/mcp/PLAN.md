# Fitwell for Claude: MCP server plan

A remote MCP server so Claude (claude.ai, desktop and mobile) can track food and macros, plan a week of meals with a meal-prep grocery list, build workouts, run a workout interactively, and show weight and training progress as a dashboard.

## 1. Decisions (agreed 2026-10-13)

| Decision | Choice | Why |
|---|---|---|
| Relation to the web app | Separate product in the same monorepo; shares `@fitwell/core`. The PWA stays local-only and private, unchanged. | Keep Fitwell's privacy promise; reuse the data model, domain logic and datasets without copying. |
| Users | Friends and family, invite-only. | No billing, no public sign-up; GDPR still applies (health data, Art. 9). |
| Hosting | Cloudflare Workers free plan, EU data location. | €0 for a handful of users; the web app already deploys to Cloudflare. |
| MCP stack | `@modelcontextprotocol/server` v2 `createMcpHandler`: stateless, one server instance per request. No `agents` package, no Durable Objects. | Smallest moving part that serves both the 2026-07-28 protocol and 2025-era clients; nothing to keep alive between requests. |
| Food data | Frida 5.5 (DTU, CC BY 4.0) + Open Food Facts (ODbL). Claude may estimate a food only when it says so. | European sources, same as the web app. |
| Who reasons | Claude plans meals and workouts; the server stores, validates and calculates (macro totals, grocery list, volume, e1RM, trends). | The server never calls an LLM; deterministic numbers. |
| Interactive UI | MCP Apps (`@modelcontextprotocol/ext-apps`): workout player and dashboard as `ui://` resources. Every tool also works as plain text. | Renders inline in Claude; text fallback where a client has no UI. |
| Sign-in | `@cloudflare/workers-oauth-provider` (MCP OAuth 2.1 + dynamic client registration) with **email sign-in** for invited addresses: one email carrying a magic link **and** a 6-digit code (decided 2026-10-13, replaces Google sign-in). | No passwords, no third-party identity provider. The code covers the common phone case where the emailed link opens in a different browser than Claude's sign-in sheet. |
| Language | TypeScript, strict. | Same as the rest of the repo. |

## 2. Architecture

```
Claude ──HTTPS──▶ Worker (apps/mcp)
                   ├─ /authorize, /token, /register   workers-oauth-provider ──▶ email link + code, invite list
                   ├─ /mcp                             createMcpHandler(factory, authInfo = signed-in user)
                   │    └─ tools ──▶ @fitwell/core (domain, Frida, exercises, OFF client)
                   │              ──▶ D1 (EU): user data, OFF lookup cache
                   └─ ui:// resources                  workout player, dashboard (single-file HTML, built with Vite)
```

- Every user-owned row carries `user_id`; every query is scoped by the signed-in user from `authInfo`, never by a tool argument.
- Records keep the web app's conventions (`@fitwell/core/schema`): UUIDs, `createdAt`/`updatedAt`, soft-delete tombstones, name and nutrition snapshots on log entries.
- D1 free-plan budget: queries fail for the rest of the UTC day after the daily read/write limit. Index every lookup by `(user_id, day)`; never scan.

## 3. Data model (D1, next phase)

| Table | Key columns |
|---|---|
| `users` | id, email, name, created_at, consented_at, deleted_at |
| `profiles` | user_id, units, height_cm, birth_year, sex (optional), activity_level, equipment[], diet_preferences, allergies |
| `goals` | user_id, kcal, protein_g, carbs_g, fat_g, workouts_per_week, goal_weight_kg |
| `food_entries` | id, user_id, day, slot, food_ref, food_name, grams, kcal, protein, carbs, fat, estimated (bool) |
| `custom_foods`, `recipes`, `recipe_items` | per-user foods and recipes (per-100 g normalised) |
| `meal_plans`, `meal_plan_items` | week start, day, slot, recipe or food, servings |
| `workout_templates`, `workouts`, `workout_sets` | exercise ref + name snapshot, set type, reps, weight_kg, duration, done, rpe |
| `weights`, `measurements` | day-unique per user |
| `off_cache` | key (query or barcode), fetched_at, candidates JSON (shared, not personal) |

## 4. Tools

| Area | Tool | Status |
|---|---|---|
| Reference | `search_foods`, `lookup_barcode`, `search_exercises`, `get_exercise` | **Done (phase 0)** |
| Profile | `get_profile`, `update_profile`, `set_goals` (with a TDEE/macro suggestion from core) | Phase 1 |
| Food log | `log_food` (several items in one call), `get_day`, `edit_food_entry`, `delete_food_entry`, `save_custom_food`, `save_recipe` | Phase 1 |
| Workouts | `create_workout_template`, `list_templates`, `start_workout` (opens the player), `log_set`, `finish_workout`, `get_workout_history` | Phase 2 |
| Body | `log_weight`, `log_measurements` | Phase 3 |
| Analytics | `get_progress` (weight trend, macro adherence, volume, PRs, e1RM), `show_dashboard` (opens the UI) | Phase 3 |
| Meal planning | `save_meal_plan` (validated against goals), `get_meal_plan`, `get_grocery_list` (aggregated grams, grouped by aisle, scaled for prep) | Phase 4 |
| Account | `export_my_data`, `delete_my_account`, `import_fitwell_backup` (web app backup JSON) | Phase 1 (export/delete), 3 (import) |

## 5. Phases and exit criteria

**Phase 0: scaffold (done 2026-10-13)**
- [x] Monorepo with `packages/core`; web build unchanged (same chunks, 55.95 kB, 244 e2e green).
- [x] `apps/mcp` Worker serving reference tools; core runs in `workerd` (`wrangler dev` + `npm run smoke`); bundle 313 KB gzip.
- [x] In-process MCP client tests; OFF stubbed; deployed Worker refuses `/mcp` until sign-in exists.

**Phase 0b: MCP Apps on the phone (done 2026-10-13)**
- [x] Workout player view (`ui/workout`, plain TypeScript, single-file HTML via esbuild): sets/reps/weight steppers, log/skip, rest timer, exercise list, finish → summary to Claude (`ui/message`) and progress in model context; host theme variables; diagnostics footer (platform, server round trip). Verified in a local AppBridge host (`npm run dev:host`) in light and dark at phone width.
- [x] Temporary deploy on `mcp.fitwell.fyi` behind a secret URL token (`/mcp/<SPIKE_TOKEN>`), added to claude.ai as a custom connector; ~140–170 ms per tool call from outside.
- [x] User test (2026-10-13): food lookup, barcode, exercise search and the workout player all worked, including set logging to the server ("sets reach Fitwell ✓"), rest timer and the finish summary arriving in the chat. Android not tested.

**Phase 1: accounts and food logging (done 2026-10-13)**
- [x] OAuth (workers-oauth-provider: DCR + CIMD, PKCE, refresh tokens sliding 60 days) with email sign-in: link + 6-digit code (single use, 10 min, hashed), consent box on every sign-in (recorded on first), same response for uninvited addresses, 5 tries per code counted atomically, per-email/IP limits. The link only counts in the browser that started the sign-in (login-phishing fix after a security review); the code works from any device.
- [x] D1 schema and migrations (`migrations/`), every personal query through `UserData` bound to the token's user; isolation tested (user A can't read, edit, delete or search user B's data).
- [x] Profile, goals (`suggest_targets` with core `energy.ts`), food log with server-side macro resolution and marked estimates, own foods, nutrition summary, OFF cache in D1, `export_my_data`, `delete_my_account` (revokes all grants; tokens of deleted people are refused).
- [x] Privacy notice at `/privacy`; invite script; local dev shortcut only on localhost and only without a token.
- [x] Verified in workerd (`wrangler dev`): full sign-in by code and by link in a browser, token exchange, MCP calls as the signed-in person.
- [x] Deploy: Email Routing on fitwell.fyi + verified destination for each invitee; `wrangler d1 create fitwell --jurisdiction eu`; KV namespace for OAuth; real ids in `wrangler.jsonc`; remote migrations; invite; deploy; delete the `SPIKE_TOKEN` secret; change the Claude connector to `https://mcp.fitwell.fyi/mcp`.
- [x] Exit (user test 2026-10-13): signed in by email through the new connector, profile and food logging worked. Privacy contact: fitwell.fyi@pm.me.

**Phase 2: workouts**
- [ ] Templates, sessions, sets; "last time" values per exercise; supersets and timed sets as in the web app.
- [ ] Workout player UI: current set, rest timer, log/skip, next exercise; state saved on every set so a dropped connection loses nothing.

**Phase 3: body, analytics, dashboard, import (built 2026-10-13)**
- [x] Weight (one per day; 7-day average and trend in the reply; profile weight follows the latest weigh-in) and measurements (cm, body fat %, merged per day); migration 0004; export and delete include them.
- [x] `get_progress` (numbers for Claude) and `show_dashboard` (MCP Apps view `ui://fitwell/dashboard.html`): weight with 7-day average and goal, calories against goals with adherence, workouts per week, sets per muscle, strength records (Epley e1RM) with sparklines, measurement changes; 30/90/365-day switch. `analytics/progress.ts` is pure and tested against hand-computed numbers.
- [x] Fitwell backup import: `import_fitwell_backup` returns a one-time link (30 min, one person, token hashed, replaced by a newer link) to an upload page. The browser reads the backup file and sends it in chunks of 150 records, so no request strains the free plan's CPU (heaviest chunk about 1.4 ms) and the file never passes through the chat. `import/convert.ts` converts defensively and counts what it skips with a reason; writes are `INSERT OR IGNORE` on ids scoped to the person, so repeats add nothing, two people importing one file each get everything, and nothing already in the account is overwritten (the file only fills gaps: a day's weigh-in, goals not yet set, missing measurement types). `get_last_import` reports the result. Pending lookups, deleted records, own exercises/measurement types and cardio templates are not imported. Checked in a real browser with a 700-entry file (about 200 ms). Migration 0005.
- [x] `log_past_workout`: a workout already done, by chat, on any day; personal records compare only with sessions up to that day.

**Phase 4: meal planning (built 2026-10-13; deploy pending)**
- [x] Recipes (`save_recipe`, `list_recipes`, `get_recipe`, `delete_recipe`): nutrition per serving from the foods' own values; names are case-insensitive. Recipes and plans store snapshots, so editing a recipe never changes a plan already shopped for. Migration 0006.
- [x] `get_planning_context`: goals with a per-meal split (25/30/30/15 %), diet, allergies, dislikes, the foods actually eaten most (60 days), saved recipes, planned weeks.
- [x] `save_meal_plan` (Monday to Sunday; foods, recipes or marked estimates): replies with each day against the calorie goal (within 10 %) and protein goal (at least 90 %), empty days, and allergy and dislike matches in item and ingredient names, as plain-language problems that Claude must fix before presenting. Revised plans keep the "eaten" mark of unchanged meals. The allergy check is a text match on names: it does not know what is inside a packaged product.
- [x] `get_meal_plan` (with an `editable` form to change and save again, and batch-cooking hints for recipes that recur), `delete_meal_plan`, `log_planned_meal` (a planned day or meal into the food log, once).
- [x] `get_grocery_list`: ingredients added up per food, rounded up to what a shop sells, grouped by shopping section (every one of the 140 Frida food groups is mapped; tested), for any number of people, minus what is already at home and meals already eaten; a markdown checklist; foods listed as cooked are flagged because raw weighs less.
- [x] Food search ranks "Egg, chicken, whole, raw" before "Egg mayonnaise salad" (names whose first part equals the query come first).
- [ ] An interactive shopping checklist (MCP Apps view) and a plan view with swap and repeat; ticks would need storage.
- [ ] Exit: plan a week from Claude on a phone, get the list, log a planned day.

## 6. Risks and open items
- **Free-plan CPU (10 ms/request)**: first request in an isolate parses the datasets; measure on the real edge after the first deploy. If needed, move search indexes to D1 FTS.
- **D1 daily limits** fail hard on the free plan; add a usage check to the dashboard tool.
- **Open Food Facts** text search is intermittently 503 (see web TECH_SPEC); cache in D1, barcode lookups are more reliable. Rate limiting is per isolate only.
- **Tool count**: 47 tools, about 9,000 tokens of definitions that every conversation reads. If it starts to matter, merge the small delete/list pairs or hide rarely used tools behind a single `help` tool.
- **View bundle size**: the player is 597 KB (129 KB gzip), almost all zod pulled in by the MCP Apps SDK; our code is 6 KB. Fine for the spike; look for a slimmer import before phase 2.
- **Player state** lives in the view only during phase 0b; a reload of the conversation loses progress until sets are stored (phase 1/2).
- **EU jurisdiction for D1**: confirm the current setting and that it is available on the free plan before creating the database.
- **Email sending on the free plan** works only to verified destination addresses, and Cloudflare marks outbound sending as beta. Confirm the `send_email` binding behaviour when building phase 1. Fallback: Workers Paid (about $5/month, sends to anyone).
- **GDPR**: privacy notice, consent record, export and delete in phase 1; Cloudflare DPA applies.
