# fitwell.fyi landing page: UX report

Produced 2026-10-18 by the `ux-designer` agent in critique mode, from the page source (`apps/landing/site/src/routes/index.tsx`, `__root.tsx`, `src/styles.css`) and rendered screenshots of the current build (desktop 1280 px light and dark, mobile 390 px). Measured: the page is 10,101 px tall on desktop and 13,077 px on mobile, and it scrolls sideways on mobile (document 412 px in a 390 px viewport). I checked the code claims for problems 1, 7 and 8 against the source; contrast ratios are the agent's estimates from the token hex values, not measured.

## Summary

The page's idea and tone are right: a clear headline, real-looking chats, calm honest copy, restrained palette. What holds it back: a layout bug on mobile, numbers that disagree between copy and screenshots, screenshots that ignore the theme and are cut off mid-content, and a page that is longer than its pitch needs.

## Problems, ranked by impact

### 1. The page scrolls sideways on mobile (S)
- **Where:** step 2 of "How to join", the `https://mcp.fitwell.fyi/mcp` copy box; its Copy button is clipped at 390 px.
- **Cause:** `Step` uses `grid-cols-[2.5rem_1fr]` (`index.tsx:503`). A `1fr` track cannot be narrower than its content's min-content width, and the `<code>` in `CopyBox` is `truncate` (nowrap), so the track grows to the full URL.
- **Fix:** `grid-cols-[2.5rem_minmax(0,1fr)]`, or `min-w-0` on the step's content `<div>` (line ~506). Re-check at 320 px.
- **Why it matters:** this is the one step every invited person must complete.

### 2. Demo numbers contradict each other (S for copy, M if screenshots are recaptured)
| Where | Says | Screenshot shows |
|---|---|---|
| Chat 2 (`index.tsx` ~128) and energy alt (~154) | burn 2,940 kcal, 2,390 to lose 0.5 kg, trend −0.67 kg/week | `energy.png`: 2,810 kcal, 2,260 kcal, −0.54 kg/week |
| Nutrition alt (~146) | protein goal reached on 75 days | "76 of 81" |
| Hero alt (~322) | "last time 2 by 5 at 85 kg" | "5 @ 82.5, 5 @ 82.5, 4 @ 82.5", today 87.5 |
| Chat 3 (~133) | leg press 3×8, 120 → 122.5 kg | no matching screenshot |
| Features bullet (~160) | "add 2.5 kg when every set hit its reps" | hero: a set missed a rep, yet the suggestion is +5 kg |

The footnote under the chats (~349) says the numbers come from the demo person in the screenshots, which is not true today. Fix: rewrite chats 2 and 3 to match `energy.png` and the hero squat, correct the three alt texts, recapture the hero with a history where every set hit its reps (or explain the jump), and keep the footnote only once it is true. Open question: is +5 kg after a missed rep real product behaviour?

### 3. Screenshots ignore the theme, are cut off mid-content and are too small (M)
- **Theme:** all screenshots are light except `guide-squat-dark.png`, which is dark in both themes. In dark mode each light view is a bright slab; in light mode the guide is a black slab.
- **Cropping:** `Phone` crops with `max-h` plus `overflow-hidden` (`index.tsx:54-61`), so cuts land mid-row or mid-sentence (hero list row, guide text, review "Training", swap list).
- **Size:** the PNGs are 796 px wide (2× of a ~398 px view); in a 320 px frame text is ~9-10 px, and the side-by-side workout pair (~240 px each) is ~7 px: unreadable.
- **Fix:** capture both themes with `apps/mcp/scripts/screenshots.ts` (it already writes `<name>-light.png` and `<name>-dark.png`), render with `<picture><source media="(prefers-color-scheme: dark)" …>`, crop at natural card boundaries when capturing, add a bottom fade where a CSS crop remains, and never show two phones side by side (show one, or overlap a smaller second).

### 4. The page is too long and the feature rows dilute the pitch (M)
- Eight full-width feature rows with large gaps (`space-y-24 md:space-y-32`, line ~357); five have one or two bullets beside a 560 px phone, leaving empty half-columns. The player screenshot appears three times. Feature `h3` (30 px) is nearly as large as the section `h2` (36 px).
- **Fix:** group into three rows (Food, Training, Progress), each with one strong screenshot and 3-4 bullets; fold "Swap when the machine is busy" into Training; keep "Little things". Expected: roughly 6-7k px on desktop and about a third less on mobile.

### 5. Trust and privacy claims miss what a reviewer will ask (S)
"Your data stays yours" (lines ~398-422) says data is in the EU and never shared, but not that what someone types to Claude is processed by Anthropic under their Claude account (only Fitwell's records are in the EU), who runs Fitwell, or that sign-in emails go through Cloudflare (only mentioned in troubleshooting, ~231). The privacy-notice link is only in the footer (~488). "Health data stored in the EU" in the hero can read as "nothing leaves the EU". Fix: one precise sentence plus a link in the data block, and a footer line naming the operator once confirmed.

### 6. Invited visitors have no direct route; key facts are missing (S)
The only entry to the steps is "Ask for an invite". Add "Already invited? Connect it to Claude" under the hero CTAs linking to `#connect` (give step 2 that id), give the step 1 mailto a prefilled subject and body (which device they use Claude on), and add FAQ items "What does it cost?" and "Which Claude plan do I need?" once the answers are known.

### 7. FAQ and Troubleshooting widths are broken by a class conflict (S)
`Section` always applies `max-w-6xl` and appends `className` (`index.tsx:113`), so `<Section className="max-w-3xl">` (lines ~460, ~466) has two max-widths and the wide one wins: FAQ rows span about 1080 px while "How to join" is a centred 768 px column. Fix: build the class with the existing `cn()` (`src/lib/utils.ts`, tailwind-merge), or give `Section` a `width` prop. Also: the shield icon sits in its own column (~399), indenting that `h2` by about 100 px; put the icon above the heading.

### 8. Hero image loads lazily; Open Graph image is portrait (S)
`Phone` sets `loading="lazy"` on every image including the hero (`index.tsx:58`), the largest element on the first screen, and no image has `width`/`height`, so the layout shifts. `og:image` is the 796×1736 portrait hero (~30) with `summary_large_image`, which crops it to a strip. Fix: a `priority` prop (`loading="eager" fetchPriority="high"`) for the hero, intrinsic dimensions on images, and a 1200×630 OG card (logo, headline, one cropped view).

### 9. Accessibility details (S)
Already right: skip link, global `:focus-visible` ring, reduced-motion handling, `<details>` FAQs, logical heading order, `aria-live` on the copy result. To fix: the three wrong alt texts (problem 2); user chat bubbles use `bg-primary`, the same fill as buttons, so they look clickable (use a subtle fill or border); wrap the "↓" in "See what it does ↓" in `aria-hidden`; add `title={value}` to the truncated `<code>` in `CopyBox` so people can check what they paste.

### 10. Copy and tone (S)
Tone is right. Small fixes: the hero paragraph lists four actions in one sentence (shorten); the trust bullets wrap unevenly on desktop (reorder: "Invite-only · Health data stored in the EU · Claude on desktop, web and iPhone"); "Little things" is slightly cute next to the plain headings ("Also" or "And a few more"); troubleshooting item 1 (~231) is a 70-word paragraph, split into three short sentences or a list.

### 11. Mobile layout beyond the overflow (S)
Five "Little things" cards stack to about 900 px; use a compact list or two columns on small screens. Cap the hero phone around 480 px on mobile once the crop and fade are in.

## What works and should not change
- The headline "Track food, training and weight by talking to Claude".
- "You talk, it keeps the records." with real-looking chats (once the numbers match).
- The palette and restraint: paper and ink, charcoal buttons, terracotta only on logo, dots and icons.
- `CopyBox` with its clipboard fallback; the four "How to join" steps with exact menu names and a suggested first message.
- The honest disclosures (estimates, not medical advice, allergy checks are a help, Android untested, demo data, not affiliated with Anthropic, data sources credited).
- Troubleshooting written in the person's own words; the invite CTA repeated in the header.

## Prioritised plan
**Quick wins (S, about a day in total)**
1. Fix the mobile overflow: `minmax(0,1fr)` in `Step` (problem 1).
2. Make copy and alt numbers match the screenshots; fix the footnote (problem 2, copy part).
3. `cn()` in `Section` so FAQ and Troubleshooting are narrow again; move the shield icon above its heading (problem 7).
4. Eager-load the hero image; set image width and height (problem 8).
5. Add the Claude/Anthropic sentence and privacy link to the data block (problem 5).
6. "Already invited?" link with `#connect`, prefilled mailto, cost and plan FAQs once answered (problem 6).
7. Small accessibility and copy fixes (problems 9 and 10).

**Next (M)**
8. Recapture screenshots in both themes with natural crops, use `<picture>`, drop the two-up pair; recapture the hero so it follows the progression rule (problem 3).
9. Merge the eight feature rows into three groups (problem 4).
10. Make a 1200×630 OG card (problem 8).

## Open questions
- Is +5 kg after a missed rep (82.5 → 87.5 in `hero-squat.png`) real product behaviour? If so, the bullet at ~160 is wrong; if not, recapture the hero.
- Which Claude plans can add a custom connector? Not verified, not stated as fact.
- Is Fitwell free while invite-only? The page should say so either way.
- Who is named as data controller? The privacy notice (mcp.fitwell.fyi/privacy) was not read.
- The README says the design lives in Lovable and is copied into `site/`: fixes made directly in `site/` are overwritten by the next Lovable import unless also made in Lovable. Decide the source of truth.
