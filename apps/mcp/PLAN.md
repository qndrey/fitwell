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
| Sign-in | `@cloudflare/workers-oauth-provider` (MCP OAuth 2.1 + dynamic client registration) with Google as the identity provider and an email allow-list. | No passwords stored; free; invite-only by allow-list. Alternative: email magic link (needs an email sender). |
| Language | TypeScript, strict. | Same as the rest of the repo. |

## 2. Architecture

```
Claude ──HTTPS──▶ Worker (apps/mcp)
                   ├─ /authorize, /token, /register   workers-oauth-provider ──▶ Google sign-in, allow-list
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

**Phase 0b: MCP Apps on the phone (spike, do next)**
- [ ] Minimal `ui://` workout view (one exercise, log a set via `app.callServerTool`), served from a temporary deploy behind a secret URL token.
- [ ] Verify it renders and calls back in Claude **desktop, web, iOS and Android**. Record results here. If mobile does not render it, the workout runs as a text flow there.

**Phase 1: accounts and food logging**
- [ ] OAuth (workers-oauth-provider + Google, allow-list in a secret), consent screen on first sign-in.
- [ ] D1 in EU jurisdiction, migrations in `apps/mcp/migrations`, per-user scoping enforced in one data-access layer and tested (user A can never read user B).
- [ ] Profile, goals, food log tools; OFF cache in D1; `export_my_data`, `delete_my_account`.
- [ ] Exit: log a day of food from Claude on a phone; totals match `@fitwell/core` `dayTotals`.

**Phase 2: workouts**
- [ ] Templates, sessions, sets; "last time" values per exercise; supersets and timed sets as in the web app.
- [ ] Workout player UI: current set, rest timer, log/skip, next exercise; state saved on every set so a dropped connection loses nothing.

**Phase 3: body, analytics, dashboard**
- [ ] Weight and measurements; Fitwell backup import.
- [ ] Dashboard UI: weight 7-day trend, macro adherence, weekly volume per muscle, PRs and e1RM (Epley, as in the web app).

**Phase 4: meal planning**
- [ ] Meal plan storage and validation against goals (per-day macro deltas returned to Claude to fix).
- [ ] Grocery list: aggregate ingredient grams across the plan, round to buyable amounts, group by Frida food group.

## 6. Risks and open items
- **Mobile MCP Apps support** is unconfirmed (docs describe a mobile WebView; launch notes mention web and desktop). Phase 0b answers it.
- **Free-plan CPU (10 ms/request)**: first request in an isolate parses the datasets; measure on the real edge after the first deploy. If needed, move search indexes to D1 FTS.
- **D1 daily limits** fail hard on the free plan; add a usage check to the dashboard tool.
- **Open Food Facts** text search is intermittently 503 (see web TECH_SPEC); cache in D1, barcode lookups are more reliable. Rate limiting is per isolate only.
- **Exercise search ranking** puts variants ("Bench Press with Chains") before the plain lift; the web import matcher already prefers plain versions; reuse it for `search_exercises`.
- **EU jurisdiction for D1**: confirm the current setting and that it is available on the free plan before creating the database.
- **GDPR**: privacy notice, consent record, export and delete in phase 1; Cloudflare DPA applies.
