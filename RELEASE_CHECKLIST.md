# Release checklist: 1.0.0-rc.1

Legend: ✅ verified automatically (CI / local run) · 🧑 needs a person · ⚠️ open decision

## Automated (run `npm run check && npm run build && npm run size && npm run licenses && npm run check:about && npm run test:e2e && npm run lighthouse`)
- ✅ Types, lint, 160 unit tests, 230+ browser tests (desktop Chrome + Pixel 5 emulation); WebKit/Firefox projects run in CI.
- ✅ Third-party requests: none except Open Food Facts on request; strict CSP; no CDN (tests assert origins).
- ✅ Accessibility: axe (WCAG 2.2 A/AA) on every screen in light and dark, charts, sheets and tables; keyboard flows; focus returns to the opener; reduced motion.
- ✅ Contrast of all design tokens, chart palette checked for colour-vision deficiency.
- ✅ Mobile-first: 320 px, no horizontal scroll, 44 px targets.
- ✅ Lighthouse (mobile): performance 99, accessibility 100, best practices 100, SEO 100. Chrome reports the app as installable.
- ✅ Performance under 4× CPU throttle with 3 years of data: Progress ≈ 120–320 ms, History ≈ 30 ms.
- ✅ Bundle: initial JS ≈ 50 KB gzipped (budget 90). Offline after first load. Backups round-trip losslessly.
- ✅ Licences: production allow-list clean; every shipped library listed in About with its licence text (`npm run check:about`).
- ✅ Delete all data leaves an empty database and no caches (test).

## Needs a person
- 🧑 **Real devices**: iPhone Safari (installed to Home Screen) and a low-end Android. Check: logging a day in under 30 s, offline logging, barcode scanning (focus, glare, low light), charts readable, nothing clipped by the notch or keyboard.
- 🧑 **Android home-screen icon**: on a real Android phone, add Fitwell both ways ("Install app" and "Create shortcut") from Chrome and check the icon, its shape on your launcher and, on Android 13+, the themed (monochrome) icon. Remove an old shortcut first: Android keeps the icon it was given when it was created.
- 🧑 **Screen reader pass**: VoiceOver (iOS) and TalkBack (Android) or NVDA on: Today, Add food (search, quantity), the review queue, a chart (summary, arrow keys, table), Settings, delete confirmation.
- 🧑 **Timed task**: median of 3 people logs breakfast+lunch+dinner+snack from recents/search in ≤ 30 s; repeat-last strength workout and adjust in ≤ 30 s.
- 🧑 **Update toast**: deploy two builds and confirm "A new version is ready" appears, never reloads mid-edit, and applies on tap.

## Open decisions / permissions
- ⚠️ **Open Food Facts**: written confirmation that browser apps may call their API (and how to identify the app, since browsers cannot set `User-Agent`). Text search is intermittently 503 under load; the app retries and degrades calmly.
- ⚠️ **Compendium of Physical Activities**: permission requested for anything beyond the ~58 rounded values currently credited.
- ⚠️ Pick the final name, icon and contact email (the icon is a placeholder).
- ⚠️ Decide hosting (Cloudflare Pages or Netlify recommended so `_headers` applies).

## Sign-off
Version `1.0.0-rc.1` (tag `v1.0.0-rc.1`). Promote to `1.0.0` when the person items above are done and the open decisions are settled.
