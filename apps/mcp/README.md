# Fitwell for Claude (`@fitwell/mcp`)

A remote MCP server on Cloudflare Workers that lets Claude log food, plan meals, build and run workouts, and show progress. Plan, decisions and phases: [PLAN.md](PLAN.md). What comes next: [ROADMAP.md](ROADMAP.md).

**Status: phases 1 to 4 are deployed; phase 5 (shopping checklist, weekly review, sleep/steps/water, allergen data, recipe import, tool merge) is built and tested locally.** Invite-only email sign-in (OAuth 2.1), and per-person data in D1: profile, goals, food log, own foods, workouts, templates, weight and measurements, with a progress dashboard, recipes, weekly meal plans and a grocery list.

| Area | Tools |
|---|---|
| Profile and goals | `get_profile`, `update_profile` (also bar and plates), `suggest_targets` (Mifflin-St Jeor, or the measured burn with `expenditure_kcal`; nothing saved), `set_goals` (calories, macros, fibre, saturated fat and added sugar, hours of sleep a night, workouts a week, goal weight; only what is given changes, `null` clears) |
| Foods | `search_foods` (own foods, Frida, optionally Open Food Facts; an older cached answer when OFF is down), `lookup_barcode`, `save_custom_food` (label values checked; per 100 g or per serving) |
| Food log | `log_food` (several items; saved recipes by name; `copy_from` another day or meal; macros resolved from the source; estimates marked; allergy warnings), `get_food_log` (a day, or several), `edit_food_entry`, `save_custom_food` |
| Exercises and workouts | `search_exercises` (with `id` for instructions, `similar_to` for substitutes), `show_muscle_map` (weekly hard sets per muscle on the 3D body, against 10–20), `show_exercise` (guide with muscle drawing, steps, machine setup and, for some lifts, a 3D animation), `start_workout` (opens the player, a row of cards you swipe through: an overview, one card per exercise or cardio block, and a finish card with the summary and new bests; saves the workout; weights from the progression rule; warm-up ramps, supersets, timed sets, plates per side; swap an exercise in the player, and swap back; edit or undo the last set; unsaved changes are retried and shown), `log_set` and `finish_workout` (from the player), `get_workout_history`, `suggest_progression`, `save_workout_template`, `list_workout_templates`, `log_cardio`, `log_past_workout`, `edit_workout_set` (fix one logged set from the chat) |
| Body and progress | `log_body` (weight, measurements, sleep, steps, water), `get_progress` (with the burn measured from logs and weigh-ins, and the goal date), `show_dashboard` (opens the dashboard), `show_lift_progress` (one lift: estimated 1RM line with new bests, rep records at 1, 3, 5 and 8, last 10 sessions), `show_weekly_review` (the week against the one before, with a calorie check-in) |
| Meals | `get_planning_context`, `save_recipe`, `import_recipe` (from a web page), `get_recipes`, `suggest_meals` (what can I cook), `save_meal_plan` (checked against goals, allergies, dislikes), `get_meal_plan`, `show_grocery_list` (tick-off checklist), `log_planned_meal` |
| Anything | `delete_item` (food entry, workout, template, recipe, meal plan, weigh-in, measurements, daily metrics) |
| Owner only | `manage_invites` (list, add, remove unused invitations), for emails in `ADMIN_EMAILS` |
| Import | `import_fitwell_backup` (one-time upload link for a backup file from the retired Fitwell web app; `check_result` reports the outcome) |
| Account | `export_my_data`, `delete_my_account` (erases everything, signs out everywhere) |

**Landing page:** `https://fitwell.fyi` explains Fitwell for Claude with screenshots and how to join (see [apps/landing](../landing/README.md)). `/` here, and the old `/about/` page, redirect there. The screenshots it shows come from the views: regenerate them with `npx tsx scripts/screenshots.ts` (needs `npm run dev`, `npm run dev:host` and the demo person's local data; it writes `<name>-light.png` and `<name>-dark.png` into `apps/landing/site/src/assets`). `scripts/backfill-extras.ts` fills fibre, sugars and fats into entries logged before they were stored.

**Morning brief (optional):** Claude can look at Fitwell every morning on its own with a scheduled task (Claude desktop or Cowork, paid plans; connectors are attached to the task). Create a daily task with a prompt like:

> Using Fitwell: get my food log for today and what remains of my goals, today's planned meals (get_meal_plan), and my progress for the last 7 days (get_progress). Give me a short morning brief: what to eat today, whether a workout is due, and one thing to watch from last week.

Use the text tools (`get_food_log`, `get_meal_plan`, `get_progress`), not the `show_*` views: a scheduled run has nobody to show a view to, and some hosts drop it.

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
npm run dev
```

On `http://127.0.0.1:8787/mcp`, requests *without* a token run as a local dev person (`dev@localhost`), so tools are easy to try:

```bash
npm run smoke -w @fitwell/mcp
```

To try the real sign-in locally, invite a test address and connect any MCP client to the same URL. Local sign-in emails are not sent; Wrangler prints the path of each one in its output.

```bash
npm run invite -w @fitwell/mcp -- tester@fitwell.test
```

To see the workout player or the dashboard the way Claude shows them, run a local MCP Apps host and open http://127.0.0.1:8788 (add `?view=dashboard` for the dashboard, or `?sample=cards|resumed|superset|timed|cardio-heavy|many|closed|finished|finished-norecord` for a player state and `?fail=log|send|finish` to make a save, the message to Claude or the summary fail; `/raw/dashboard` serves a view as a plain page to see console errors):

```bash
npm run dev:host -w @fitwell/mcp
```

| Command | What it does |
|---|---|
| `npm run check -w @fitwell/mcp` | typecheck + lint + tests (a real MCP client against the Worker's fetch handler, Open Food Facts stubbed) |
| `npm run build:ui -w @fitwell/mcp` | Bundle each view in `ui/<name>` into one HTML string (`src/ui/generated`, git-ignored); runs automatically before dev, deploy, typecheck and tests |
| `npm run invite -w @fitwell/mcp -- <email> [--remote]` | Add someone to the invite list (local or deployed database). On the free plan they must also be a verified destination address in Email Routing |
| `npm run seed:review -w @fitwell/mcp -- [--apply local\|remote]` | Fill the directory reviewers' demo account (`review@fitwell.fyi`) with 12 weeks of history; it signs in with the `REVIEW_LOGIN` secret. See [REVIEW.md](REVIEW.md) |
| `npm run types -w @fitwell/mcp` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |

Data sources: Frida 5.5, DTU National Food Institute (CC BY 4.0); Open Food Facts (ODbL); free-exercise-db (The Unlicense). Tool results carry the attribution.
