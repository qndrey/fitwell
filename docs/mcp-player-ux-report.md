# Fitwell workout player: UX report

Produced 2026-10-18 by the `ux-designer` agent in critique mode, from the player source (`apps/mcp/ui/workout/main.ts`, `style.css`, `index.html`, shared helpers, `src/workout/plan.ts`, `log_set` in `src/tools/workout.ts`) and rendered screenshots of its states in light and dark. I checked these claims against the source: `aria-live` on `<main>` (`index.html:11`), "Finish early" calling `finish()` with no confirmation (`main.ts:655`), the diagnostics footer text (`main.ts:658`), the 0.5 kg step (`main.ts:69`), only `.rest .time` being styled as a large timer (`style.css:59, 88`), and `log_set` being app-only. The rest is the agent's reading of the code; screen-reader behaviour, contrast ratios and the finished-workout clock were not run or measured (see the end).

Line numbers refer to `apps/mcp/ui/workout/main.ts` unless another file is named.

## Summary

The player's foundations are good: resume and replay logic, timers that only update text nodes, plate maths, calm copy, neutral palette. What hurts in the gym is **safety and reach** (one stray tap can end the workout or log the wrong set, no undo), **hiding failures** (a failed save is invisible; the footer is debug text), and a **main set screen where Log set is the 12th element** and moves whenever a panel opens or the card changes height.

## Problems, ranked by impact

### 1. One extra tap can end the workout or log the wrong set (safety, M)
- After **Log set** the card is replaced at once by the rest card (l.151-194, 538-553), about 200 px shorter. In the screenshots, Log set sits where **Finish early** sits on the rest screen.
- `touch-action: manipulation` (`style.css:52`) turns a double tap into two clicks. "Finish early" has no confirmation: it calls `finish_workout` and posts "I finished my workout…" into the chat (l.655, 260-290).
- In a superset there is no rest (l.169-178), so a second tap lands on the partner exercise's **Log set** and logs it.
- **Fix:** (a) ignore primary actions for ~600 ms after any state change (one `lockUntil` checked in `logSet`, `finish` and the list handler); (b) put each state's primary action in the same place, with the rest card the same minimum height as the set card; (c) make "Finish early" an inline two-step confirm ("End the workout now? 3 sets are not done. [Keep training] [End and send to Claude]"); (d) hide "Finish early" during rest.
- **Where:** l.151-194, 538-553, 655; `style.css` `.actions`.

### 2. No undo or edit for a logged or skipped set; Skip is a twin of Log (safety, M)
- A logged set cannot be corrected in the view. Skip set is full width, 44 px tall and 12 px under Log set (l.594-595), and a skip cannot be reversed (`nextSet` treats skipped as closed). `fitwell-patterns.md` already requires that a wrong tap in the player be undoable.
- `log_set` overwrites by `setId` (`src/tools/workout.ts` ~398-417), so **editing** needs no server change; **reopening** a set (not done, not skipped) does (an `undo` flag).
- **Fix:** on the rest screen a "Just logged" line with **Edit** (reopens the steppers in place, re-sends `log_set` with the same `setId`) and **Undo** (reopens the set, cancels the rest); make Skip a quiet text button away from Log; tapping a finished exercise shows its sets as rows with Edit.

### 3. Failed saves are invisible; the footer is debug text (data integrity, M)
- `sync` marks the set done locally before the server answers (l.159-168). On failure it only sets `state.serverOk = false` (l.240-242); the next success sets it back to `true` (l.239), hiding the failure. The only signal is the footer: "web · inline · could not reach Fitwell ✗", and before the first set "web · inline · server: no set logged yet" (l.657-659), which means nothing to the person.
- When the chat is reopened, `open()` loads the server copy (l.81-91), so an unsaved set disappears without a word. Note and cardio saves fail the same way.
- **Fix:** a per-item pending map with retry on the next action and every ~15 s; show status only when there is something to say, next to the header: "(!) 1 set not saved yet. [Try again]"; show nothing on success (or a brief "Saved"); delete the platform and display-mode diagnostics (dev-only flag if needed); when finishing with unsaved sets, retry first and say so on the summary if it still fails.

### 4. The weight stepper is slow and can suggest weights the bar can't make (speed, M, product decision)
- Every tap is 0.5 kg (l.69, 581), with no long press or typing: 60 → 100 kg is 80 taps. On a barbell, 0.5 kg steps give weights the plates cannot make ("your plates can't make 88", l.316). Reps are tap-only too.
- **Fix:** step by equipment (barbell: 2 × the smallest plate in `plan.gym`; dumbbell 1-2 kg; machine 2.5-5 kg; other 0.5 kg); tap the number to type it (`inputmode="decimal"`, 16 px+ to avoid iOS zoom); press-and-hold repeat with acceleration.
- **Decision:** the README lists "0.5 kg weight step" as a feature.

### 5. Hierarchy: Log set is pushed down and the view height jumps (glanceability and reach, M)
- Card order: caption, name, set line, last time (wraps to two lines), coach note, last note, steppers, plates, How to do it, Swap, Add a note, **Log set**, Skip (l.563-596). Log set's position depends on which notes exist and which disclosures are open; opening "How to do it" pushes it ~700 px down, opening Swap adds 7+ rows.
- The view switches between a tall set card and a short rest card on every set, and the host resizes the iframe each time, so the chat around it scrolls and controls move under the thumb.
- **Fix:** reorder to header, name, set line (bigger), steppers, plates, **Log set**, then one quiet secondary row (Skip set · Note · Swap · How to); compress last time and notes into one "Last time" line above the steppers; open disclosures **below** the action row; give set and rest cards the same CSS `min-height` (~420 px). Target wireframe A below.

### 6. Screen readers and keyboard: live-region chatter and lost focus (accessibility, M)
- `<main id="app" aria-live="polite">` wraps the whole view (`index.html:11`) and every `render()` calls `replaceChildren` (l.661), so a screen reader may re-announce the card after each tap; the elapsed clock (`#elapsed`, l.520, 708-709) changes inside that region every second (behaviour varies; not verified).
- Replacing nodes destroys the focused button, so a keyboard or switch user loses focus to `<body>` after each press. Progress dots are bare glyphs. Stepper buttons read "Less weight kg" / "More weight kg" (l.301-303).
- **Fix:** remove `aria-live` from `main`; add one visually hidden `role="status"` announcing only meaningful events ("Logged 5 × 87.5 kg. Rest 1:30.", "Rest over. Set 2 of 2.", "Not saved"); keep clocks outside live regions; restore focus after render via a `data-key`; steppers as `role="group"` with `aria-label="Weight"`, buttons "Decrease weight" / "Increase weight", the value announced as "87.5 kilograms"; dots with `aria-label="2 of 6 sets done, 1 skipped"` and `aria-hidden` glyphs; list buttons named with their state ("Pullups, not started").

### 7. Rest screen: hard to read from the bench, quiet ending, can't prepare (S-M)
- The timer is 3rem (`style.css:59`): marginal from a bench. When rest ends the view switches to the set screen (l.686-694) with only `navigator.vibrate` (likely blocked in a cross-origin iframe, absent on iOS; unverified): a person looking away gets no cue, and the screen change can catch a tap meant for Skip rest. There is +15 s but no −15 s; the next set can't be adjusted until rest is skipped; the step list is disabled during rest (l.647).
- **Fix:** timer ~4.5rem with tabular numerals plus a thin progress bar; at 0 show "Rest over" with **Start set 2** for ~3 s before switching (with the problem-1 tap guard); action row [−15 s] [+15 s] [Skip rest]; make the "Up next" values tappable ("Change"); keep the list enabled during rest. Wireframe B below.

### 8. Progress and orientation numbers disagree (clarity, S)
- Header "1/6 sets" counts warm-ups (l.513-514) while the card says "Warm-up 2 of 4" and "Set 1 of 2"; "Exercise 1 of 3" counts only strength exercises (l.567) though the list shows cardio; cardio shows "1/1 sets"; dots don't tell warm-ups from working sets; the plan name in the header repeats the exercise name.
- **Fix:** header "Step 2 of 5 · 4/8 working sets · 12:40" counting working sets only; warm-ups as small dots before the working-set dots; cardio caption "Step 5 of 5 · Finisher".

### 9. "Last time" is hard to read and the suggested weight has no reason (clarity, S)
- "Last time: 5 @ 82.5, 5 @ 82.5, 4 @ 82.5 kg (2026-10-09)" wraps, uses an ISO date and "@", while the rest of the player uses "5 × 87.5 kg". The progression reason exists (`PlannedExercise.note`, `plan.ts` ~34, rendered l.571) but in small muted text.
- **Fix:** "Last time (9 Oct): 5, 5, 4 × 82.5 kg", grouped by weight; one line under the steppers: "+5 kg: all reps done last time", phrased as information. (The `lastTime` string is built server-side; builder not inspected.)

### 10. Timed sets: tiny countdown and no time to get into position (S)
- The hold countdown uses `.time` but only `.rest .time` is styled (`style.css:59`; `.hold .time` only sets a margin, l.88): "0:09" renders at body size. The timer starts at once, but the person must put the phone down and get into a plank. Seconds actually held are not recorded when stopped early.
- **Fix:** style `.hold .time` like the rest timer; a 5 s get-ready countdown (optional is a product question); on stop, put the elapsed seconds into the stepper; on completion, move focus to Log set (no auto-log).

### 11. Supersets: the switch to the partner exercise is silent (S)
- After A1 the card silently becomes B1; only a muted caption says "Superset · 1 of 2" (l.567) and nothing says "no rest" (l.144-149, 169-178).
- **Fix:** a visible line "Superset with Triceps Pushdown · round 1 of 2"; "Straight on, no rest" for ~3 s (text, not colour); bracket superset members in the list.

### 12. Swap: long list, one-tap commit, raw equipment names (S)
- 7+ full-width rows push Log set off screen; one tap swaps at once (l.437-454); equipment text is raw data ("body only"); the option silently disappears after the first logged set (l.458).
- **Fix:** the 4 closest substitutes plus "Show 3 more"; "Swapped from Barbell Squat · [Undo]" until the first set is logged (confirm the server accepts swapping back); plain equipment words; no disabled control afterwards (the chat covers it).

### 13. Notes: no visible save (S)
- The textarea saves on blur only (l.359-362), with no Save button or feedback; failures go to the footer; `render()` is skipped while it has focus (l.510), so the rest timer's end doesn't show until blur.
- **Fix:** a small **Save note** button, blur as fallback, "Note saved" in the note line, errors in the status line from problem 3.

### 14. Finish and summary: a dead end with leftover controls (S-M)
- The step list stays under the summary, disabled, with the current-step border still drawn. The header clock is `Date.now() - startedAt` at render (l.520), so a finished workout reopened later will likely show a huge time (inferred, not run). New bests are styled `.done`, which falls back to the text colour, so they look like any other line. Skipped sets are not shown; "Summary sent to Claude." says nothing about what happens next. On replay of a finished workout `finish_workout` is called again (l.101-103): idempotent, but it adds a "Saving…" flash.
- **Fix:** headline numbers first (time, working sets, volume), then new bests as their own block with a text heading, per-exercise lines, skipped sets ("Skipped: Pullups set 2"), cardio, then the hand-off line; remove the step list and footer in the finished state; use the finish time for the header (the summary already has `minutes`). Wireframe C below.

### 15. The 3D guide inside the player is costly and in the way (S)
- WebGL is created lazily and stopped on step change (good), but the figure renders inside the set card above Log set, making the card ~1,500 px tall on a phone; the setup lists and steps are below the figure.
- **Fix:** open it below the action row; lead with the written cues and machine setup, then the figure; add "Close guide" at the end of the panel; "Ask Claude how to do it" (`show_exercise`) for depth. Reordering `shared/guide.ts` (l.24-53) also affects the exercise view.

### 16. Cardio step copy (S)
- Buttons say "Done" and "Skip" (l.613-614). **Fix:** "Log run" (or "Log cardio") and "Skip this". Keep "about 133 kcal" and the "–" for zero distance; they follow the honest-numbers rule.

### 17. Copy and tone details (S)
- "That was the last set. Next: finish the workout." (l.480) → "Last set done. Finish when you're ready."
- "Could not load the guide. Close and open it to try again." (l.420) and "Could not swap the exercise. Try again." should be **Try again** buttons.
- Long step-list labels wrap; give them a one-line clamp. No shaming copy found: tone is calm throughout.

### 18. Consistency of spacing, type and code (S)
- `main.ts` defines its own `h` (l.51-61), identical to `shared/dom.ts`: import the shared one.
- About 8 font sizes (0.75, 0.8, 0.85, 1, 1.1, 1.15, 1.35, 1.5, 3rem): reduce to five (0.85 meta, 1 body, 1.15 subtitle, 1.5 headline and stepper value, 4.5 timers).
- Mixed radii (14, 12, 10, 999): use `--radius` for cards and buttons plus one smaller `--radius-sm`.
- Disclosure `summary` targets are 32 px (`style.css` ~79, 81) against 44 px elsewhere; "Add a note" is an unpadded underlined link-button (~22 px tall, `style.css` ~75): pad both to 44 px.

### 19. Dark mode (minor)
- Looks right in the screenshots; contrast estimates are comfortably above 4.5 (estimated, not measured). `--btn`/`--on-btn` are fixed fallbacks by design (soft charcoal) and `.guide .sw.hot` (#e4572e) is the allowed muscle-tint exception. The list has no explicit disabled style during rest (moot if problem 7 re-enables it).

## What already works and must not change
- Resume and replay: `get_workout` first, local progress kept on re-sent results, starting at the first open step (l.81-106).
- Absolute-timestamp timers that update only text nodes, so buttons are never replaced under a finger (l.683-712). Extend the idea (problem 6).
- Carry-over prefill rules: a working set never starts from a warm-up weight (l.120-127, 180-187).
- The plates line: per side, bar weight, "your plates can't make X", "Lighter than the bar" (l.309-317).
- The warm-up pill plus "Warm-up 2 of 4" and the shorter rest after warm-ups (l.165).
- The rest card's "Up next" with exact reps × weight and "Next exercise" versus "Next set" (l.479-499).
- The note editor that exists only while editing (fixes the iOS "Undo typing" issue, l.327-331), the 16 px textarea font, the lazy guide fetch and lazy WebGL.
- The summary posted to Claude as a user message (PRs, notes, cardio, l.280-282) and `updateModelContext` after each set (l.221, 244).
- Neutral palette, dark mode from host variables, `textContent` only, no inline styles, 44-56 px buttons, safe-area padding, calm non-judging copy, "about … kcal" for estimates.

## How the chat and the player should divide the work
- **The player:** fast, repeated, low-risk actions during a set: log, skip, edit or undo the last set, adjust reps and weight, rest control, one-tap swap before the first set, a short note, save status. It never grows forms for plan editing.
- **The chat:** changing the plan (add or remove an exercise or set, rest times, reorder), "why this weight?", deep how-to (`show_exercise`), fixing history after the workout, interpreting the summary and next-session advice.
- **The bridge:** one quiet line where relevant ("Ask Claude to change the plan" under the list; "Claude will reply below" after the summary); `updateModelContext` keeps Claude current.
- **Gap:** `log_set` is app-only (`visibility: ['app']`, `workout.ts` ~396), so Claude cannot fix a set from the chat after the workout; `delete_item` removes whole workouts. See open questions.

## Prioritised plan

**Quick wins (S, about a day in total)**
1. Tap guard after every state change; inline confirm on "Finish early"; hide it during rest (problem 1 a, c, d).
2. Log set directly under the steppers; disclosures and Skip in a secondary row below it (problems 5 and 2, layout part).
3. Remove the diagnostics footer; show a status line only on failure, with Try again (problem 3, display part).
4. Bigger rest and hold timers; −15 s; list enabled during rest (problems 7 and 10, styling part).
5. Header counts working sets; labelled dots; drop `aria-live` from `main`, add one status region (problems 8 and 6, partial).
6. Remove list and footer from the summary; fix the header time on finished workouts; new bests as their own block (problem 14).
7. Copy fixes (cardio buttons, retry buttons, "Last time" format); 44 px disclosure targets; shared `h` (problems 16, 17, 9, 18).

**Next (M)**
8. Edit and Undo for the last set on the rest screen (edit works with today's `log_set`; undo needs a server flag) (problem 2).
9. Pending-save queue with retry and finish-time reconciliation (problem 3).
10. Per-equipment weight steps, tap-to-type, hold to repeat (problem 4).
11. Focus restoration across renders and stepper semantics (problem 6).
12. A stable card height between set and rest, and the "Rest over" handover (problems 5 and 7).

**Later (S-M)**
13. Superset round line and "no rest" cue (11); swap undo and a shorter list (12); guide reorder (15); get-ready countdown (10).

## Target wireframes

**A. Set screen (problems 1, 2, 4, 5, 8, 9)**
```
+----------------------------------------------------------+
| Full body                Step 1 of 5 . 0/6 sets . 4:12   | 1
+----------------------------------------------------------+
| Barbell . Exercise 1 of 3                                |
| Barbell Squat                                            |
| Set 1 of 2 . target 5 reps                               | 2
| Last time (9 Oct): 5, 5, 4 x 82.5 kg                     | 3
|                                                          |
|  REPS                      WEIGHT KG                     |
| [ - ]    5    [ + ]      [ - ]   87.5   [ + ]            | 4
| Each side: 25 + 5 + 2.5 + 1.25 . bar 20 kg               |
| +5 kg: all reps done last time                           | 5
|                                                          |
| [*            Log set  5 x 87.5 kg              *]       | 6
|                                                          |
|  Skip set     Note     Swap     How to do it             | 7
+----------------------------------------------------------+
| Barbell Squat                                 .... ()()  | 8
| Pullups                                             ()   |
| Bench Press                                         ()   |
| Ask Claude to change the plan.                           |
|                                                          |
| [ Finish early ]                                         | 9
+----------------------------------------------------------+
 1  The header counts working sets only. A save problem appears here as one line with Try again.
 2  The largest text after the name: what to do now.
 3  One line, plain date, the same "x" notation as everywhere.
 4  Steps per equipment (2.5 on a barbell). Tap the number to type it; hold +/- to repeat.
 5  The progression reason, phrased as information.
 6  The primary button repeats the values. Always directly under the steppers, never moved by panels.
 7  Secondary text buttons, 44 px tall; each panel opens below this row. Skip is no longer a twin of Log.
 8  Warm-up dots (small) before working-set dots; read aloud as "0 of 2 sets done, 4 warm-ups".
 9  Extra space above. Asks for confirmation inline.
```

**B. Rest screen with undo (problems 1, 2, 7)**
```
+----------------------------------------------------------+
| Full body                Step 1 of 5 . 1/6 sets . 6:03   |
+----------------------------------------------------------+
| Logged: Set 1 . 5 x 87.5 kg        [ Edit ]  [ Undo ]    | 1
|                                                          |
|                         Rest                             |
|                        1:12                              | 2
|               ==========---------                        |
|                                                          |
| Next: Set 2 of 2 . 5 x 87.5 kg              [ Change ]   | 3
|                                                          |
| [ -15 s ]   [ +15 s ]   [*      Skip rest       *]       | 4
+----------------------------------------------------------+
| (step list, still tappable)                              |
+----------------------------------------------------------+
 1  Edit reopens the steppers in place and re-sends log_set with the same set id.
    Undo reopens the set (server change) and cancels the rest.
 2  About 72 px numerals plus a bar, readable from the bench.
 3  Opens the next set's steppers without ending the rest.
 4  Same row height and position as Log set on the set screen; the card keeps the set card's minimum height.
 At 0:00 the timer area reads "Rest over" with [*Start set 2*] for a moment, then the set screen.
```

**C. Summary (problem 14)**
```
+----------------------------------------------------------+
| Workout finished                                         |
| 45 min . 6 working sets . 1,355 kg lifted                |
|                                                          |
| New best                                                 | 1
|  Barbell Squat: estimated 1RM 102.1 kg (was 96.3)        |
|                                                          |
| Barbell Squat      2 x 5 x 87.5 kg                       |
| Pullups            1 x 8, bodyweight                     |
| Bench Press        1 x 8 x 60 kg                         |
|   Note: Pause on the chest                               |
| Skipped            Bench Press set 2                     | 2
| Running            10 min . 1.5 km . ~133 kcal           | 3
|                                                          |
| Sent to Claude. It will reply below; ask it to fix       | 4
| anything that is wrong.                                  |
+----------------------------------------------------------+
 1  New bests as their own block with a text heading, not colour.
 2  Skipped sets are listed so the record is honest.
 3  "~" marks the estimate.
 4  No step list, no footer, no disabled buttons. On a send failure: "Could not send to Claude. [ Send again ]".
```

## Open questions
1. **Weight step.** Is 0.5 kg per tap a deliberate product rule, or may the step depend on equipment, with 0.5 kg kept by typing?
2. **Undo or reopen a set.** Needs a server change to `log_set`. Acceptable? Should Undo also work after the rest ends (e.g. for the whole exercise)?
3. **Fixing sets from the chat.** Should Claude be able to fix a logged set after the workout? Today `log_set` is app-only and no chat tool edits a single set (not every tool was checked).
4. **Finish early.** Should it post a message to Claude at all, or only save and let the person talk?
5. **Get-ready countdown** for timed sets: always, optional, or none?
6. **Rest-end cue.** Does `navigator.vibrate` work inside the Claude host iframe on Android (and it does not exist on iOS)? Is a locally generated audio tone allowed?
7. **Swap back.** Does `swap_exercise` accept swapping back to the original exercise? Not verified.

## What was not verified
- Screen-reader behaviour of the `aria-live` region with nested `role="timer"` (needs VoiceOver and TalkBack).
- The large header time on a finished workout reopened later: inferred from l.520, not run.
- Contrast ratios: estimated from hex values, not measured; host variables may override them.
- The wording of the server's `lastTime` and summary `done` strings (builder code not read), and what `motionView.ts` does under reduced motion beyond reading the media query (l.152).
- The tap-position overlap in problem 1: measured from screenshots at one width (398 px); it will differ with other content.
