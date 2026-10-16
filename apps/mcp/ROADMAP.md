# Fitwell for Claude: long-term roadmap

What comes after the phases in [PLAN.md](PLAN.md). Drafted 2026-10-15 from a brainstorm with research on comparable tools. Four themes: smarter coaching, friends, wearables, faster logging, plus the foundations they need and nudges that work without a phone app.

## 1. Ground rules (from PLAN.md, unchanged)

| Rule | What it means for new features |
|---|---|
| The server never calls an LLM | "Smart" features are deterministic, tested functions in `@fitwell/core`; Claude explains them and asks before saving. |
| Free plan, stateless Worker, D1 (EU) | No Durable Objects. Cron Triggers for anything scheduled. Every new table indexed by `(user_id, …)`; watch D1 daily limits. |
| Health data is GDPR Art. 9 | Nothing is shared between people by default. Every share is explicit, per category, revocable, recorded, and covered by `export_my_data` and `delete_my_account`. |
| Claude chat is the only surface | The server cannot push into a chat. Proactive features use email (`send_email`, invitees are verified addresses) or a Claude scheduled task calling the connector. |

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

## 3. Phases and exit criteria

**Phase 6: foundations and quick wins**
- [ ] Deploy the backlog: remote migrations 0007 and 0008, `wrangler deploy` (phases 5–5d).
- [-] D1 usage: dropped (2026-10-16). Cloudflare's dashboard already shows D1 rows read and written per day and per query; a handful of people is far from the free plan's limits, and counting in code would add writes of its own.
- [-] Cron: moved to phase 7, built with its first job (E1 email digests) rather than as an empty scaffold.
- [x] Open Food Facts: when OFF fails, an older cached answer is served (`data/offCache.ts`). No retry inside a request: after a 503 the client already pauses its rate limiter for up to 30 s.
- [x] A1: `estimateExpenditure()` and `projectGoalDate()` in `packages/core/src/domain/energy.ts`, pure, tested against hand-computed weeks (steady loss, plateau, missing days, too little data → no estimate); shown in `show_weekly_review` (`analytics/review.ts`) and `get_progress` (`tools/body.ts`); Claude proposes, `set_goals` only after agreement.
- [x] D1: `log_food` takes `copy_from` (a day, or one meal of it) and `recipe` items: a usual meal is a saved recipe logged by name, so combos need no new table; allergy checks run on copies and recipe ingredients.
- [x] D2: `save_custom_food` checks label values (`labelProblems` in core: impossible values always refused, a kcal/macro mismatch refused once with the reason and a kJ hint, `values_checked` to confirm) and takes per-serving values.
- [ ] A2: supersets, timed sets, plate calculator, warm-up ramp in the player.
- [x] A3: `substitutes()` in core (same main muscles and kind of exercise; ranked by muscle overlap, push/pull, compound/isolation; profile equipment, bodyweight always counts); `search_exercises` with `similar_to` and `exclude_equipment`; a "Swap exercise" panel in the player (app-only `get_substitutes`, `swap_exercise`) until the first set is logged, keeping sets, reps, rest and the plan's note, with the weight from the new exercise's history.
- [x] A10 muscle heatmap: `buildMuscleMap()` (`analytics/muscles.ts`, tested against hand-counted sets), `show_muscle_map` and the app-only `get_muscle_map`, drawn by the exercise view (it already carries three.js and the body, so the Worker grows by 4.5 KB instead of another 1.7 MB view); a heat mode in `humanBody.ts`; colours for light and dark; period switch keeps the figure's angle.
- [x] E2: morning brief section in `apps/mcp/README.md` (a Claude scheduled task; text tools only, since a scheduled run shows no views).
- [ ] Exit: after a week of real logging, "how am I doing this week?" gives an expenditure estimate and a suggested target; "same breakfast as yesterday" logs in one call; "which muscles did I train this month?" shows the heatmap with the numbers in the reply.

**Phase 7: friends v1**
- [ ] Decisions in §4 agreed.
- [ ] `connections` and `shares` tables, the `friends` tool, consent records; export and delete cover them; isolation tests extended (no share means no access).
- [ ] B1 send a template, recipe or plan; B2 household plan and ticks.
- [ ] Cron: `triggers.crons` in `wrangler.jsonc` and a `scheduled()` handler next to `fetch` in `src/index.ts`, tested with `wrangler dev --test-scheduled`.
- [ ] E1 email digests (first cron job).
- [ ] Exit: two invitees connect, one sends a push day, the other runs it; a couple plans a week and ticks one grocery list.

**Phase 8: data in**
- [ ] C1 ingest webhook with per-person token; Health Auto Export and Shortcut setup in the README; sources shown in `get_progress`.
- [ ] C2 Strava.
- [ ] D3 Today view; D4 restaurant estimates.
- [ ] Exit: a day of Apple Health steps, sleep and weight appears without typing; a Strava run shows up as cardio.

**Phase 9: coaching v2 and crew**
- [ ] A4 programs with deloads; A5 RPE/RIR; A6 volume ranges; A10 strength and recovery modes; A7 micronutrients.
- [ ] B3 crew feed; B4 challenges.
- [ ] Exit: a 4-week block with a deload runs from "start today's workout"; a 4-week challenge closes and emails results.

**Phase 10 and later**
- [ ] A8 readiness, A9; C3 direct device APIs; B5, B6; D5.
- [ ] Progress photos (needs R2 storage and its own privacy decision).

## 4. Decisions to make before phase 7
- **Visibility defaults.** Proposal: nothing shared by default; weight and body never in feeds, only to an accountability buddy who was chosen explicitly.
- **Challenges and weight.** Proposal: consistency metrics only, never weight or body fat.
- **Wearable data retention.** Proposal: keep normalised values only; drop raw payloads after processing.

## 5. Research notes
- Lifters typically pair a log (Hevy, Strong) with a nutrition app (MacroFactor); Fitwell already joins the two, which is the gap reviewers mention most.
- MacroFactor's core is the expenditure estimate from logged intake and weight with weekly target changes; the window length trades stability against responsiveness ([V3 algorithm](https://macrofactor.com/expenditure-v3/)).
- Autoregulation (RPE-based load changes) showed a modest strength advantage over fixed loading in a meta-analysis summarised in a 2026 comparison; programs with built-in deloads are standard in Boostcamp, Alpha Progression and others.
- Social features: friend groups seeing each other's activity and time-boxed challenges recur as retention levers; challenge windows that are too tight put busy people off ([study](https://www.theseus.fi/handle/10024/887910)). Rest-day-friendly streaks avoid rewarding overtraining.
- Health data: Apple Health has no web API (exports or a companion app, e.g. Health Auto Export's REST automation); Oura, Whoop, Withings, Polar and Strava have personal OAuth APIs; Garmin's needs business approval.
