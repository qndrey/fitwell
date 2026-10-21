# UX audit: workout player (swipeable cards) and dashboards

21 Oct 2026. Two design passes (ux-designer agent) over real renders. The renders used 12 weeks of seeded demo history (`npm run seed:review -w @fitwell/mcp -- --email dev@localhost --apply local`), shown at phone width (398 px) in light and dark mode. Paths are relative to `apps/mcp/`. Each item is meant to be one PR.

**Verified in code:**
- player P0-1 (`draftFor`, `ui/workout/cards.ts:331`);
- player P0-2 (`src/tools/workout.ts:71` writes "3×5 @ 80 kg", which `parseLastTime` cannot read);
- dashboard P0-1 (`src/analytics/progress.ts:114` divides by every week of the period).

The rest comes from the reports, with file:line references, and has not been re-checked.

## Workout player

### P0: correctness

| # | Problem | Fix |
|---|---|---|
| P0-1 | Warm-up 2 opens with warm-up 1's values. `draftFor` copies the last done set "of the same kind" (`ui/workout/cards.ts:331`). The steppers say 8 × 20 kg while the row says 5 × 55 kg, so one tap logs a wrong set. The landing asset `warmup-*.png` shows the bug. | Warm-ups always start from their own planned values. Carry-over stays for working sets only. |
| P0-2 | Two notations. The server writes "2×5 @ 107.5 kg" (`src/tools/workout.ts:71`), but the client parser only reads "5 @ 82.5, 5 @ 82.5" (`cards.ts:238`). Grouped strings show raw on the overview, the exercise subline and the summary. `beatLast` returns null for every weighted lift. "BW" leaks into the UI. | Parse the grouped form, or change the server string. Use one format everywhere: "5, 5 × 107.5 kg", "8, 8 reps", "40, 35 s". |
| P0-3 | Tap targets shrank below 44 px: steppers, links, chips, row edit buttons, rest bar (`ui/workout/style.css:31-36`). | 44 px minimum; 52 px for Log set. |
| P0-4 | Timed sets: Log set during the hold logs the *planned* seconds (`main.ts:308-323`). The layout jumps on "Get ready". | During the hold the primary becomes "Stop · log 0:07". The timer gets a fixed slot. |
| P0-5 | `scripts/screenshots.ts` is not cards-aware: its text checks and clicks also hit off-screen cards. `working`, `superset`, `cardio` and `hero-squat` capture the Overview, and `rest-next` captures the wrong card. These images go to the landing page. | Limit the text checks and clicks to `section.pcard:not([inert])`, point each shot at its intended card, add an `overview` shot, and re-shoot after P0-1. |

### P1: complete the cards model

- **P1-1 Header.** Add ‹ › buttons (44 px; there are none today, so a mouse user can only swipe or use the overview). Use one counter, "2 of 6", and drop the second "1 of 3".
- **P1-2 Set zone.** Show last time for this set and the progression reason ("+2.5 kg: all reps done last time") next to the steppers. Today the reason sits under the set list, below the fold. Show the "steps" hint once per session.
- **P1-3 Rest.**
  - Keep one 64 px clock; today there are two.
  - The "Next" line gets plates and the per-side change.
  - At 0:00, show a 3 s "Rest over · Start set 2" state.
  - Optionally store the rest end time, so a reopened chat resumes the rest.
- **P1-4 Done zone looks back.** When an earlier exercise still has open sets, show "Back to Barbell Squat · 2 sets left".
- **P1-5 Supersets.**
  - Both partners show the same round count (today they disagree).
  - The straight-on cue becomes the zone's first line.
  - "Superset" appears as a visible word on the overview.
- **P1-6 Finish card before finishing.**
  - Group "Not done" by exercise.
  - Stack the confirm buttons full width.
  - Preview what will be sent.
- **P1-7 Summary.**
  - Compare each exercise to last time.
  - Give new bests their own block.
  - Group skipped and not-done sets.
  - Show cardio with "~kcal".
  - No "Saving…" flash when a finished workout is reopened.
  - Fix the duplicate "Try again".
  - The fallback summary keeps cardio.
- **P1-8 Save state per row.**
  - A row whose save failed says "not saved" in text.
  - The header says "1 set not saved".
  - Also check `?fail=log`: it did not fail in the dev host.

### P2

- Cardio card: kcal and last time.
- Fold finished warm-ups into one row.
- Sets per muscle on the summary.
- A record cue when a set is logged.
- RPE/RIR (needs a schema field).
- Guide in the player: text first, animation on demand.
- A wider strip marker when there are many cards.

## Dashboards and reports

### P0: honesty and consistency

- **P0-1 Periods start when the data starts.**
  - Averages are divided by every week in the period (`src/analytics/progress.ts:114`). With 12 weeks of data, "1 year" says 0.7 workouts a week against a goal of 3, and the charts sit squeezed in the right quarter.
  - Fix: add `dataFrom` and `weeks[].partial`, clip the x-axis, and average over full weeks only.
  - In the same PR:
    - round axis ticks (today 83.7 / 81.1 / 78.5);
    - a year in dates when the range crosses one;
    - remove the "web ·" platform text from the footer.
- **P0-2 Weight headline.** It shows the latest weigh-in (`ui/dashboard/main.ts:161`). Show the 7-day trend instead, with the last weigh-in second.
- **P0-3 One way to count muscle sets.**
  - Dashboard: primary muscles only, called "Working sets". Muscle map: 1 for primary plus 0.5 for helping muscles, called "Hard sets". Quads show 3.4 against 5 for the same 4 weeks.
  - Fix: use `buildMuscleMap` credit everywhere.
- **P0-4 Weekly review copy.**
  - Records are listed twice.
  - The highlight uses ISO dates and a "-0.4" hyphen while the tiles say "19 Nov" and "−0.4 kg".
  - `proteinReached` is never shown.
  - Confidence shows as the raw enum ("high confidence").
  - No "This week" jump after paging back.
- **P0-5 Food summary.**
  - The sub-line joins names that contain commas ("Oats, rolled, average values, Rye bread…").
  - Macros have no unit.
  - Six "no goal set" lines; collapse them to one line.

Enabler, shipped with the first PR: `ui/shared/chart.ts`:
- nice ticks, line, bar, week bars and sparkline;
- a hidden data table for each chart.

Dashboard and review then use `ui/shared/dom.ts` instead of their own copies of `h()`.

### P1: show data the server already has

| # | Add | Data |
|---|---|---|
| P1-1 | **Energy card on the dashboard**: eaten against burned on one scale, the gap and kg per week, a target for the goal, the goal date. No dual axis. | `Progress.energy` is computed today but drawn only on the review |
| P1-2 | **Strength drill-down.** Strength rows expand to an e1RM line with PR diamonds and the last 5 sessions. Raise the 6-lift cap. The finish card's new-best rows reuse the sparkline. | `records.exercises[].points`, plus `sessions[]` with the top set |
| P1-3 | **Week strip in the review**: kcal bars per day, a training letter (S/C/P), weigh-ins. The review has no visuals today: about 25 number tiles, 1,773 px tall. | The week's daily series, already loaded in `buildReview` |
| P1-4 | **Consistency calendar**: a 12 × 7 grid of trained days with "3/3" per week. This is the base for the streaks (F1) and celebration (F3) roadmap items. | Workouts already loaded |
| P1-5 | **Nutrition over time**: weekly average calories for 90 days and 1 year (daily 1.5 px bars are noise), a protein line, and protein g/kg of trend weight. | `nutrition.daily` and `weight.average` |

Also not shown today:
- cardio and class minutes per week;
- the trend of sets per muscle per week;
- PR dates;
- daily fibre, sugar and salt.

### P2: new reports

- **P2-1 `show_lift_progress`.** The per-exercise page: e1RM over a year, rep PRs, the last 10 sessions. It opens from chat and from the finish card.
- **P2-2 Training volume over time.** Weekly hard sets by muscle group. Tonnage per week needs a new aggregation.
- **P2-3 Monthly review.** A Week/Month switch in the review rather than a new view.
- **P2-4 Muscle map.** A change against the previous period; a recovery mode.
- **P2-5 Shopping.** Undo after "Clear ticks".

Left out on purpose: sleep and steps correlation charts. With about 30 points they suggest effects that aren't there; Claude can say this in words, with caveats.

## Decisions needed

1. **Set notation.** Change the server's "3×5 @ 80 kg" (Claude reads it too) or only reformat it in the client?
2. **Muscle range.** With 3 full-body sessions a week, the 10–20 hard-sets band marks 13 of 17 muscles "under". Should the band depend on the goal, or should "under" be neutral?
3. **The sleep 8 h line** is hardcoded (`SLEEP_TARGET_H`). Keep it, make it a goal, or remove it?
4. **"1 year" before there is a year of data.** Clip the period (assumed above) or rename the option "All"?
5. **Strength drill-down.** Expandable rows (P1-2), a separate tool (P2-1), or both?
6. **RPE/RIR in the player** (schema change), and storing the rest end time on the server?

## Unverified

- Whether added sugar and trans fat showing 0 g are real values or missing data.
- Why abdominals get 0 credit (planks and other timed sets?).
- What the muscle map's "Colours" button does.
- The `--series-2` bar contrast (estimated below 3:1).
- `?fail=log` and `?fail=finish` in the dev host.
- The `apps/mcp/contracts/` folder: it does not exist in this worktree.
