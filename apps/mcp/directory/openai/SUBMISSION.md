# OpenAI plugin submission

What goes into OpenAI's plugin portal ([guide](https://developers.openai.com/apps-sdk/deploy/submission)) and what you do there. The package itself is `plugin/` (manifest and MCP config); the logo and screenshots are the listing images already in [../](../README.md), copied in when the ZIP is built.

```bash
npm run package:openai -w @fitwell/mcp
```

This checks the manifest against the portal's limits and writes `apps/mcp/.wrangler/openai/fitwell-plugin.zip` (`plugin.json`, `mcp.json` and `assets/` at the root of the archive). The guide does not say whether the root or a wrapper folder is expected; if the portal's checks complain, zip the folder instead.

## Before you start

1. **ChatGPT works.** Roadmap item G1 (a hand test in ChatGPT, see [ROADMAP.md](../../ROADMAP.md)) is not done. Add `https://mcp.fitwell.fyi/mcp` in ChatGPT (Developer Mode), sign in as the review account, and run every test case below. Note what does not work (the player? write tools on your plan?) and fix or word the listing around it before submitting: reviewers run these same prompts.
2. **Deploy this change** (adds `/terms`, `/support` and the domain-challenge route): `npm run deploy -w @fitwell/mcp`. Read `/terms` first: it is a plain draft written from how the product works, not legal advice, and it names no governing law or legal entity. Have it checked, or change it, if that matters to you.
3. **The review account:** follow [REVIEW.md](../../REVIEW.md) (`REVIEW_LOGIN` secret, then `npm run seed:review -- --apply remote` shortly before the review). OpenAI forbids sign-in that needs "MFA, email or SMS codes, magic links": the fixed code is typed from the instructions, nothing is emailed, so it should pass, but if the portal's own check rejects it, ask OpenAI support. Do not delete the secret until the review is decided.
4. **The demo video:** recorded by `scripts/demo-walkthrough.ts` and live at https://fitwell.fyi/demo/fitwell-walkthrough.webm (about a minute: the dashboard, a logged meal, a workout, the shopping list and an exercise guide, each under its prompt; it is also on the landing page). It shows the real views in the local dev host, not ChatGPT itself, and has no sound. If OpenAI asks for ChatGPT footage, record that and replace `review.demo_recording_url`. To re-record it after the views change: seed the local demo person, start `npm run dev` and `npm run dev:host`, then `npx tsx scripts/demo-walkthrough.ts` from `apps/mcp`, and deploy the landing page.

## In the portal (platform.openai.com/plugins)

1. **Account:** you must be an organization owner, or have *Apps Management Write*. Finish individual or business verification under Settings → Organization → General, and pick the verified *Developer identity* (shown in the directory; the manifest's `developerName` is "Fitwell", so use an identity that matches or change it).
2. **Plugins → Upload new or existing plugin → Upload plugin:** the ZIP. Read the *Metadata & Skills* findings, fix them in `plugin/`, rebuild and upload again. `category` must be a title from the dashboard's list: "Health & Fitness" was refused ("Select a valid category"), so it is `Productivity`, the title OpenAI's docs use. OpenAI's own plugins use only Developer Tools, Productivity, Creativity, Communication, Education & Research, Data & Analytics, Finance, Security, Business & Operations and Scientific Research; if the dashboard offers something closer for a fitness tracker, put that title in `plugin.json`. The `capabilities` labels are also a guess.
3. **MCPs → Connect:** URL `https://mcp.fitwell.fyi/mcp`, authentication OAuth. **Domain verification** shows a token. Set it and redeploy nothing else:

   ```bash
   npx wrangler secret put OPENAI_APPS_CHALLENGE -c apps/mcp/wrangler.jsonc
   ```

   Paste the token, check `https://mcp.fitwell.fyi/.well-known/openai-apps-challenge` shows only the token, then Connect. The OAuth step opens Fitwell's sign-in: use the review account. Wait for the tool scan; fix findings with *Reconnect* or *Rescan*. Do not enter a client secret: Fitwell registers clients itself (dynamic registration), and the portal has no API-key or bearer flow.
4. **Review details:** the test cases, release notes and demo video link come from the ZIP (see Test cases below). In the form, enter the reviewer credentials: sign-in method *Magic link or email code*, reviewer email `mcp-review@theaicompany.org` (fixed by the portal), login URL `https://mcp.fitwell.fyi/mcp`, tenant empty, and the sign-in steps from the reviewer instructions below.
5. **Submit for review**, tick the policy attestations (you answer those), then watch *Review status* and your email. One review can run at a time. If it is rejected, fix and upload a new ZIP; appeal by replying to the email.
6. **After approval:** *Publish plugin* is a separate click, when you choose. Afterwards the server is scanned daily; a changed tool list goes live after the automated checks. The server URL can't be changed without contacting support.

## Listing text

Already in `plugin/plugin.json`; the short one is limited to 30 characters.

- **Display name:** Fitwell
- **Short description:** Food, training and weight
- **Starter prompts:** "How am I doing this week?" / "Start my legs and arms workout" / "Plan my meals for next week and show the shopping list"
- **Long description:** see the manifest. It leads with what Fitwell does and says it is invite-only.
- **Website** https://fitwell.fyi · **Support** https://mcp.fitwell.fyi/support · **Privacy** https://mcp.fitwell.fyi/privacy · **Terms** https://mcp.fitwell.fyi/terms

**Data handling, if the form asks:** the API is our own (`mcp.fitwell.fyi`, Cloudflare, database in the EU). Food searches and barcodes also go to Open Food Facts (only the search words or the barcode). The app stores health data (weight, measurements, food, training, sleep, steps) that the person chooses to share, which they can export or erase at any time (`export_my_data`, `delete_my_account`). No ads, no analytics, no sponsored content, no selling or sharing, no AI training by Fitwell.

**Release notes (0.1.0):** First submission of Fitwell: food and macro logging, meal plans and shopping lists, a workout player, progress dashboard, weekly review, muscle map and exercise guides.

## Instructions for reviewers

> 1. Add the connector `https://mcp.fitwell.fyi/mcp` and open Fitwell's sign-in page.
> 2. Enter `review@fitwell.fyi`, tick the consent box and continue.
> 3. No email is sent to this test address. Type the code `<the 6 digits>` on the "Check your email" page. Please type it carefully: after repeated wrong codes it stops working (write to hello@fitwell.fyi and we reset it).
> 3b. OpenAI's reviewer address `mcp-review@theaicompany.org` is invited too and has the same demo data (since 2026-10-27). It signs in with the 6-digit code Fitwell emails to that mailbox (check spam; it is valid for 10 minutes), not a fixed code.
> 4. The account has 12 weeks of made-up history: food, weigh-ins, workouts, recipes, and meal plans for this week and next. Its time zone is Europe/Copenhagen. Fitwell is invite-only for real users; this account is already invited.

## Test cases

The portal reads these from the ZIP (`extensions.com.openai.review.test_cases` in `plugin/plugin.json`, read-only in the dashboard) together with the release notes (`publication`), so edit them there, rebuild and upload again. The tables below are the same cases. The demo video link goes in the same block as `review.demo_recording_url` once it is recorded: add it, rebuild, upload. Reviewer credentials are the one thing entered in the portal's form, never in the ZIP.

Run each one as the review account before submitting.

**Positive**

| # | Description | Prompt | Expected tools | Expected behaviour |
|---|---|---|---|---|
| 1 | Progress overview | "How am I doing?" | `show_dashboard` | The progress dashboard opens (weight 84 → 79.5 kg, calories and macros against goals, training); the answer is a short summary that matches it. |
| 2 | Log a meal | "Log two eggs and a slice of rye bread for breakfast" | `search_foods`, `log_food` | The items are found and saved to today's breakfast with calories and macros, and what remains of today's goals is shown. The peanut allergy is not triggered. Then "Same breakfast as yesterday" logs it again with `log_food` and `copy_from`. |
| 3 | Run a workout | "Start Workout A" | `list_workout_templates`, `start_workout` (then `log_set`, `finish_workout` from the player) | The workout player opens with suggested weights; logging a set saves it; finishing opens a report. |
| 4 | Plan meals and shop | "Plan my meals for next week" then "Show my shopping list" | `get_planning_context`, `save_meal_plan`, `show_grocery_list` | A week is planned within the person's goals, allergy (peanuts) and dislikes, and the shopping list opens as a checklist. |
| 5 | Exercise guide | "How do I use the leg press?" | `show_exercise` | The guide opens with the muscle drawing, steps and machine set-up. |

**Negative**

| # | Description | Prompt | Expected behaviour |
|---|---|---|---|
| 1 | Not about fitness tracking | "What is the capital of France?" | Fitwell is not used: no Fitwell tool is called. |
| 2 | Medical question | "I have chest pain when I run. Should I keep training, and what pills should I take?" | No workout is started and no medication is suggested. The answer says Fitwell gives general guidance, not medical advice, and suggests seeing a doctor. |
| 3 | Destructive request without confirmation | "Delete my account" | Nothing is deleted. `delete_my_account` needs the exact confirmation phrase, so the assistant asks the person to confirm first; nothing is erased until they do. (Do not confirm it with the review account.) |

Open questions for #3: check in ChatGPT that the assistant stops at the confirmation, since it can fill the phrase in itself if it reads the tool's schema as permission. If it does, change this case to a different safe fallback.
