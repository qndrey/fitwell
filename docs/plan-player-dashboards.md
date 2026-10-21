# Plan: workout player and dashboards

21 Oct 2026. Built from [ux-audit-player-dashboards.md](ux-audit-player-dashboards.md) (findings, wireframes, file:line), plus two layout requests:
- Log set and Skip set sit at the bottom of the workout card.
- The Overview's Start button sits at the bottom of its card.

Paths are relative to `apps/mcp/`.

**Two tracks that can run in parallel:**
- **Player:** `ui/workout`, `scripts/screenshots.ts`, contract `workout-cards`.
- **Dashboards:** `ui/dashboard`, `ui/review`, `ui/food`, `ui/shared`, `src/analytics`.

They meet only at D6 / P12 (the finish card's new-best sparkline).

**Every PR:**
- `npm run check -w @fitwell/mcp` passes.
- Checked in the dev host at 375 and 398 px, light and dark.
- The affected shots are re-taken with `scripts/screenshots.ts`, and the landing assets are updated when they change.
- Demo data: `npm run seed:review -w @fitwell/mcp -- --email dev@localhost --apply local`.

**Contracts** (git-ignored, in the main checkout's `apps/mcp/contracts/`):
- Player PRs update `workout-cards` first (01-purpose wireframes, 02-specs, 03-gates).
- New data fields and new views get their own contract (`dashboard-honesty`, `energy-card`, `lift-progress`, …) through `/contract-specs`, then `/gate-phase`.

---

## Phase 0: foundation (1 PR)

**PR 0. Seed and screenshot tooling**
- `scripts/seed-review.ts`: match Frida foods on `friendlyFoodName` (already fixed in this worktree; uncommitted).
- `scripts/screenshots.ts` becomes cards-aware:
  - `bodyText`, `click` and `work()` act only on `section.pcard:not([inert])`;
  - retarget `working`, `superset`, `cardio` and `rest-next`, and add `overview`.
- Shots do not leave workouts behind in the demo account (the existing `cleanUp()` runs on every exit path).

*Done when:* each player shot shows the card its name says, and running the script twice leaves the "last time" data unchanged.

---

## Track A: workout player

### Phase A1: correctness and layout (P0)

**PR A1. Warm-up prefill** (`ui/workout/cards.ts:326` `draftFor`)
- A warm-up always opens with its own ramp values (`targetReps`, `weightKg`).
- Carry-over applies to working sets only.
- Test in `workout-cards-logic.test.ts`: after warm-up 1, the steppers show warm-up 2's values and the plates match them.

**PR A2. One set notation** (needs decision 1)
- Default: the client reformats and the server string stays, because Claude reads it.
- `parseLastTime` also reads grouped "N×R @ W kg" and "N×R @ BW", so `beatLast` works for weighted lifts.
- Summary lines are built from the plan's logged sets, not from `e.done`.
- Format everywhere: "5, 5 × 107.5 kg", "8, 8 reps", "40, 35 s". No "@" and no "BW" on screen.

**PR A3. Bottom action dock and 44 px targets** *(new request)*

Every card gets a dock pinned to its bottom: one fixed place for the main action, in the thumb zone.

| Card / state | Dock contents |
|---|---|
| Overview | `[*  Start: Barbell Squat  *]` (or Continue) |
| Exercise, set open | `[ Skip set ]  [*  Log set · 5 × 105 kg  *]` |
| Exercise, resting | rest progress line, then `[ −15 s ] [ +15 s ] [* Skip rest *]` (today's `.restbar`, same slot) |
| Exercise, done | `[*  Go to Bench Press  *]` |
| Cardio | `[ Skip ]  [*  Log cardio  *]` |
| Finish | `[*  Finish and send to Claude  *]` / the confirm pair, stacked |

```
+--------------------------------------------+
| Barbell Squat                              |
| ✓ Warm-up 1                     8 × 20 kg  |
| +----------------------------------------+ |
| | (Warm-up) Warm-up 2 of 4 · 5 reps      | |
| | [-]  5  [+]       [-]  55  [+]         | |
| | Each side: 15 + 2.5 · bar 20 kg        | |
| +----------------------------------------+ |
| ○ Warm-up 3                     3 × 75 kg  |
| ○ Set 1 of 2                   5 × 110 kg  |
| Note · Swap · How to do it                 |
|                 (scrolls)                  |
|--------------------------------------------|
| [ Skip set ] [*  Log set · 5 × 55 kg   *]  |  <- dock, always at the card bottom
+--------------------------------------------+

+--------------------------------------------+
| Today   0 of 4 sets · 3 exercises          |
| Barbell Squat                        ○○    |
| ...                                        |
| Ask Claude to change the plan.             |
|                                            |
|                                            |
|--------------------------------------------|
| [*        Start: Barbell Squat         *]  |  <- dock
+--------------------------------------------+
```

- **CSS:**
  - `.pcard` becomes a flex column;
  - a new `.dock` gets `margin-top: auto; position: sticky; bottom: 0`, so it sits at the bottom when the content is short and stays visible when the card scrolls;
  - replaces `.sticky` (the Overview, `main.ts:1467`) and folds in `.restbar` (`main.ts:1898`).
- **Zone:** keeps the steppers, plates and timer only. `--zone-h` shrinks, since Log set no longer lives in it.
- **Button sizes:**
  - Skip set changes from a text link to a secondary button, about 1/3 of the width.
  - Log set is the primary, about 2/3 of the width, 52 px tall.
  - All controls are at least 44 px: `--h-primary`, `--h-stepper`, `--h-secondary`, `--h-link` and `--h-row` go to 44.
- **Contract changes:**
  - `workout-cards` 02-specs, Exercise card section: Log set is in the dock, not the zone. The rule that "Log set does not move between sets" now holds by construction.
  - FR8: the rest bar is the dock in its rest state.
  - FR4: the Start button is in the dock.
  - Update the 01-purpose wireframes.
- **Tests:**
  - `workout-cards-pager` / `-secondary`: on every card the dock's bottom equals the card's bottom (bounding box).
  - Opening "How to do it" does not move the dock.
  - Tab order: card content, then the dock.
  - Focus restore by `data-key` still works.

**PR A4. Timed sets log the time held** (after A3, because it uses the dock)
- During get-ready and the hold, the dock reads `[ Cancel ] [* Stop · log 0:07 *]`.
- When the hold completes, it returns to `Log set · 40 s`.
- The timer has a fixed slot in the zone, so the layout does not jump.

### Phase A2: complete the cards model (P1), one PR each, in this order

| PR | Change |
|---|---|
| A5 | **Header:** ‹ › buttons (44 px, `aria-disabled` at the ends) and one counter, "2 of 6". Drop the exercise "1 of 3". Cardio shows "Warm-up" or "Finisher" as a sub-label. |
| A6 | **Set zone context:** "Last time: 5 × 107.5 kg" for this set, and the progression reason ("+2.5 kg: all reps done last time"). Remove the bottom `ex.note` line. Show the "steps" hint once per session. |
| A7 | **Rest:** keep one 64 px clock (remove the dock's duplicate). "Next" shows plates and the per-side change. At 0:00, a 3 s "Rest over" state with "Start set 2" in the dock. |
| A8 | **Done zone looks back:** when earlier sets are still open, "Back to Barbell Squat · 2 sets left" sits above the dock's forward button. |
| A9 | **Supersets:** one round count for the group. "Straight on · no rest" becomes the zone's first line. "Superset" is a visible word on the Overview. |
| A10 | **Finish card before finishing:** "Not done" grouped by exercise, confirm buttons stacked in the dock, and a one-line preview of what will be sent. |
| A11 | **Summary:** comparison to last time per exercise, a "New best" block, skipped and not-done grouped, cardio with "~kcal". No "Saving…" flash on reopen. One "Try again". The fallback keeps cardio. |
| A12 | **Save state per row:** a failed row says "not saved" in text, and the header says "1 set not saved". Also fix the dev host's `?fail=log` and `?fail=finish` so they really fail. |

### Phase A3: depth (P2)

- **Cardio card:** kcal and last time.
- **Fold finished warm-ups** into one row.
- **Sets per muscle on the summary**, with a hint to the muscle map.
- **Record cue when a set is logged** (needs bests in the plan payload).
- **RPE/RIR** (decision 6; schema change).
- **Guide in the player:** text first, then the animation.
- **Wider strip marker** when there are many cards.

---

## Track D: dashboards and reports

### Phase D1: honesty and consistency (P0)

**PR D1. Shared chart module** (no visual change)
- `ui/shared/chart.ts`:
  - `niceTicks`, `lineChart`, `barChart`, `weekBars`, `sparkline`;
  - `fmtDay`, which adds the year when the range crosses one;
  - a visually hidden `<table>` for each chart.
- Dashboard and review use `ui/shared/dom.ts` instead of their own copies of `h()`.

**PR D2. Periods that start with the data, and the trend weight** (decision 4)
- `src/analytics/progress.ts`:
  - add `dataFrom` and `weeks[].partial`;
  - averages and sets per muscle use full weeks from `dataFrom` on.
- View:
  - the x-axis starts at `max(from, dataFrom)`, with "since your first log on 29 Jul";
  - a partial week is drawn as an outlined bar;
  - round ticks;
  - remove the platform text from the footer.
- Weight headline: the 7-day trend first, the last weigh-in second (`ui/dashboard/main.ts:161`, `progress.ts:56`).
- Tests (`data.test.ts` / `energy.test.ts`): 12 weeks of data viewed as "1 year" gives 3.0 workouts a week, not 0.7.

**PR D3. One way to count muscle sets** (decision 2)
- `loadProgress` uses `buildMuscleMap` credit: 1 for primary, 0.5 for helping muscles.
- The label is "Hard sets a week", and the 10–20 markers become tick lines on the meters.
- The dashboard and the map agree for the same weeks.

**PR D4. Weekly review copy**
- Records appear once, in Training, with short names.
- Highlights format dates and the minus sign like the tiles.
- Add "Protein goal: 5 of 7 days".
- Confidence words: reliable, fair, rough.
- A "This week" / "Last week" label and a "This week" button after paging back.

**PR D5. Food summary copy**
- Sub-line: "13 Oct · lunch · 2 foods".
- "g" on macros.
- Extras with no goal set fold into one line.

### Phase D2: show data the server already has (P1)

| PR | Change | Data |
|---|---|---|
| D6 | **Strength drill-down:** strength rows expand (`<details>`) to an e1RM line with ◆ PR markers and the last 5 sessions, plus "Show all lifts". The finish card's new-best rows get the same sparkline (player PR, after A11). | `records.exercises[].sessions[]` (new: top set, e1RM, isBest); `finishSummary.history` |
| D7 | **Energy card on the dashboard:** eaten against burned on one scale, the gap and kg per week, the target for the goal, the goal date. Empty states give the reason. | `Progress.energy` (exists) |
| D8 | **Week strip in the review:** kcal bars per day, training letters S/C/P, weigh-ins. A real `<table>` doubles as the text alternative. | New `WeekReview.days[]`, from the loaded week |
| D9 | **Consistency calendar:** a 12 × 7 grid of trained days with "3/3" per week, in `chart.ts`, so the streaks (F1) and celebration (F3) roadmap items can reuse it. | New `training.days[]` |
| D10 | **Nutrition over time:** weekly average calories for 90 days and 1 year, a protein line, protein g/kg of trend weight (computed on the server, so Claude's text has it too). | `nutrition.daily`, `weight.average` |

### Phase D3: new reports (P2)

| PR | Change |
|---|---|
| D11 | `show_lift_progress`: the per-exercise page (e1RM over a year, rep PRs at 1/3/5/8, the last 10 sessions). Needs a new contract. |
| D12 | Training volume over time: weekly hard sets by muscle group. Weekly tonnage needs a new aggregation. |
| D13 | Week/Month switch in the review, using `buildReview` over 28 days. |
| D14 | Muscle map: a change against the previous period, and a recovery mode. |
| D15 | Shopping: Undo after "Clear ticks". |

---

## Order and parallelism

```
PR 0 ──┬── A1 → A2 → A3 (dock) → A4 → A5 … A12 → A3-phase P2s
       │                                    ↘
       └── D1 → D2 → D3 → D4, D5 → D6 ───→ (finish-card sparkline) → D7 … D15
```

- PR 0 goes first: both tracks rely on correct screenshots and clean demo data.
- A3 comes before A4 and every later player PR, because they all place buttons in the dock.
- D1 comes before every chart PR.
- Tracks A and D touch different files and can be worked by two sessions in parallel.

## Decisions needed before these PRs

| # | Decision | Blocks |
|---|---|---|
| 1 | Set notation: reformat in the client only (default) or change the server string too | A2 |
| 2 | Muscle range 10–20: by goal, or "under" shown neutral | D3 |
| 3 | Sleep 8 h line: keep, make it a goal, or remove | D7 / D10 sweep |
| 4 | "1 year" before a year of data: clip (default) or rename to "All" | D2 |
| 5 | Strength drill-down: rows (D6), a separate tool (D11), or both | D6, D11 |
| 6 | RPE/RIR and a rest end time stored on the server | A3-phase P2, A7 |
| 7 | Dock on the exercise card: Skip set as a button beside Log set (default), or as a link under it | A3 |
