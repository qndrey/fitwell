# Fitwell for Claude: long-term roadmap

What comes after the phases in [PLAN.md](PLAN.md). Drafted 2026-10-15 from a brainstorm with research on comparable tools; brought in line with what shipped on 2026-10-24. Eight themes: smarter coaching, friends, wearables, faster logging, nudges that work without a phone app, streaks with shareable celebrations, support for ChatGPT, and getting new people started, plus the foundations they need.

## 1. Ground rules (from PLAN.md)

| Rule | What it means for new features |
|---|---|
| The server never calls an LLM | "Smart" features are deterministic, tested functions in `@fitwell/core`; Claude explains them and asks before saving. |
| Free plan, stateless Worker, D1 (EU) | No Durable Objects. Cron Triggers for anything scheduled. Every new table indexed by `(user_id, …)`; watch D1 daily limits. |
| Health data is GDPR Art. 9 | Nothing is shared between people by default. Every share is explicit, per category, revocable, recorded, and covered by `export_my_data` and `delete_my_account`. |
| Claude chat is the main surface | The server cannot push into a chat. Proactive features use email (Resend from fitwell.fyi since 2026-10-24, so any address works; `auth/mailer.ts` falls back to Cloudflare's binding without `RESEND_API_KEY`) or a Claude scheduled task calling the connector. Every email that is not a sign-in or an invite needs an opt-in and an unsubscribe link. ChatGPT is a second host on the roadmap (theme G); Claude stays the one the views and tool descriptions are tuned for. |
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
| A5 | Effort per set and autoregulated progression (easier than target adds load, harder holds or reduces). **Effort shipped** (#59): an optional Easy / Solid / Hard / Max tap on working sets (`EFFORT_LABELS` in `workout/plan.ts`), stored and shown in history, the summary and export. **Progression shipped** (phase 6c): a hit with every set Easy adds two steps, Solid or Hard one, any Max holds; no effort keeps the plain rule; the reason names the effort | `effort` on stored sets, `suggestProgression` (`core/domain/progression.ts`) | S | Phase 6c |
| A6 | Weekly sets per muscle against ranges; flags under- and over-trained groups. **Mostly shipped** with A10: the muscle map colours each group under / in range / over and lists the numbers. **Left:** a plain verdict per group in the weekly review and `get_progress` | `analytics/muscles.ts`, `analytics/review.ts` | S | Phase 9 |
| A7 | Micronutrients and protein per meal. **Partly shipped** (migration 0010): fibre, sugars, added sugar, saturated and trans fat and salt on foods and entries, with goals for fibre, saturated fat and added sugar. **Left:** iron, B12, calcium, vitamin D and the rest, and protein per meal | the Frida 5.5 dataset has them, but the bundle keeps only energy, macros and the extras: extend `packages/core/scripts/build-foods.ts` and watch the Worker size; `get_food_log`, review | M | Phase 9 |
| A8 | Readiness: sleep, resting HR, HRV and a one-tap soreness/energy check-in suggest a lighter day | C1, `start_workout` | M | Phase 10+ |
| A9 | Diet breaks and refeeds in long cuts; more 3D movements and a female figure (see PLAN.md 5d) | A1, `exercises/motion.ts` | M | Phase 10+ |
| A10 | **Muscle heatmap** on the 3D body, answering "how well is each muscle trained?": weekly hard sets per muscle group (a set counts 1 for a main muscle, 0.5 for a helping one) against the usual 10–20 range, coloured not trained / under / in range / over, over 1, 4 or 12 weeks; drag to turn; a list with the numbers, top exercises and last trained day per muscle (colour is never the only signal). The model's reply has the same numbers. **Shipped:** sets against the range (phase 6), then the change against the period before and a recovery mode, days since each muscle was trained (#65). **Left:** a strength mode (e1RM trend per muscle) | `humanBody.ts` (per-vertex weights for the 17 `BODY_MUSCLES`; a heat mode in the shader), the exercise view's body, library primary/secondary muscles | M | Phase 9 (strength) |
| A11 | **Injuries and limitations in the profile**: what the person said (body area, what hurts, what to avoid, since when, optional end date), so it is not asked again in every chat. `start_workout`, templates and `search_exercises` flag exercises that load the area, and the substitutes rank around it. Claude asks before saving and never diagnoses; the trainer instructions already ask about pain before programming | `update_profile`, `get_profile`, `substitutes()` in core, library primary muscles, `instructions/trainer.md` | S | Phase 6c |

### B. Friends
Foundation (with B1): a `connections` table (requester, addressee, status) and a `shares` table (who may see which category of whose data). Categories: workouts and records / consistency only / templates and recipes / weight and body (off, never in feeds). One new tool, `friends` (invite, accept, list, set_sharing); invitations reuse the sign-in email and build on `users.invited_by` (shipped with H4: `invite_friend`, members invite friends by email, no connection or sharing yet).

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
| D6 | **Meal plan view** (MCP Apps), open since phase 4: the week as days and meals against the calorie and protein goals, swap a meal for a saved recipe or another day's meal, repeat a day, tick "eaten" (`log_planned_meal`), and a link to the shopping list. Edits save through app-only tools with the same checks as `save_meal_plan` (goals, allergies, dislikes). B2 households reuse it | `get_meal_plan` (`editable` form), `save_meal_plan`, `log_planned_meal`, `suggest_meals`, the cards shell in `ui/shared` | M | Phase 8 |

### E. Nudges
| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| E1 | Email digests by cron: Sunday review summary, "nothing logged since Tuesday", challenge results; each opt-in in `update_profile`, with an unsubscribe link (and the `List-Unsubscribe` header, which inbox providers expect from bulk senders) | `auth/mailer.ts` (Resend), `analytics/review.ts` | M | Phase 7 |
| E2 | Morning brief: README recipe for a Claude scheduled task that opens the dashboard or Today view every morning | none (docs only) | S | Phase 6 |

### F. Streaks and celebrations
A streak counts weeks (or days for logging) in which a target was met, so a rest day or a busy week does not break it unfairly. Targets come from the profile: workouts per week, a logging target and a goal weight. Everything is computed from the logs by pure functions in `@fitwell/core` (no new source of truth); only milestones already celebrated are stored, so each is celebrated once.

The dashboard's consistency calendar (a 12 × 7 grid of trained days with "3/3" per week, in `ui/shared/chart.ts`, #58) is already built for F1 and F3 to reuse.

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
| G1 | **Compatibility spike**, done by the owner by hand before anything else in G: add the server to ChatGPT (Developer Mode) and walk a checklist: sign-in with the invite flow, `get_food_log` and `log_food` (are write tools allowed on the plan used), each view renders (`show_dashboard`, `show_weekly_review`, `show_grocery_list`, `show_exercise`, `show_muscle_map`, the player), the player's calls from inside the view (`log_set`, `swap_exercise`, app-only tools hidden from the model), `sendMessage` and `updateModelContext` from the view, theme and safe area, links, vibration. Record results per host in a table in `apps/mcp/README.md` | `dev-host` (only mimics Claude), the OAuth provider | S | Phase 8 |
| G2 | **Fallbacks for hosts without the player**: a model-visible way to log a set during a workout in chat (today `log_set` is app-only), `start_workout` returning the plan as a readable checklist, and a short "how to run it without the player" line in the server instructions; no change for Claude | `tools/workout.ts`, `instructions/` | M | Phase 8, only if G1 shows gaps |
| G3 | Host-aware tool descriptions and instructions: neutral wording ("the chat", not "Claude") where the model is addressed, checked against the same eval prompts on each host | `src/instructions`, tool descriptions | S | Phase 8 |
| G4 | Listing: OpenAI's app directory requirements (submission, review account like `REVIEW.md`, privacy text, screenshots) and, if Google opens one, Gemini's; the scheduled morning brief stays Claude-only, documented | `directory/`, `REVIEW.md`, `/privacy` | M | Phase 10+ |
| G5 | Gemini: revisit when it supports MCP Apps; until then text answers only (the tools already work without views) | G1 results | S | Later |

### H. Getting started
Since 2026-10-24 people can ask for an invite at `/request-access` and the owner approves them from Claude (`manage_invites`), so new people now arrive who were not set up by hand. These items help them get going and bring their history with them.

| # | Feature | Builds on | Effort | When |
|---|---|---|---|---|
| H1 | **First session** (shipped in phase 6c): on a new account's first `get_profile` (nothing saved: no goals, logs, workouts, templates, body data, own foods, recipes or plans, and nothing about them in the profile), the result adds a setup guide (`instructions/setup.md`) after the JSON: first do what they asked, then profile and equipment, `suggest_targets` then `set_goals` after agreement, a first template or workout, and the first meal logged; it ends with things to ask next rather than an empty dashboard. Every step skippable, "not now" ends it; `users.setup_offered_at` (migration 0016) makes it once only. The server instructions ask Claude to call `get_profile` at the start of a conversation | `get_profile` result text, `instructions/`, `suggest_targets`, `save_workout_template` | S | Phase 6c |
| H2 | **Import from other apps**: workout history from Hevy and Strong (CSV exports), food logs and weigh-ins from MyFitnessPal and MacroFactor exports. Same path as the Fitwell backup: a one-time upload link, the file parsed in the browser and sent in chunks, `INSERT OR IGNORE`, skipped rows counted with a reason. Exercise names are matched to the library (unmatched ones become own exercises, listed for the person to check); foods come in as marked estimates with their macros, not matched to Frida | `import/routes.ts`, `import/convert.ts`, `import/store.ts`, `search_exercises` | M | Phase 8 |
| H3 | **Claude Connectors Directory listing**: submit with the screenshots and prompts already in `directory/`, the review account in `REVIEW.md` and the privacy notice. Invite-only sign-in stays, so the listing points to the request form | `directory/`, `REVIEW.md`, `/privacy`, `/request-access` | S | Phase 6c |
| H4 | **Invite a friend** (shipped in phase 6c): `invite_friend` (`send`, `list`, `cancel`) for any signed-in person, so people no longer wait for the owner. Active means first sign-in at least 7 days ago and food, workouts or weigh-ins stored on 3 different days in the last 30 (owners skip this; the review account never invites). 3 invitations per 30 days (a cancelled one, or one sent to an address already on Fitwell, still counts) and 5 unused at once; unused ones expire after 30 days. The friend gets one email naming the inviter, with no text from the inviter. A send to an existing address answers exactly as for a new one and leaves the same record (counted, listed as waiting for 30 days, cancellable), so neither the answer nor the inviter's list can be used to find out who uses Fitwell. `manage_invites list` shows who invited whom. Migration 0017 (`users.invited_by`, a `member_invites` log with the typed address, 30 days), export and account deletion cover it | `inviteUser`, `mailerFor`, `manage_invites`, the privacy notice | S | Phase 6c |

## 3. Phases and exit criteria

**Phase 6: foundations and quick wins**
- [x] Deploy the backlog. Since #55 CI deploys the Worker and the landing page from main after the checks pass; D1 migrations are still applied by hand (`npx wrangler d1 migrations apply fitwell --remote`). On 2026-10-24 the remote database had every migration up to 0015.
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

**Phase 6b: shipped outside the plan (2026-10-16 to 2026-10-24)**
- [x] Whole-body sessions: `log_session` for Pilates, yoga, HIIT, CrossFit, Hyrox and functional training, counted in the week and the review (migration 0011).
- [x] Workout player: swipeable cards (overview, one card per exercise, finish card), a bottom action dock, a cardio card, folded warm-ups, sets per muscle on the overview, an optional effort tap per working set (A5, first half), the rest stored on the server so it survives a reload (migration 0013), and a record cue when a set beats an earlier best (#53–#66, #76–#82).
- [x] Food extras (A7, first part): fibre, sugars, added sugar, saturated and trans fat and salt, with goals for fibre, saturated fat and added sugar (migration 0010). A sleep goal (migration 0012).
- [x] Body: a 14-day body-fat average and trend in the `log_body` reply (#56).
- [x] Dashboard and review (from `docs/plan-player-dashboards.md`): energy card (eaten against burned, the gap, the target and goal date), consistency calendar, strength rows, periods that start with the data, a week strip in the review (#58); `show_lift_progress` (one lift's e1RM over time, rep records, last sessions), weekly sets or tonnage on the training card, a Week / Month switch in the review, the muscle map's change against the period before and its recovery mode (A10), Undo after clearing shopping ticks (#65); training and nutrition notes Claude writes into the review (migration 0014, #68); one card shell and one set of controls and icons across the views (#68, #76–#83).
- [x] Invite requests: a form at `/request-access`, approved or declined by the owner through `manage_invites`; sign-in and approval emails through Resend, so invitees no longer need a verified destination (migration 0015, #86–#89).
- [x] Landing page with the public roadmap (`apps/landing/site`, `src/lib/roadmap.ts`), demo video and screenshots (#48–#52, #84).

**Phase 6c: quick wins before phase 7**
- [x] A5 second half: `suggestProgression` uses the logged effort when every set reached its target: every set Easy adds two steps (bodyweight: two reps), Solid or Hard one, any Max holds; sets without an effort never count as Easy, and no effort at all keeps the plain rule and reason. Misses and deloads are unchanged. The reason names the effort ("…and every one felt Easy; add 5 kg."), and the player shows it as the progression note.
- [ ] A11 injuries and limitations in the profile (decision in §4), flagged in plans, templates and swaps.
- [x] H1 first session for new accounts: the setup guide in the first `get_profile` result of an account with nothing saved, offered once (migration 0016, `users.setup_offered_at`; the privacy notice says so).
- [x] H4 invite a friend: `invite_friend` for every signed-in person, limited to active people and 3 a month (`data/memberInvites.ts`, migration 0017); the privacy notice, README and landing page say so.
- [x] Leaner finished-workout report: bests (only when there are any), the exercise lines, cardio, the muscles as a ranked list (top four, "+n more") with an upright 3D figure beside it from three muscle groups (one colour ramp by share of the top muscle, opens on the side with more of the work, drag to turn, no buttons; the same sets in list and figure), one line on what is next and the "Plan my next workout" link. Cut: the 17 chips, "No new bests", the 7-day count, "about 48 hours", echoed notes and "Sent to Claude".
- [ ] H3 Claude Connectors Directory submission.
- [ ] Exit: a squat logged Easy at the target reps gets more weight next time, with the reason; "my left knee hurts on lunges" is saved once and the next leg plan flags lunges and offers swaps; a newly approved person goes from the email to goals set and a first meal logged in one chat.

**Phase 7: friends v1 and streaks**
- [ ] Decisions in §4 agreed.
- [x] F1 streak engine in core with calendar tests (`computeStreaks`); F2 `get_streaks` and the `achievements` table (migration 0018; export and delete cover it) shipped, with the goal weight's start day stored on `goals`. `get_progress` carries a `streaks` summary (as of today) and `show_weekly_review` ends its text with the same for Claude to mention; the review view does not draw it. **Left:** freezes (a planned rest week): nothing stores or sets them yet, so the engine gets none and only the one-week allowance applies.
- [x] F3 celebration view (`show_celebration`, `ui/celebration`): shows the highest new milestone of each streak from the last 7 days once (marks `achievements.celebrated_at`), with the number, what it took and what is next; a ring that draws itself once, still for reduced motion. Claude opens it after a workout or log, per the server instructions; nothing opens it by itself yet.
- [x] F4 share card (4:5, 9:16, 1:1; light and dark; weight off by default; the preview matches what is saved): "Make a card" in the milestone view draws it on a canvas (`ui/shared/shareCard.ts`; what is on it is decided by `shareCardText.ts`, which also gives the preview's text alternative). Name and the goal weight are off until turned on for that card; the numbers, date and the "Fitwell" line are choices. Saved through the host's `downloadFile` or copied to the clipboard (`clipboardWrite` permission); where neither works the view shows the picture to press and hold. Nothing is rendered, stored or posted by the server.
- [ ] `connections` and `shares` tables, the `friends` tool, consent records; export and delete cover them; isolation tests extended (no share means no access).
- [ ] B1 send a template, recipe or plan; B2 household plan and ticks.
- [ ] Cron: `triggers.crons` in `wrangler.jsonc` and a `scheduled()` handler next to `fetch` in `src/index.ts`, tested with `wrangler dev --test-scheduled`.
- [ ] E1 email digests (first cron job).
- [ ] Exit: two invitees connect, one sends a push day, the other runs it; a couple plans a week and ticks one grocery list; reaching a seven-week training target opens the celebration once, and the person saves a story-sized card without any weight on it.

**Phase 8: data in and ChatGPT**
- [ ] C1 ingest webhook with per-person token; Health Auto Export and Shortcut setup in the README; sources shown in `get_progress`.
- [ ] C2 Strava.
- [ ] D3 Today view; D4 restaurant estimates; D6 meal plan view.
- [ ] H2 import from Hevy, Strong, MyFitnessPal and MacroFactor exports (decision in §4).
- [ ] G1 ChatGPT compatibility spike (by the owner) with the results table in the README; G2 fallbacks if the player does not work there; G3 host-neutral wording.
- [ ] Exit: a day of Apple Health steps, sleep and weight appears without typing; a Strava run shows up as cardio; a year of Hevy workouts imports with "last time" values in the player and every unmatched exercise listed; a meal is swapped and a day repeated in the plan view; a ChatGPT user on a plan that allows it logs a meal and sees the dashboard, and the table says what works where.

**Phase 9: coaching v2 and crew**
- [ ] A4 programs with deloads; A6 a verdict per muscle group in the review; A10 strength mode; A7 vitamins and minerals, protein per meal.
- [ ] B3 crew feed; B4 challenges; F5 streaks in both (consistency only).
- [ ] Exit: a 4-week block with a deload runs from "start today's workout"; a 4-week challenge closes and emails results.

**Phase 10 and later**
- [ ] A8 readiness, A9; C3 direct device APIs; B5, B6; D5; F6 streak nudges; G4 ChatGPT directory listing; G5 Gemini when it supports MCP Apps.
- [ ] Progress photos (needs R2 storage and its own privacy decision).

## 4. Decisions to make before phase 7
- **Visibility defaults.** Proposal: nothing shared by default; weight and body never in feeds, only to an accountability buddy who was chosen explicitly.
- **Challenges and weight.** Proposal: consistency metrics only, never weight or body fat.
- **Wearable data retention.** Proposal: keep normalised values only; drop raw payloads after processing.
- **Injuries (A11).** Proposal: saved only when the person tells Claude and agrees; a body area from a fixed list, their own words, and optional start and end dates; health data under Art. 9 like the rest, in export and delete, never shared with friends or shown on a card. Claude flags and offers swaps but does not diagnose or say an exercise is safe.
- **Imports from other apps (H2).** Proposal: the file is read in the person's browser, never through the chat, and only converted records are kept (no raw file); imported foods are marked estimates; nothing already in the account is overwritten, as with the Fitwell backup.
- **Streak rules (agreed 2026-10-18).** Weekly streaks for training (a week counts when the workout target is met; one rest or sick week per 12 weeks, or a freeze the person sets, keeps the streak), daily plus weekly-target streaks for logging ("logged" means at least one meal, not a full day, so partial days do not punish); milestones 1, 2, 3, 5, 7, 14, 21, 30, 52. A weight goal is a milestone celebrated when it is reached (by the trend, after 7 days at or past the goal); it never feeds a streak.
- **Share cards (agreed 2026-10-18).** Drawn in the view only; name and numbers chosen per card; weight and body data off by default and never in the default caption; a small "Fitwell" line the person can remove (just "Fitwell", not "Fitwell for Claude").
- **ChatGPT scope (agreed 2026-10-18).** The owner tests in ChatGPT first (the G1 checklist, on a plan that allows write tools) before any support is promised; G2 to G4 depend on those results. Claude remains the primary, documented host.

## 5. Research notes
- Lifters typically pair a log (Hevy, Strong) with a nutrition app (MacroFactor); Fitwell already joins the two, which is the gap reviewers mention most.
- MacroFactor's core is the expenditure estimate from logged intake and weight with weekly target changes; the window length trades stability against responsiveness ([V3 algorithm](https://macrofactor.com/expenditure-v3/)).
- Autoregulation (RPE-based load changes) showed a modest strength advantage over fixed loading in a meta-analysis summarised in a 2026 comparison; programs with built-in deloads are standard in Boostcamp, Alpha Progression and others.
- Streaks: weekly targets and rest allowances keep motivation without rewarding overtraining; streak loss can discourage, so the engine forgives one gap and celebrates milestones once (no repeats).
- Hosts: ChatGPT custom connectors need Developer Mode and may restrict write tools by plan ([guide](https://coworker.ai/blog/chatgpt-mcp)); the MCP Apps announcement lists ChatGPT, Claude, Goose and VS Code Insiders ([blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)); Gemini custom apps are limited to personal US accounts ([help](https://support.google.com/gemini/answer/17209137?hl=en&co=GENIE.Platform%3DDesktop)).
- Social features: friend groups seeing each other's activity and time-boxed challenges recur as retention levers; challenge windows that are too tight put busy people off ([study](https://www.theseus.fi/handle/10024/887910)). Rest-day-friendly streaks avoid rewarding overtraining.
- Switching: Hevy and Strong export workouts as CSV; MyFitnessPal and MacroFactor have data exports too. Their columns, units and plan limits (MyFitnessPal's export may need Premium) have to be checked against real files before H2 is specified.
- Health data: Apple Health has no web API (exports or a companion app, e.g. Health Auto Export's REST automation); Oura, Whoop, Withings, Polar and Strava have personal OAuth APIs; Garmin's needs business approval.
