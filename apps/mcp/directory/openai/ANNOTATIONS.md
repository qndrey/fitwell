# Tool annotation justifications

Every tool sets `readOnlyHint`, `destructiveHint` and `openWorldHint` to an explicit boolean (filled in one place, `withAnnotations` in `src/instructions/index.ts`; enforced by `tests/annotations.test.ts`). `tests/readonly-tools.test.ts` calls every read-only tool against a fresh database and fails if any table changes.

Rules used:

- **read-only**: changes nothing, not even a flag.
- **destructive**: can delete or overwrite something the person saved or entered, or cannot be undone (an email sent, data shown to a friend).
- **open-world**: reaches outside Fitwell (Open Food Facts, a web page, email to someone else).

## Read-only, closed-world (36)

`suggest_targets get_food_log export_my_data search_exercises show_exercise get_exercise_guide get_workout get_substitutes get_workout_history suggest_progression list_workout_templates get_program list_challenges get_progress get_recipes get_planning_context get_meal_plan list_household show_grocery_list suggest_meals show_dashboard get_dashboard_data show_muscle_map get_muscle_map show_lift_progress get_review_data show_today get_today_data show_meal_plan get_meal_plan_data list_friends list_received_items show_crew_feed list_friend_invites list_invite_requests list_invitations`

They only read the signed-in person's own data (or compute from it) and return it or open a view of it.

## Read-only, open-world (3)

- `search_foods`, `lookup_barcode`: query Open Food Facts (public). The only write is a shared cache of public Open Food Facts results (`off_cache`); it holds no user data and no link to the person.
- `import_recipe`: fetches a web page the person named and parses the recipe; nothing is saved until `save_recipe`.

## Not read-only, not destructive (35)

Additive or transient edits: they add rows or change short-lived state, and never remove or overwrite something the person entered.

`get_profile` (on a new account's first call it records that the setup guide was offered; otherwise reads), `add_injury log_food save_custom_food start_workout log_set set_rest log_cardio_block swap_exercise finish_workout log_past_workout log_cardio log_session create_challenge invite_to_challenge accept_challenge log_planned_meal invite_to_household accept_household_invite set_grocery_checked import_fitwell_backup show_weekly_review get_streaks set_streak_freeze show_celebration today_eat_planned today_quick_add today_add_water plan_eat_meal request_friend accept_friend send_to_friend accept_received_item give_kudos add_invitation`

Notes: `log_set` with `reopen` and `set_rest` change the current workout's transient state; `swap_exercise` only works while no sets are logged; `import_fitwell_backup` never changes existing entries; `show_celebration` marks a milestone as seen; `set_grocery_checked` toggles a tick box.

## Destructive, closed-world (32)

Each can delete or overwrite saved content:

- Deletes: `delete_item delete_my_account end_injury end_program cancel_challenge leave_challenge leave_household decline_challenge decline_household_invite decline_friend remove_friend decline_received_item cancel_friend_invite decline_invite_request remove_invitation`
- Overwrites: `update_profile` (replaces the given profile fields: time zone, units, sex, birth year, height, weight, activity level, equipment, diet preferences, allergies, dislikes; used only for the person's own calorie estimates, allergy warnings and meal plans, never shared; exportable with `export_my_data`, erasable with `delete_my_account`), `set_goals edit_food_entry edit_workout_set log_body` (a value for a day replaces the one there), `save_recipe save_workout_template` (same name replaces), `save_meal_plan` (same week replaces), `create_program` (ends the running one), `set_household_portion use_household_plan set_exercise_note` (empty note removes it), `plan_swap_recipe plan_copy_meal plan_repeat_day` (replace planned meals), `set_nickname` (overwrites or clears)
- Cannot be undone: `set_sharing` (granting shows data to a friend)

## Destructive, open-world (2)

`send_friend_invite`, `approve_invite_request`: send an email to someone else, which cannot be unsent (the second also deletes the request). They are the only tools that send email.

## Short text for the portal's "Additional Submission Context"

Every tool has explicit boolean hints. Read-only tools change nothing (an automated test calls each against a fresh database and asserts no row changes); the three open-world read-only tools query Open Food Facts or a user-named web page. Destructive means a tool can delete or overwrite something the person saved, or cannot be undone; the two tools that email someone else are marked destructive and open-world. Per-tool reasoning: apps/mcp/directory/openai/ANNOTATIONS.md.
