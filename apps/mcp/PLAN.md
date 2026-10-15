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
| Reference | `search_foods`, `lookup_barcode`, `search_exercises` (with `id` for details) | **Done (phase 0)** |
| Profile | `get_profile`, `update_profile`, `set_goals` (with a TDEE/macro suggestion from core) | Phase 1 |
| Food log | `log_food` (several items in one call), `get_food_log`, `edit_food_entry`, `save_custom_food`, `save_recipe` | Phase 1 |
| Workouts | `create_workout_template`, `list_templates`, `start_workout` (opens the player), `log_set`, `finish_workout`, `get_workout_history` | Phase 2 |
| Body | `log_body` (weight, measurements, sleep, steps, water) | Phase 3, 5 |
| Analytics | `get_progress` (weight trend, macro adherence, volume, PRs, e1RM), `show_dashboard` (opens the UI) | Phase 3 |
| Meal planning | `save_meal_plan` (validated against goals), `get_meal_plan`, `show_grocery_list` (aggregated grams, grouped by aisle, scaled for prep; tick-off checklist) | Phase 4, 5 |
| Account | `export_my_data`, `delete_my_account`, `import_fitwell_backup` (web app backup JSON) | Phase 1 (export/delete), 3 (import) |

## 5. Phases and exit criteria

Phases 6 and later (coaching, friends, wearables, faster logging) are in [ROADMAP.md](ROADMAP.md).

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

**Phase 4: meal planning (built and deployed 2026-10-13)**
- [x] Recipes (`save_recipe`, `list_recipes`, `get_recipe`, `delete_recipe`): nutrition per serving from the foods' own values; names are case-insensitive. Recipes and plans store snapshots, so editing a recipe never changes a plan already shopped for. Migration 0006.
- [x] `get_planning_context`: goals with a per-meal split (25/30/30/15 %), diet, allergies, dislikes, the foods actually eaten most (60 days), saved recipes, planned weeks.
- [x] `save_meal_plan` (Monday to Sunday; foods, recipes or marked estimates): replies with each day against the calorie goal (within 10 %) and protein goal (at least 90 %), empty days, and allergy and dislike matches in item and ingredient names, as plain-language problems that Claude must fix before presenting. Revised plans keep the "eaten" mark of unchanged meals. The allergy check is a text match on names: it does not know what is inside a packaged product.
- [x] `get_meal_plan` (with an `editable` form to change and save again, and batch-cooking hints for recipes that recur), `delete_meal_plan`, `log_planned_meal` (a planned day or meal into the food log, once).
- [x] `get_grocery_list`: ingredients added up per food, rounded up to what a shop sells, grouped by shopping section (every one of the 140 Frida food groups is mapped; tested), for any number of people, minus what is already at home and meals already eaten; a markdown checklist; foods listed as cooked are flagged because raw weighs less.
- [x] Food search ranks "Egg, chicken, whole, raw" before "Egg mayonnaise salad" (names whose first part equals the query come first).
- [x] Interactive shopping checklist: phase 5. A plan view with swap and repeat is still open.
- [ ] Exit: plan a week from Claude on a phone, get the list, log a planned day.

**Phase 5: shopping checklist, weekly review, habits, safer allergies (built 2026-10-13)**
- [x] `show_grocery_list` (replaces `get_grocery_list`): MCP Apps checklist grouped by shop section; ticks are saved per person and week (`grocery_ticks`, keyed by food id so they survive regenerating the list) through the app-only `set_grocery_checked`; progress bar, hide ticked, clear. The model's reply lists every item with its tick, so Claude can say what is left.
- [x] `show_weekly_review` (+ app-only `get_review_data`): one week against the same days of the week before: calories and protein against goals, sessions and new estimated-1RM records, 7-day average weight, sleep, steps, water, meals logged from the plan; "went well" and "to consider" notes written neutrally (`analytics/review.ts`, pure). Early in the week it shows the week that just ended; arrows move between weeks.
- [x] Sleep, steps and water (`daily_metrics`) through `log_body` (water can be set or added to a glass at a time), with averages in `get_progress`, charts in the dashboard and tiles in the review. Measurement trends are charted in the dashboard (pick a measurement). Progress photos are not built: they need file storage and a bigger privacy decision.
- [x] Allergies beyond name matching: Open Food Facts allergen and trace tags are kept on packaged foods (`allergens`, `traces`), the person's words are mapped to the 14 EU allergen groups (`safety/allergens.ts`), and `log_food` and `save_meal_plan` report "contains" and "may contain traces"; packaged foods without allergen data are noted. Frida and own foods are still matched by name only.
- [x] Photo meal logging: `log_food` item flag `amount_estimated` (grams guessed from a picture; stored as an estimate) and instructions for Claude.
- [x] `import_recipe` reads a recipe page's schema.org data (https only, public hosts, 1.5 MB, 8 s, redirects re-checked; nothing is saved), `save_recipe` takes `steps` and `source_url`; migration 0007.
- [x] `suggest_meals`: saved recipes ranked by what is at home (staples ignored), fitted to today's remaining calories; recipes with allergy foods are left out.
- [x] `manage_invites` (list, add, remove unused) for the owners in `ADMIN_EMAILS`; nobody else sees it. The sign-in pages say where to ask for an invite.
- [x] Fewer tools: `delete_item` (8 kinds), `log_body`, `get_food_log`, `get_recipes`, exercise details in `search_exercises`, `check_result` on the import tool.
- [ ] Deploy: remote migration 0007, `wrangler deploy`.

**Phase 5b: feedback from the first real use (2026-10-14)**
- [x] Cardio inside a strength workout: `start_workout`, templates and `log_past_workout` take `cardio` blocks (activity, minutes, optional km, `when` before or after). The player runs them as steps with minutes and distance steppers (`log_cardio_block`, app-only); calories use the same MET estimate as `log_cardio`. They count as cardio minutes in progress and the review, not as a second workout. Migration 0008 (`cardio_blocks` on workouts and templates).
- [x] The rest screen shows what is next: the next set (or exercise) with reps × weight, last time, the progression note, the exercise note, or the next cardio block; after the final set it says to finish.
- [x] A note per exercise: in plans and templates, editable in the player (`set_exercise_note`, app-only), shown in the summary and in history, and the previous session's note appears as "Last note". Finished exercises can still be opened to change their note.
- [ ] Deploy: remote migration 0008, `wrangler deploy`.

**Phase 5c: exercise guides (2026-10-14)**
- [x] Research on exercise images: the images of free-exercise-db (our instruction source) have no known licence (the maintainer says so), wger has clear per-image CC-BY-SA licences but covers few of our exercises and almost no machines, and ExerciseDB/MuscleWiki/RepDB are commercial or unclear. Decision: no photos or illustrations for now.
- [x] `show_exercise` (view `ui://fitwell/exercise.html`) and the player's "How to do it" (`get_exercise_guide`, app-only): original front/back body drawing with primary and secondary muscles (`exercises/bodyMap.ts`), the library's steps, a "Find a demo video" button (a video search, so no link can go stale; `app.openLink`, with the search words shown when the host refuses), and our own written setup, form cues and common mistakes for 21 machine and station types plus generic cable and machine guidance (`exercises/machines.ts`; applies only to exercises with machine or cable equipment). The library's step text itself comes from free-exercise-db (Unlicense).
- [ ] Not done: photos or illustrations; a pass to rewrite the library's step text for the exercises where it is awkward.
- [ ] Deploy (no migration).

**Phase 5d: 3D exercise animation, prototype (2026-10-15)**
- [x] (Replaced by the realistic body below; the mannequin code is deleted, `ui/shared/props.ts` keeps the barbell, dumbbells, kettlebell and bench.) Own male mannequin drawn with three.js: rigid parts with ball joints and a nose wedge so the facing direction reads, procedural barbell, dumbbells, kettlebell and bench. No model file, no downloaded asset, no licence to track. Colours follow the host theme; the player only creates a WebGL context when "How to do it" is opened and stops it when closed or hidden; without WebGL the guide simply has no animation.
- [x] Movements are computed, not hand-posed (`src/exercises/motion.ts`, pure): the solvers return 3D joint positions from one progress value and enforce the rule of the lift: bar over the mid-foot in squats, bar on the floor with vertical arms at the start of a conventional deadlift, vertical forearms with the bar on the chest at the bottom of a bench press. `tests/motion.test.ts` checks segment lengths, planted feet, depth, bar clearance from the legs and joint ranges at 21 points of every movement.
- [x] Three patterns, 16 exercises, by an explicit allow-list of library names: squat (back, front, wide stance, goblet, dumbbell, bodyweight), hinge (conventional, Romanian, stiff-legged with barbell or dumbbells), bench (medium, wide, close grip, dumbbells). Shown at the top of `show_exercise` and in the player's "How to do it", with Side, Front and 45° views and play/pause. Marked as schematic.
- [x] (Replaced by the realistic body below.) Muscle layer (2026-10-15): about 30 ellipsoid muscles laid on the limbs and torso with the library's own muscle names; the muscles an exercise works are lit in the accent colour (main) and a lighter tone (secondary), with a Muscles toggle. Hands and pelvis are rounded. The muscles are tapered, belly-shaped surfaces (pointed at the tendons, fullest at a muscle-specific point) rather than ellipsoids, with a segmented six-pack. The figure is one smooth skin-toned body: the muscles are contours under the skin, joints are blended, feet and hands are rounded, and the muscles an exercise works are shown as a translucent warm tint laid over the skin (main muscles strong, helping muscles light, with a legend; the Highlight button turns the tint off). Chest, glutes and abdomen are laid out as the real muscles run (pecs as diagonal fans from the breastbone to the arm, glutes as thin diagonal plates from the sacrum to the hip, abs as two columns with the obliques at the sides); special dome and block surfaces were tried and dropped because they showed facets and a lattice. No skeleton and no visible muscle: decided with the user, who chose to keep our own figure over an anatomy model (Z-Anatomy is CC BY-SA 4.0 with some non-commercial parts, Blender-only and unrigged; rigged écorché models are paid). The first version had visible fibre textures and a plain mannequin tone, which looked rough; the texture code is still in `mannequin.ts` (`makeTextures`) but unused. Stylised on purpose: shapes are approximate, not anatomy-accurate.
- [x] Realistic body (2026-10-15, branch `mcp-human-body`): the procedural mannequin is replaced by a rigged male body made with MPFB (MakeHuman for Blender, core assets CC0) in Blender 5.2, "muscular" preset (`scripts/blender/make_body.py`, `muscle_regions.py`): 13,380 vertices, the 53-bone game-engine rig, skin weights, and per-vertex muscle weights for the library's 17 muscle groups in five attributes. Shipped as `ui/assets/body.glb.gz` (343 KB; quantized, gzipped, unzipped with `DecompressionStream`; no meshopt because its decoder is WebAssembly, which a host's CSP may refuse). `ui/shared/humanBody.ts` aims each bone at the solver's next joint (bones land within 2 mm of the joints in every pose, tested), curls the fingers around the bar, and tints the muscle groups an exercise works in the shader. The solvers take the body's measurements (`skeletonAt(spec, p, body)`), so the form rules hold for it (tested on three body sizes). There is no fallback figure: when the body cannot load (no `DecompressionStream`, a bad file) the guide simply has no animation, as it does without WebGL. Shoulders and lats are kept moderate (V-shape 0.3, lats 0.5): at full strength the back looked too wide. Muscle definition (six-pack, pec border, breastbone, spine, shoulder blades, thigh and calf lines) is drawn in the skin shader as a height field over the rest-pose position (`DEFINITION` in `humanBody.ts`), because the mesh's vertices are a centimetre apart; seams along the limbs come from the muscle weights. Worker is 2.1 MB gzipped (7.4 MB uncompressed; limit 64 MiB uncompressed on the free plan).
- [x] Free rotation and one figure for every guide (2026-10-15, branch `mcp-body-viewer`): the Side/Front/45° buttons are replaced by drag-to-turn (sideways turns, up and down tilts; on touch the page still scrolls vertically via `touch-action: pan-y`; arrow keys too; a Reset view button). The 2D Front/Back muscle drawing (`bodyMap.ts`) is deleted: every guide now shows the 3D body, animated when the exercise has a movement and in its relaxed rest pose, with the worked muscles tinted, when it has none (machines, cables and so on). The main and helping muscle names stay as text under the figure.
- [x] More movements (2026-10-15, branch `mcp-more-movements`): overhead press (standing and seated, barbell and dumbbells), bent-over row, curl, pull-up and chin-up, lat pulldown (wide, close, underhand), lunge and split squat, incline bench press, push-up (normal, wide, close): 30 more mapped exercises, each with a solver and tested form rules (bar clears the face in the press, arms vertical at the bottom of the row, chin over the bar in the pull-up, rear knee off the floor in the lunge, one straight line in the push-up, bar touching the chest surface on the incline). New props: incline bench and upright seat, pull-up bar, pulldown station with the cable following the bar. Feet are oriented from the hip line (so feet on their toes work), open hands are aimed along their fingers, and underhand grips flip the palms.
- [x] Polish (2026-10-15, branch `mcp-polish`): the torso muscle regions are drawn as anatomical outlines instead of ovals (chest fan, straight abdominal muscle and obliques, lat wings, kite-shaped trapezius, a narrow band between the shoulder blades, erector columns, glutes), so the tint on the back reads as the real muscles; soft relief for lats, trapezius and the middle back in the skin shader. The figure with no movement now stands at ease with the arms hanging and the palms toward the thighs, and breathes (shoulders lift a few millimetres, ribs and belly swell in the skin shader; off under reduced motion).
- [x] Machines, Smith machine and cables (2026-10-15, branch `mcp-machines`): 46 more exercises animated. Smith machine (8; `Variant.rails` keeps the bar on a vertical line, one frame prop). Seated and lying machines (24; leg press, leg extension, seated and lying leg curl, chest press with incline and decline, shoulder press machine, row machines, pec deck and reverse fly, bicep, preacher, triceps and dip machines, standing, seated and Smith calf raise, hip abductor and adductor): the machine fixes the handle, pad or platform and the limbs are solved to it, with a machine prop that follows the pose. Cable exercises (14; seated row, four pushdowns, cable curl, face pull, two straight-arm pulldowns, two crossovers, standing cable chest press, two cable shoulder presses): cable stations draw the pulley on a post and a cable re-aimed each frame. `motion.ts` was split into `motionKit.ts` (shared helpers), `motionMachines.ts` and `motionCable.ts`; props into `propsMachines.ts`. Left at rest: ab crunch machine (needs spine flexion), hack squat, glute-ham raise, one-arm and twisting cable exercises, cardio machines.
- [ ] Next patterns: triceps extension, lateral raise, dips, calf raise, hip thrust, crunch; decline bench; machines; a female figure. Each needs a solver with its own form rule and a review of the motion.
- Cost: both views grow from 0.6 MB to 1.2 MB (three.js, pinned 0.186.1), and to 1.7 MB with the body model; the Worker is 1.39 MB gzipped (limit 3 MB).
- [ ] Deploy (no migration).

## 6. Risks and open items
- **Free-plan CPU (10 ms/request)**: first request in an isolate parses the datasets; measure on the real edge after the first deploy. If needed, move search indexes to D1 FTS.
- **D1 daily limits** fail hard on the free plan; add a usage check to the dashboard tool.
- **Open Food Facts** text search is intermittently 503 (see web TECH_SPEC); cache in D1, barcode lookups are more reliable. Rate limiting is per isolate only.
- **Tool count**: 36 tools visible to the model (41 with the app-only ones), about 9,600 tokens of definitions that every conversation reads. Phase 5 merged the small delete/list pairs (47 → 36 visible while adding features), but the definitions did not get smaller: merged tools carry bigger schemas. Next lever if it matters: hide rarely used tools behind a single `help` tool.
- **View bundle size**: the player is 597 KB (129 KB gzip), almost all zod pulled in by the MCP Apps SDK; our code is 6 KB. Fine for the spike; look for a slimmer import before phase 2.
- **Player state** lives in the view only during phase 0b; a reload of the conversation loses progress until sets are stored (phase 1/2).
- **EU jurisdiction for D1**: confirm the current setting and that it is available on the free plan before creating the database.
- **Email sending on the free plan** works only to verified destination addresses, and Cloudflare marks outbound sending as beta. Confirm the `send_email` binding behaviour when building phase 1. Fallback: Workers Paid (about $5/month, sends to anyone).
- **GDPR**: privacy notice, consent record, export and delete in phase 1; Cloudflare DPA applies.
