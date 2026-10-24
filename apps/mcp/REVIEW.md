# Directory review: the reviewers' demo account

Anthropic's Connectors Directory review needs a test account with data in it ([submission guide](https://claude.com/docs/connectors/building/submission)). Fitwell signs people in with an emailed code, and reviewers can't read our emails, so one address has a fixed code instead:

- **Address:** `review@fitwell.fyi`. It doesn't need a mailbox, because no email is ever sent to it.
- **Sign-in:** the Worker secret `REVIEW_LOGIN` (`email:code`, 6 digits) lets that address sign in with the code. Everything else is unchanged: it must be invited, tick the consent box, and stay within 10 minutes, 5 tries per sign-in and 5 sign-ins an hour. Because the code is fixed, wrong codes also add up across sign-ins: after 20 in 30 days the fixed code stops working, and that address gets an emailed random code like anyone else, which nobody reads. A malformed secret, or one naming an address in `ADMIN_EMAILS`, turns it off (`src/auth/login.ts`, `parseReviewLogin`).
- **Data:** `scripts/seed-review.ts` builds 12 weeks of history by calling Fitwell's own tools, then replaces that account's rows in D1. Running it again resets the demo, and dates are always relative to today. The history covers food (about 85 % of days fully logged), weigh-ins (84 → 79.5 kg), waist and hips, sleep, steps and water, Workout A and B three times a week with progression, runs, four recipes, and meal plans with ticked groceries for this week and next. It also includes a peanut allergy, so allergy warnings show.

## Before a review

From the repository root:

```bash
npx wrangler secret put REVIEW_LOGIN -c apps/mcp/wrangler.jsonc
```

Paste `review@fitwell.fyi:` followed by 6 random digits. That code goes into the portal's Test & launch step.

```bash
npm run seed:review -w @fitwell/mcp -- --apply remote
```

Run this again just before a reviewer is likely to look, so "today" and "this week" have data. The server must be deployed with the `REVIEW_LOGIN` support (this change) for the code to work.

If reviewers report that the code stopped working, someone has guessed wrong 20 times. Set a new code with `wrangler secret put REVIEW_LOGIN`, then clear the count:

```bash
npx wrangler d1 execute fitwell --remote -c apps/mcp/wrangler.jsonc --command "DELETE FROM login_requests WHERE email = 'review@fitwell.fyi'"
```

## After the review

```bash
npx wrangler secret delete REVIEW_LOGIN -c apps/mcp/wrangler.jsonc
```

The account and its data can stay. Without the secret it can only sign in by email, which it can't receive.

## What to paste into the portal

**Test & launch (instructions for reviewers):**

> 1. In Claude (web or desktop), open Settings → Connectors → Add custom connector and enter `https://mcp.fitwell.fyi/mcp`.
> 2. Claude opens the Fitwell sign-in page. Enter `review@fitwell.fyi`, tick the consent box and continue.
> 3. No email arrives for this test address. Type the code `<the 6 digits>` on the "Check your email" page. Please type it carefully: after repeated wrong codes it stops working (write to hello@fitwell.fyi and we'll reset it).
> 4. The account has 12 weeks of made-up history: food logs, weigh-ins, workouts, recipes and this week's and next week's meal plans. Its time zone is Europe/Copenhagen.
>
> Example prompts:
> - "How am I doing?" opens the progress dashboard (`show_dashboard`).
> - "How did my week go?" opens the weekly review (`show_weekly_review`).
> - "Start Workout A" opens the workout player with suggested weights (`list_workout_templates`, `start_workout`). Log a set, then "Finish and send to Claude" (`log_set`, `finish_workout`).
> - "Same breakfast as yesterday" logs it again (`log_food` with `copy_from`) and shows what's left of today's goals.
> - "Show my shopping list" opens next week's checklist (`show_grocery_list`).
> - "Which muscles did I train this month?" opens the muscle map (`show_muscle_map`).
> - "How do I use the leg press?" opens the exercise guide (`show_exercise`).
> - "Plan my meals for next week" (`get_planning_context`, `save_meal_plan`; the peanut allergy is checked).

**Use cases → what users need before they can connect:**

> An invitation. Fitwell is in early access: ask for an invite at https://mcp.fitwell.fyi/request-access (or email hello@fitwell.fyi) and, once it is approved, you get an email with the steps. Then add the connector and sign in with the 6-digit code from the email. No password, no separate app.

**Listing:**

- **One-liner:** "Track food, training and weight by talking to Claude." Keep the invite in the description and the requirements field rather than here.
- **Description:** start with what it does (food logging with macros, meal plans and shopping lists, a workout player, progress dashboards). End with: "Fitwell is invite-only during early access; see fitwell.fyi to ask for an invitation."
- **Carousel (MCP App screenshots):** the five PNGs in [directory/](directory/README.md), with their paired prompts.
- **Documentation URL:** https://fitwell.fyi (how to join, what it does). **Privacy policy:** https://mcp.fitwell.fyi/privacy. **Support:** hello@fitwell.fyi.

An uninvited person who signs in from the directory sees the same "Check your email" page as everyone (so it doesn't reveal who is invited). Both sign-in pages say "Fitwell is invite-only… Not invited yet? Ask for an invite" (a link to the request form).

**Data handling:** the API is our own (`mcp.fitwell.fyi`). Food searches and barcodes are also sent to Open Food Facts, a third party we don't control (only the search words or barcode). It does handle personal health data (weight, body measurements, food, training), and there's no sponsored content.
