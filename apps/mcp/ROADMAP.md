# Fitwell for Claude: long-term roadmap

What comes after the phases in [PLAN.md](PLAN.md). Drafted 2026-10-15 from a brainstorm with research on comparable tools. Six themes: smarter coaching, friends, wearables, faster logging, nudges that work without a phone app, streaks with shareable celebrations, and support for ChatGPT, plus the foundations they need.

## 1. Ground rules (from PLAN.md, unchanged)

| Rule | What it means for new features |
|---|---|
| The server never calls an LLM | "Smart" features are deterministic, tested functions in `@fitwell/core`; Claude explains them and asks before saving. |
| Free plan, stateless Worker, D1 (EU) | No Durable Objects. Cron Triggers for anything scheduled. Every new table indexed by `(user_id, …)`; watch D1 daily limits. |
| Health data is GDPR Art. 9 | Nothing is shared between people by default. Every share is explicit, per category, revocable, recorded, and covered by `export_my_data` and `delete_my_account`. |
| Claude chat is the main surface | The server cannot push into a chat. Proactive features use email (`send_email`, invitees are verified addresses) or a Claude scheduled task calling the connector. ChatGPT is a second host on the roadmap (theme G); Claude stays the one the views and tool descriptions are tuned for. |
| Images people share are made in the view | A share card is drawn in the person's own view and saved or copied by them. The server never renders, stores or posts it, and nothing is shared unless they press the button. |

Out of scope: a native mobile app, public sign-up, billing, server-side LLM calls.

## 2. Themes

Effort: S (a day or two), M (a few days), L (a week or more).

### A. Smarter coaching
| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| A1 | **Adaptive expenditure and weekly check-in**: real TDEE from intake and the weight trend (intake − Δtrend weight × ~7700 kcal/kg, smoothed over 2–4 weeks, tolerant of missing days); a suggested calorie target for the goal rate; goal-date projection | `movingAverage`, `trendChange`, `aggregateDays` (`core/domain/stats.ts`), `suggestTargets` (`core/domain/energy.ts`), `show_weekly_review`, `get_progress`, `set_goals` | M | Phase 6 |
| A2 | Supersets and timed sets (open from phase 2), plate calculator, warm-up ramp in the player | `ui/workout`, `workout/plan.ts`, core `workouts.ts` | M | Phase 6 |
| A3 | Exercise swap: ranked substitutes by primary muscle, pattern and the equipment in the profile | `search_exercises`, free-exercise-db fields | S | Phase 6 |
| A4 | Programs: blocks of N weeks of templates, progression scheme (linear, double progression, %-of-e1RM waves), scheduled deload; `start_workout` offers "Week 3, Day B" | templates, `suggestProgression` (`core/domain/progression.ts`) | L | Phase 9 |
| A5 | RPE/RIR per set and autoregulated progression (easier than target adds load, harder holds or reduces) | player, `suggestProgression` | M | Phase 9 |
| A6 | Weekly sets per muscle against ranges; flags under- and over-trained groups | `setsPerWeekByMuscle` in `analytics/progress.ts` | S | Phase 9 |
| A7 | Micronutrients (fibre, sodium, iron, B12 …) and protein per meal | the Frida 5.5 dataset has them, but the bundle keeps only energy and macros: extend `packages/core/scripts/build-foods.ts` and watch the Worker size; `get_food_log`, review | M | Phase 9 |
| A8 | Readiness: sleep, resting HR, HRV and a one-tap soreness/energy check-in suggest a lighter day | C1, `start_workout` | M | Phase 10+ |
| A9 | Diet breaks and refeeds in long cuts; more 3D movements and a female figure (see PLAN.md 5d) | A1, `exercises/motion.ts` | M | Phase 10+ |
| A10 | **Muscle heatmap** on the 3D body, answering "how well is each muscle trained?": weekly hard sets per muscle group (a set counts 1 for a main muscle, 0.5 for a helping one) against the usual 10–20 range, coloured not trained / under / in range / over, over 1, 4 or 12 weeks; drag to turn; a list with the numbers, top exercises and last trained day per muscle (colour is never the only signal). The model's reply has the same numbers. Later modes: strength progress (e1RM trend per muscle) and recovery (time since each muscle was trained hard) | `humanBody.ts` (per-vertex weights for the 17 `BODY_MUSCLES`; a heat mode in the shader), the exercise view's body, library primary/secondary muscles | M | Phase 6 (sets against the range); Phase 9 (strength, recovery) |

### B. Friends
Foundation (with B1): a `connections` table (requester, addressee, status) and a `shares` table (who may see which category of whose data). Categories: workouts and records / consistency only / templates and recipes / weight and body (off, never in feeds). One new tool, `friends` (invite, accept, list, set_sharing); invitations reuse `manage_invites` and the sign-in email.

| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| B1 | **Send a template, recipe or meal plan** to a friend; they get a copy when they accept (snapshot, no ongoing visibility) | templates, recipes and plans already stored as snapshots | M | Phase 7 |
| B2 | Household: one meal plan and one set of grocery ticks for people who cook together; own portions and goals each | `save_meal_plan`, people scaling in the grocery list, `grocery_ticks` | M | Phase 7 |
| B3 | Crew feed (MCP Apps view): friends' finished workouts, records and streaks, per their share settings, with kudos | B foundation, `finish_workout` summary | M | Phase 9 |
| B4 | Challenges: time-boxed, opt-in, consistency-based (workouts per week, protein days, steps), rest-day friendly, leaderboard view; a cron closes them and emails results | B3, cron | M | Phase 9 |
| B5 | Accountability buddy: opt-in weekly email to a chosen friend | E1 digests | S | Phase 10+ |
| B6 | Train together: same template, side-by-side summary | B3 | M | Phase 10+ |

### C. Wearables and data in
One ingest path: values are normalised into `daily_metrics` (extended with resting HR, HRV, sleep stages) and cardio `workouts`, de-duplicated by source and external id, with the source stored on each value. A value typed by the person always wins. Only normalised values are kept, never raw payloads.

| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| C1 | **Personal ingest webhook**: a long-lived, hashed, revocable secret URL per person that accepts JSON. Apple Health without a native app (the Health Auto Export app's REST automation, or an iOS Shortcut): steps, sleep, resting HR, HRV, weight, workouts. Also carries Garmin/Oura/Whoop data that syncs into Apple Health | the import link token pattern (`import/routes.ts`, `import/store.ts`), `log_body` | M | Phase 8 |
| C2 | Strava OAuth and webhook: runs and rides as cardio, device calories when present | `log_cardio`, MET fallback | M | Phase 8 |
| C3 | Direct APIs: Withings (scales), Oura, Whoop, Polar; a cron refreshes tokens and pulls daily. Garmin's official API needs business approval, so Garmin goes through Apple Health or Strava | C1 pipeline, cron | M each | Phase 10+ |

### D. Faster logging
| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| D1 | **Re-log and combos**: "same breakfast as yesterday", "copy Monday's lunch", named meal combos (a group of foods that is not a recipe) | `log_food` (`tools/foodLog.ts`), most-eaten foods in `get_planning_context` | S | Phase 6 |
| D2 | Label photo → own food with checks: kcal against 4/4/9 × macros within ~10 %, per-100 g conversion, impossible values refused | `save_custom_food` | S | Phase 6 |
| D3 | Today view (MCP Apps): remaining macros, today's planned meals with one-tap "eaten", frequent foods as quick-add, water and steps, today's workout | `log_planned_meal`, `get_food_log`, dashboard view | M | Phase 8 |
| D4 | Restaurant estimates with a range (store the midpoint, marked as an estimate); the review reports the share of estimated calories | `log_food` estimates | S | Phase 8 |
| D5 | Shared food corrections within the friend group | B foundation, `save_custom_food` | M | Phase 10+ |

### E. Nudges
| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| E1 | Email digests by cron: Sunday review summary, "nothing logged since Tuesday", challenge results; each opt-in in `update_profile`, with an unsubscribe link | `send_email`, `analytics/review.ts` | M | Phase 7 |
| E2 | Morning brief: README recipe for a Claude scheduled task that opens the dashboard or Today view every morning | none (docs only) | S | Phase 6 |

### F. Streaks and celebrations
A streak counts weeks (or days for logging) in which a target was met, so a rest day or a busy week does not break it unfairly. Targets come from the profile: workouts per week, a logging target and a goal weight. Everything is computed from the logs by pure functions in `@fitwell/core` (no new source of truth); only milestones already celebrated are stored, so each is celebrated once.

| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| F1 | **Streak engine** in `packages/core/src/domain/streaks.ts`: (a) training streak: consecutive weeks with at least the weekly workout target (3, 5, 7 … workouts a week; one planned rest week or "freeze" allowed, see §4); (b) logging streak: consecutive days with at least one meal logged, and weeks where the logging target was met (for example 5 of 7 days); (c) goal progress and reached: weight goal (loss or gain, by trend weight, not one weigh-in), plus workouts-per-week and protein-day targets. Milestones at 1, 2, 3, 5, 7, 14, 21, 30, 52 weeks; tested against hand-built calendars (gaps, missing days, time zones, week start) | `aggregateDays`, `movingAverage`, goals (`set_goals`), `analytics/review.ts`, `weekStart` in core | M | Phase 7 |
| F2 | `get_streaks` (text: current and best streaks, next milestone, how far to go) and an `achievements` table `(user_id, kind, threshold, achieved_at, celebrated_at)`; `show_weekly_review` and `get_progress` mention the streak; export and delete cover the table | F1, `daily_metrics`, review tools | S | Phase 7 |
| F3 | **Celebration view** (MCP Apps): opens when a milestone is reached ("7 weeks of training 3 times a week", "goal weight reached", "30 days of logging"), with a calm confetti-free animation (respects reduced motion), the number, what it took (workouts, logged days, sets) and what is next. Claude opens it after `finish_workout`, after a logging call or in the weekly review, and only once per milestone | F2, `finish_workout` summary, the shared view helpers in `ui/shared` | M | Phase 7 |
| F4 | **Share card**: from the celebration view, "Make a card" draws a picture on a canvas in the view, in the formats social apps use (4:5 feed 1080×1350, 9:16 story 1080×1920, 1:1 square), in light or dark, with the person's name (optional, off by default), the milestone and a few numbers they choose. Saved or copied by the person (a download or the host's file or clipboard support; where the host sandbox blocks both, the view shows the image to long-press and Claude says so). Claude can suggest a caption in the reply. Weight is never on a card unless the person turns it on for that card, and the preview shows exactly what leaves the app (the same rule as Friends: body data off by default) | F3, canvas drawing in the view (no server rendering, no image storage), host capabilities check | M | Phase 7 |
| F5 | Streaks in the crew feed and challenges: consistency only, never weight | F1, B3, B4 | S | Phase 9 |
| F6 | Streak nudges by email: "your 7-week streak is safe, one workout to go this week", opt-in with the digests | F1, E1 | S | Phase 10+ |

### G. More hosts: ChatGPT
Fitwell is a standard remote MCP server (Streamable HTTP, OAuth 2.1 with dynamic registration or Client ID Metadata Documents, MCP Apps views, a text result for every view tool), so ChatGPT should connect without a rewrite. What is unproven is how it treats the parts the views depend on, above all the workout player. Research on 2026-10-18 (secondary sources, not tested): custom connectors work through Developer Mode; individual plans may be limited to read tools, so write tools (logging) might need Business, Enterprise or Edu; the MCP Apps announcement lists ChatGPT among supporting clients; Gemini lists no MCP Apps support yet and takes custom servers only on personal US accounts (consumer) or through an admin (Enterprise).

| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| G1 | **Compatibility spike**: add the server to ChatGPT (Developer Mode) and walk a checklist: sign-in with the invite flow, `get_food_log` and `log_food` (are write tools allowed on the plan used), each view renders (`show_dashboard`, `show_weekly_review`, `show_grocery_list`, `show_exercise`, `show_muscle_map`, the player), the player's calls from inside the view (`log_set`, `swap_exercise`, app-only tools hidden from the model), `sendMessage` and `updateModelContext` from the view, theme and safe area, links, vibration. Record results per host in a table in `apps/mcp/README.md` | `dev-host` (only mimics Claude), the OAuth provider | S | Phase 8 |
| G2 | **Fallbacks for hosts without the player**: a model-visible way to log a set during a workout in chat (today `log_set` is app-only), `start_workout` returning the plan as a readable checklist, and a short "how to run it without the player" line in the server instructions; no change for Claude | `tools/workout.ts`, `instructions/` | M | Phase 8, only if G1 shows gaps |
| G3 | Host-aware tool descriptions and instructions: neutral wording ("the chat", not "Claude") where the model is addressed, checked against the same eval prompts on each host | `src/instructions`, tool descriptions | S | Phase 8 |
| G4 | Listing: OpenAI's app directory requirements (submission, review account like `REVIEW.md`, privacy text, screenshots) and, if Google opens one, Gemini's; the scheduled morning brief stays Claude-only, documented | `directory/`, `REVIEW.md`, `/privacy` | M | Phase 10+ |
| G5 | Gemini: revisit when it supports MCP Apps; until then text answers only (the tools already work without views) | G1 results | S | Later |

## 3. Phases and exit criteria

**Phase 6: foundations and quick wins**
- [ ] Deploy the backlog: remote migrations 0007, 0008 and 0009, `wrangler deploy` (phases 5–5d and 6).
- [-] D1 usage: dropped (2026-10-16). Cloudflare's dashboard already shows D1 rows read and written per day and per query; a handful of people is far from the free plan's limits, and counting in code would add writes of its own.
- [-] Cron: moved to phase 7, built with its first job (E1 email digests) rather than as an empty scaffold.
- [x] Open Food Facts: when OFF fails, an older cached answer is served (`data/offCache.ts`). No retry inside a request: after a 503 the client already pauses its rate limiter for up to 30 s.
- [x] A1: `estimateExpenditure()` and `projectGoalDate()` in `packages/core/src/domain/energy.ts`, pure, tested against hand-computed weeks (steady loss, plateau, missing days, too little data → no estimate); shown in `show_weekly_review` (`analytics/review.ts`) and `get_progress` (`tools/body.ts`); Claude proposes, `set_goals` only after agreement.
- [x] D1: `log_food` takes `copy_from` (a day, or one meal of it) and `recipe` items: a usual meal is a saved recipe logged by name, so combos need no new table; allergy checks run on copies and recipe ingredients.
- [x] D2: `save_custom_food` checks label values (`labelProblems` in core: impossible values always refused, a kcal/macro mismatch refused once with the reason and a kJ hint, `values_checked` to confirm) and takes per-serving values.
- [x] A2: supersets (`superset` letters; the player goes round by round, rest after the round), timed sets (`seconds`; a countdown in the player), warm-up ramps (automatic for heavy barbell compound lifts: full for the first, short for later ones, `warmup` to choose; never counted in summaries or progression), plate calculator (`platesFor` in core; the person's bar and plates in the profile, migration 0009).
- [x] A3: `substitutes()` in core (same main muscles and kind of exercise; ranked by muscle overlap, push/pull, compound/isolation; profile equipment, bodyweight always counts); `search_exercises` with `similar_to` and `exclude_equipment`; a "Swap exercise" panel in the player (app-only `get_substitutes`, `swap_exercise`) until the first set is logged, keeping sets, reps, rest and the plan's note, with the weight from the new exercise's history.
- [x] A10 muscle heatmap: `buildMuscleMap()` (`analytics/muscles.ts`, tested against hand-counted sets), `show_muscle_map` and the app-only `get_muscle_map`, drawn by the exercise view (it already carries three.js and the body, so the Worker grows by 4.5 KB instead of another 1.7 MB view); a heat mode in `humanBody.ts`; colours for light and dark; period switch keeps the figure's angle.
- [x] E2: morning brief section in `apps/mcp/README.md` (a Claude scheduled task; text tools only, since a scheduled run shows no views).
- [ ] Exit: after a week of real logging, "how am I doing this week?" gives an expenditure estimate and a suggested target; "same breakfast as yesterday" logs in one call; "which muscles did I train this month?" shows the heatmap with the numbers in the reply.

**Phase 7: friends v1 and streaks**
- [ ] Decisions in §4 agreed.
- [ ] F1 streak engine in core with calendar tests; F2 `get_streaks` and the `achievements` table (export and delete cover it).
- [ ] F3 celebration view; F4 share card (4:5, 9:16, 1:1; light and dark; weight off by default; the preview matches what is saved).
- [ ] `connections` and `shares` tables, the `friends` tool, consent records; export and delete cover them; isolation tests extended (no share means no access).
- [ ] B1 send a template, recipe or plan; B2 household plan and ticks.
- [ ] Cron: `triggers.crons` in `wrangler.jsonc` and a `scheduled()` handler next to `fetch` in `src/index.ts`, tested with `wrangler dev --test-scheduled`.
- [ ] E1 email digests (first cron job).
- [ ] Exit: two invitees connect, one sends a push day, the other runs it; a couple plans a week and ticks one grocery list; reaching a seven-week training target opens the celebration once, and the person saves a story-sized card without any weight on it.

**Phase 8: data in and ChatGPT**
- [ ] C1 ingest webhook with per-person token; Health Auto Export and Shortcut setup in the README; sources shown in `get_progress`.
- [ ] C2 Strava.
- [ ] D3 Today view; D4 restaurant estimates.
- [ ] G1 ChatGPT compatibility spike with the results table in the README; G2 fallbacks if the player does not work there; G3 host-neutral wording.
- [ ] Exit: a day of Apple Health steps, sleep and weight appears without typing; a Strava run shows up as cardio; a ChatGPT user on a plan that allows it logs a meal and sees the dashboard, and the table says what works where.

**Phase 9: coaching v2 and crew**
- [ ] A4 programs with deloads; A5 RPE/RIR; A6 volume ranges; A10 strength and recovery modes; A7 micronutrients.
- [ ] B3 crew feed; B4 challenges; F5 streaks in both (consistency only).
- [ ] Exit: a 4-week block with a deload runs from "start today's workout"; a 4-week challenge closes and emails results.

**Phase 10 and later**
- [ ] A8 readiness, A9; C3 direct device APIs; B5, B6; D5; F6 streak nudges; G4 ChatGPT directory listing; G5 Gemini when it supports MCP Apps.
- [ ] Progress photos (needs R2 storage and its own privacy decision).

## 4. Decisions to make before phase 7
- **Visibility defaults.** Proposal: nothing shared by default; weight and body never in feeds, only to an accountability buddy who was chosen explicitly.
- **Challenges and weight.** Proposal: consistency metrics only, never weight or body fat.
- **Wearable data retention.** Proposal: keep normalised values only; drop raw payloads after processing.
- **Streak rules.** Proposal: weekly streaks for training (a week counts when the workout target is met; one rest or sick week per 12 weeks, or a freeze the person sets, keeps the streak), daily plus weekly-target streaks for logging ("logged" means at least one meal, not a full day, so partial days do not punish); milestones 1, 2, 3, 5, 7, 14, 21, 30, 52. Weight goals use the trend, count as reached after 7 days at or past the goal, and never feed a streak (no streak for losing weight).
- **Share cards.** Proposal: drawn in the view only; name and numbers chosen per card; weight and body data off by default and never in the default caption; no logo or watermark requirement, a small "Fitwell for Claude" line the person can remove.
- **ChatGPT scope.** Proposal: run the G1 spike on one plan that allows write tools before promising support; Claude remains the primary, documented host.

## 5. Research notes
- Lifters typically pair a log (Hevy, Strong) with a nutrition app (MacroFactor); Fitwell already joins the two, which is the gap reviewers mention most.
- MacroFactor's core is the expenditure estimate from logged intake and weight with weekly target changes; the window length trades stability against responsiveness ([V3 algorithm](https://macrofactor.com/expenditure-v3/)).
- Autoregulation (RPE-based load changes) showed a modest strength advantage over fixed loading in a meta-analysis summarised in a 2026 comparison; programs with built-in deloads are standard in Boostcamp, Alpha Progression and others.
- Streaks: weekly targets and rest allowances keep motivation without rewarding overtraining; streak loss can discourage, so the engine forgives one gap and celebrates milestones once (no repeats).
- Hosts: ChatGPT custom connectors need Developer Mode and may restrict write tools by plan ([guide](https://coworker.ai/blog/chatgpt-mcp)); the MCP Apps announcement lists ChatGPT, Claude, Goose and VS Code Insiders ([blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)); Gemini custom apps are limited to personal US accounts ([help](https://support.google.com/gemini/answer/17209137?hl=en&co=GENIE.Platform%3DDesktop)).
- Social features: friend groups seeing each other's activity and time-boxed challenges recur as retention levers; challenge windows that are too tight put busy people off ([study](https://www.theseus.fi/handle/10024/887910)). Rest-day-friendly streaks avoid rewarding overtraining.
- Health data: Apple Health has no web API (exports or a companion app, e.g. Health Auto Export's REST automation); Oura, Whoop, Withings, Polar and Strava have personal OAuth APIs; Garmin's needs business approval.
