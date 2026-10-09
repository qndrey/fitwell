# Fitwell — Technical Specification & Implementation Gates

Companion to [PLAN.md](PLAN.md). PLAN explains *why*; this document defines *what must be true* and *when a phase may be called done*.
Normative words: **MUST**, **SHOULD**, **MAY** (RFC 2119).

---

## 0. Changes since the plan (decision log)

| Date | Change | Why |
|---|---|---|
| 2026-10-09 | **Bundled food dataset is Frida 5.5 (DTU, Denmark, CC BY 4.0), not USDA FoodData Central.** Foods are referenced as `bundled` / `frida:<id>`. | User preference for an EU source. Licence confirmed via the figshare record; English names included. |
| 2026-10-09 | Frida has 1,381 usable foods (USDA was ~7,500), ~28 KB gzip. **No Web Worker or prebuilt index**: a linear scan with ranking takes well under 15 ms. | Simpler; NFR-6 met by a wide margin. Revisit if the dataset grows past ~10k foods. |
| 2026-10-09 | Bundled foods have **no portion sizes** (Frida has none); they are logged in grams. Custom foods can define a serving. | Not inventing portion weights. A curated common-portions table is a candidate follow-up. |
| 2026-10-09 | `dailyAggregates` store is **deferred to Gate 6**; Today computes totals from the day's entries. | Not needed for one day; built with its rebuild test where charts need it. |
| 2026-10-09 | **Open Food Facts text search uses the legacy `cgi/search.pl`** behind a single adapter (`src/off/client.ts`). Checked while building Gate 3: the newer search-a-licious service returns **no nutrition fields** and sent **no `Access-Control-Allow-Origin`** for a foreign origin, so it can't serve a browser-only app; `/api/v2/search` has no text search. The legacy endpoint was answering **503 "temporarily unavailable"** every time I tried (4 requests, over several minutes), so live behaviour and CORS for it are **unverified**. Run `npm run smoke:off` when OFF is up. | Don't ship Gate 3 as "done" without that check. If search.pl is unusable from browsers, options: a tiny stateless proxy, barcode-only lookups (CORS-enabled product API), or dropping online lookup. |
| 2026-10-09 | **Open Food Facts checked live (curl, with an `Origin` header):** the product-by-barcode API (`/api/v2/product/<code>`) answered 200 with `access-control-allow-origin: *` every time (5/5). The text search `cgi/search.pl` returned the same CORS header and full nutrition JSON **when it answered (4 of ~11 tries)** and a 503 maintenance page otherwise, whatever the User-Agent: intermittent load shedding, not a block. The app already treats 503 as "wait and retry" (30 s pause shared by all lookups, not charged to the entry), and typed-food lookups never depend on a single try. | Typed-food lookup is best-effort; barcode lookup is the dependable path. |
| 2026-10-09 | **Barcode scanning added (was out of scope for v1)** at the user's request. Camera + BarcodeDetector where available (Chrome/Edge/Samsung on Android), otherwise `barcode-detector` → ZXing-C++ WebAssembly, **self-hosted** (the library defaults to jsDelivr; overridden), precached (+1.1 MB) so it also works offline. Unknown/offline/busy → "keep it for later": the barcode joins the pending queue and is looked up via the product API. Typing the number is always available. CSP gains `'wasm-unsafe-eval'` (no `eval()`), Permissions-Policy `camera=(self)`. Video frames never leave the device; only the digits are sent. | Scan in a shop with poor signal, confirm later. |
| 2026-10-09 | Gate 4: exercise search reuses the app's own ranker (typo-tolerant name match + muscle/equipment filters) instead of adding MiniSearch: 876 exercises don't need it, and it saves a dependency. Bundled library split into a 19 KB-gzipped search index and a lazy 131 KB-gzipped how-to file (both precached, total precache ≈ 2.1 MiB). | Simpler; fast offline. |
| 2026-10-09 | Gate 4: cardio MET table is ~58 hand-assembled, rounded values following the published Compendium tables, credited in the app; **no bulk import**. Permission from the Compendium maintainers is still to be requested before any larger use. Body weight for estimates is the Settings value until weight logging exists (Gate 5), via `currentWeightKg()`. | Per decision 1. |
| 2026-10-09 | Gate 6: **no `dailyAggregates` store.** Day summaries and chart series are computed on demand from the day indexes (`loadRange`) by pure functions in `domain/stats.ts`, so they cannot drift from the records and there is nothing to rebuild after an import or migration. Measured: 3 years of data (≈ 3,400 food entries, 1,500 workouts) renders Progress in ≈ 120–150 ms (1 yr) / ≈ 270–320 ms (all) under 4× CPU throttle. Revisit (store + rebuild test) if a real user reaches tens of thousands of entries. | Simpler and verifiably correct; performance target met. |
| 2026-10-09 | Gate 6: charts are hand-written SVG (`src/charts`, ≈ 7 KB gz in the Progress chunk) with a ~30-line scale/tick helper, **not d3**. The Progress screen is its own lazy chunk (≈ 7 KB gz). | Smaller than d3 pieces; full control over accessibility (focusable, keyboard-scrubbable, text + table alternatives, marker shapes). |
| 2026-10-09 | Gate 6 bug found by tests: a settings field could be reset to its saved value by an effect that ran just after mount (typing/clearing quickly was undone), and an `Intl.DateTimeFormat` was being constructed per label (≈ 40 % of Progress render time). Both fixed; SVG `tabindex` must be lowercase or the chart isn't focusable. | See tests. |
| 2026-10-09 | Gate 5: messages with an "Undo" are now shown **inside the open sheet** (a modal sheet makes everything outside it untappable, so the old global toast could not be pressed while a sheet was open, e.g. deleting a saved meal). The global toast is used when no sheet is open. | Real usability bug found by the new measurement-type test. |
| 2026-10-09 | Test tooling: axe's `target-size` rule is off in e2e (`tests/helpers/a11y.ts`) because it flags any button the pinned "Add food" bar partly covers at the current scroll position; 44 px sizes are asserted directly instead. | Avoids a false positive without dropping the 44 px requirement. |
| 2026-10-09 | Design system added (Figtree self-hosted, token files, `src/ui`, Lucide icons, live style guide). Initial JS budget now measured over `index-*` + `ui-*` chunks. | Consistency before more screens. |
| 2026-10-09 | Attribution (CC BY 4.0 citation) is shown in Settings from Gate 1; the full About screen stays in Gate 7. | CC BY requires attribution as soon as data ships. |

Where this document or PLAN.md says "USDA", read "Frida" for the bundled food dataset (the USDA licence row is superseded by the table in §11 below).

## 1. Locked decisions

| Area | Decision |
|---|---|
| Stack | Preact + signals, Vite, TypeScript strict, plain CSS tokens, native `<dialog>`/`<details>`; Zag.js only if the food combobox needs it |
| Storage | IndexedDB via `idb`, repository layer, no `localStorage` for user data |
| PWA | `vite-plugin-pwa` (Workbox precache), installable, offline after first load |
| Search | Main-thread ranked scan over the bundled Frida foods (see §0); MiniSearch for exercises; local user data ranked first |
| Charts | d3-scale/shape/array + own SVG components, lazy-loaded with Progress route |
| Validation | valibot for import and OFF responses |
| Hosting | Cloudflare Pages / Netlify at root domain; configurable `base` retained |
| Day rule | Local calendar day, stored as `YYYY-MM-DD` strings |
| Energy | kcal only; grams base unit with per-food portions |
| Persistence | `navigator.storage.persist()` requested on first save |
| MET data | ~60 hand-assembled, cited activities; no bulk Compendium import until permission is obtained |
| OFF | Explicit "Search online" button only; shared rate limiter; no data other than the search term sent |
| i18n | English only; all strings through `t()` |
| Out of scope | Accounts, sync, barcode, images, push, plate math, kJ |

---

## 2. Non-functional requirements (global budgets)

| ID | Requirement | Measured by |
|---|---|---|
| NFR-1 | Initial JS ≤ 90 KB gzip; Progress chunk ≤ 30 KB gzip; USDA data ≤ 350 KB brotli; exercise search file ≤ 60 KB brotli | `size-limit` in CI, fails build |
| NFR-2 | Third-party requests: **zero**, except OFF search host when the user presses "Search online" or the queue runs | Playwright network assertion: any other origin fails test |
| NFR-3 | No analytics, trackers, remote fonts, CDNs. Fonts self-hosted or system stack | Same test + CSP |
| NFR-4 | CSP: `default-src 'self'; connect-src 'self' https://world.openfoodfacts.org; img-src 'self' data:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'` | Header file + e2e check |
| NFR-5 | Local interactions respond < 100 ms; no spinners for local reads | Playwright trace, 4× CPU throttle |
| NFR-6 | Food search p95 < 50 ms per keystroke after warm-up; cold index load < 400 ms on throttled mobile | Perf test under 6× throttle |
| NFR-7 | Progress screen, 1 year of synthetic data: interactive ≤ 400 ms after chunk load; each chart ≤ 100 ms render | Perf test with generated fixtures |
| NFR-8 | WCAG 2.2 AA basics: keyboard-complete, visible focus, contrast ≥ 4.5:1 text / 3:1 UI, labelled inputs, reduced-motion respected, 44 px touch targets | axe-core on every screen × 2 themes + manual checklist |
| NFR-9 | Lighthouse (mobile): Performance ≥ 90, Accessibility ≥ 95, PWA installable | Lighthouse CI |
| NFR-10 | Data durability: no write acknowledged to the user unless the IDB transaction committed | Repo tests; QuotaExceeded test |
| NFR-11 | Tone: no red/green semantic colors on weight/measurement/calorie deltas; no shaming copy | Copy checklist + token lint (forbids `--danger` usage outside destructive confirmations) |
| NFR-13 | **Mobile-first**, verified at 320×640 touch in `tests/e2e/mobile.spec.ts` on every phase: no horizontal scroll on any screen; interactive targets ≥ 44 px; the primary action is pinned in the bottom thumb zone and never hides content; sheets keep a stable height (pinned search, scrolling results, bottom action) so the on-screen keyboard never causes jumps; common entries (quantities) need no keyboard; inputs ≥ 16 px (no iOS zoom). Larger screens only add (sidebar nav at ≥ 840 px, centred sheet at ≥ 600 px). | Playwright mobile project + manual device check each gate |
| NFR-14 | **Design system**: all UI built from tokens/components in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); no raw colours/lengths in component CSS; contrast + colour-blind palette checks; style guide at `/#/design` passes axe in both themes. | `npm run contrast`, `npm run tokens`, `tests/e2e/design.spec.ts` |
| NFR-12 | Browser support: last 2 versions of Chrome, Safari (iOS 16.4+), Firefox, Edge | Playwright projects: Chromium, WebKit, Firefox |

---

## 3. Module specifications

### 3.1 Storage layer (`src/db`)
- DB name `fitwell`; stores per PLAN §2.2. All access through repositories; UI never touches `idb` directly.
- Repos MUST set `id`, `createdAt`, `updatedAt`, `rev` and MUST soft-delete (`deletedAt`) for user-created records. Queries exclude tombstones by default.
- Multi-record changes (e.g. entry + daily aggregate) MUST be one transaction.
- `weightEntries` and `measurementEntries`: at most one live row per `day`; upsert semantics enforced in the repo inside a transaction.
- Migrations: ordered, idempotent, tested against fixture DBs from every previous schema version. Before a data-rewriting migration, snapshot affected stores to `backup_v{n}`; delete after the next successful boot.
- `onversionchange` MUST close the connection and prompt reload; `blocked` MUST be surfaced calmly.
- A `Persistence` service wraps `storage.persist()` / `storage.estimate()`; `QuotaExceededError` MUST surface a non-alarming message with an "Export backup" action.
- Cross-tab: `BroadcastChannel('fitwell')` emits `{store, ids}` after commit; signals refresh from it.

### 3.2 Domain (`src/domain`, pure, no I/O)
- `nutrition.scale(per100g, grams)`; rounding: kcal to integer, macros to 0.1 g, applied at display and entry-snapshot time only.
- Quantity → grams: `g` direct; `portion` via the food's portion table; `serving`/`piece` require a defined portion, else the UI asks for grams.
- Totals include `resolved` entries only; `pendingCount` = entries in `pending`, `awaiting_confirmation`, `unmatched`.
- Cardio kcal = `MET × kg × hours`; skipped if no weight source (latest weight → settings fallback → none) or `habitOnly`. Override wins. The weight used is stored in the workout.
- Epley 1RM = `w × (1 + reps/30)`; used only for working sets with reps ≤ 12; reps = 1 → `w`.
- Moving average: 7 calendar-day window, requires ≥ 3 points in the window, else gap.
- Unit conversion: canonical kg/cm/km; round-trip tests so metric → imperial → metric drift < 0.05 display units.

### 3.3 Food search (`src/search`, `src/data`)
- Result order: (1) favorites, recents, saved meals, custom → (2) locally cached OFF/USDA foods → (3) bundled USDA. OFF is never auto-queried by typing.
- USDA build script outputs columnar JSON + prebuilt token index, content-hashed, with `dataVersion`. CI fails if a build produces differing output for the same pinned input (determinism).
- Query: 80 ms debounce, ASCII-fold, prefix match on last token, ≤ 30 results; fuzzy (distance 1) only if < 3 results.
- Free-text fallback: a persistent "Log as '<text>'" row; creates a `pending` entry.

### 3.4 Open Food Facts (`src/off`)
- Single adapter `OffClient.search(term): Promise<Candidate[]>`; request uses `credentials:'omit'`, `referrerPolicy:'no-referrer'`, 10 s timeout via `AbortController`.
- Rate limiter: 1 in flight, ≥ 1.5 s spacing, ≤ 6 requests/min, interactive requests preempt queue requests. 429/503 → global pause honoring `Retry-After`, default 60 s.
- Response parsing via valibot; reject candidates lacking energy and macros; sanity cap 900 kcal/100 g; max 10 candidates stored (top 5 on queue entries).
- Cache: normalized query → candidates, 7-day TTL; selected foods stored in `foods` indefinitely.
- Attribution string and badge per PLAN §4.

### 3.5 Pending queue (`src/queue`)
- State machine exactly as PLAN §8. `resolved` is reachable **only** from a user action; this MUST be asserted by a test that scans the reducer.
- Single runner via Web Locks (`fitwell-queue`); triggers: app start, `online`, `visibilitychange` → visible, new pending entry, scheduled retry while open.
- Backoff `min(30 min, 15 s × 2^n) ± 20%`; after 8 attempts, stop auto-retry until next open and show a manual "Try again".
- Stale-result guard: apply a result only if the entry still exists, is `pending`, and `queryVersion` matches (single transaction check-and-write).
- Dedup: in-flight map by normalized query; identical queries share one request.

### 3.6 Workouts (`src/features/workout`)
- Strength: workout → exercises (ordered) → sets `{type, reps, weightKg}`; "Last time" shown from the most recent prior workout containing the exercise, via `exerciseSets` index.
- "Repeat last workout" copies structure into a new workout on the selected day with weights prefilled and `done=false`.
- Templates save/load structure; deleting a template MUST NOT affect logged workouts.
- Bundled vs. custom exercises/activities: separate ID namespaces (`ex:`, `act:`, `cx:`, `ca:`); workouts store both ref and name snapshot.

### 3.7 Body tracking
- Weight: one per day, upsert; goal weight is direction-neutral (display "Goal: X", distance shown as plain difference, no "ahead/behind").
- Measurements: enabled types only appear in the form; partial entries allowed; same-day edit updates the set; reminder is an in-app card only, dismissible, never blocking.
- "Hide body tracking" removes weight card, measurement entry, Progress charts (a), (f) and History body rows without deleting data.

### 3.8 Progress (`src/charts`, `src/features/progress`)
- Six charts per brief; each has: headline text, `<figure role="img">` summary, "View as table" toggle, empty-state hint when below minimum data (weight trend ≥ 3 points, per-exercise ≥ 2 sessions, measurements ≥ 2 entries).
- Aggregates: `dailyAggregates` store written in the same transaction as source records; full rebuild function used after import/migration; rebuild MUST equal incremental result (property test).
- Downsampling: > 6 months → weekly buckets for dense series; LTTB for weight points; raw daily points only ≤ 180 days.

### 3.9 Settings, backup, import
- Export: `{app:'fitwell', schemaVersion, exportedAt, installId, data:{...}}`, excludes bundled data, caches and derived aggregates; includes tombstones.
- Import: valibot validation → migrate in memory → preview counts → **replace** (default) or **merge** (id match, newer `updatedAt` wins, tombstones win ties). Failure MUST leave the existing DB untouched (single transaction).
- Delete all: typed confirmation; clears IDB, caches, and unregisters nothing else.
- Backup reminder: after 14 days since `lastBackupAt` (or first data), shown at most once per 7 days, dismissible.

### 3.10 PWA
- Precache app shell + datasets; `skipWaiting` disabled; "Update available" toast applies on user action or next cold start; never reloads during an open edit.
- Navigation fallback to `index.html`; manifest with maskable icons, `display: standalone`, theme colors for both schemes.
- iOS: show a one-time, dismissible "Add to Home Screen" hint (storage is less likely to be evicted when installed).

---

## 4. Quality gates (apply to every phase)

**Merge gate (every PR):** `tsc --noEmit`, ESLint, unit + repo tests, `size-limit`, license check, and axe tests pass. No `any` in `db/` or `domain/`. Coverage ≥ 90% lines in `domain/`, `queue/`, `db/migrations`.

**Phase exit gate:** all items in that phase's checklist, plus: manual smoke on one real low-end Android and one iOS Safari (installed PWA); no open P0/P1 bugs; PLAN/SPEC updated if behavior diverged; tag `phase-N`.

---

## 5. Phase gates

Each gate has **Entry** (what must exist), **Deliverables**, and **Exit criteria** (testable).

### Gate 0 — Foundations
- **Entry:** decisions in §1 confirmed (done).
- **Deliverables:** repo + CI; Vite/Preact/TS; tokens (light/dark/system); router; layout shell with 4 tabs; DB open + migration runner + one real migration test; repo base class; `t()`; `check-licenses`; CSP header file; About skeleton.
- **Exit:**
  - [ ] App installs and loads offline (Playwright offline test).
  - [ ] Fixture-DB migration test passes (v1 → v2 dummy).
  - [ ] Contrast of all token pairs ≥ AA, verified by script in both themes.
  - [ ] NFR-2/3/4 network + CSP test green.
  - [ ] CI pipeline < 5 min.

### Gate 1 — Meals, offline  *(built; see status below)*
- **Entry:** Gate 0.
- **Deliverables:** Today screen (day nav, slots, totals), USDA build script + worker search, add-food flow, quantity/portion entry, custom foods, recents/favorites/saved meals, edit/delete, habit-only toggle, `storage.persist()` call.
- **Exit:**
  - [ ] NFR-6 search budgets met.
  - [ ] Timed task: log breakfast+lunch+dinner+snack from recents/search in ≤ 30 s (3 testers, median).
  - [ ] Totals correct against a hand-verified fixture of 20 foods.
  - [ ] Deterministic data build; data ≤ 350 KB brotli.
  - [ ] Soft-delete + edit tested; reload keeps all data.

**Gate 1 status (2026-10-09):**
- [x] NFR-6 search budget: ranked scan incl. typo fallback < 15 ms avg in unit test (Node). *Not yet measured on a real low-end phone.*
- [ ] Timed task ≤ 30 s with 3 testers — needs people. An automated run logging 3 foods from recents completes in about a second.
- [x] Totals correct against a hand-computed day (3 foods) plus unit tests; *the 20-food fixture in the gate is not done*.
- [x] Deterministic data build (byte-identical on re-run); data ≈ 28 KB gzip.
- [x] Soft delete (with undo), edit, reload persistence, offline logging — Playwright.
- [x] axe clean on the add-food sheet steps incl. validation errors, both themes.

### Gate 2 — Backup first
- **Entry:** Gate 1.
- **Deliverables:** export, import (replace/merge, validation, preview), backup reminder, storage estimate in Settings, quota-error UX.
- **Exit:**
  - [ ] Property test: random dataset → export → wipe → import → deep-equal.
  - [ ] Import of corrupt/newer-version/old-version fixtures behaves per §3.9; DB untouched on failure.
  - [ ] Merge conflict tests (newer wins, tombstone wins ties).
  - [ ] 50k-record import completes < 5 s on throttled profile without blocking input > 100 ms.

**Gate 2 status (2026-10-09):**
- [x] Round trip: 25 seeded random datasets (with tombstones) → export → import into an empty DB → deep-equal. Destination `installId` untouched; bundled/derived data excluded.
- [x] Corrupt / non-Fitwell / newer-version / invalid-field / older-version / unknown-field fixtures behave per §3.9; failures are explained calmly. Atomic: an injected mid-import write failure leaves the DB identical.
- [x] Merge: newer `updatedAt` wins, tie → deletion wins, unions disjoint data (rule + per-record test).
- [~] 50k records: parse+validate ≈ 0.3 s, write ≈ 3.6 s in Node with fake-indexeddb (single transaction). **Not verified on a throttled phone**, and parse+validate runs on the main thread, so a 50k-record import could block input for >100 ms on a phone. Move parsing into a worker if real-device testing shows it matters (typical backups are far smaller).
- [x] Backup reminder (data exists, stale ≥ 14 days or never backed up, snooze 7 days), storage usage + persisted status in Settings, "Ask the browser to protect it", quota errors explained with a Save-backup action, replace needs a second confirm with a "save a copy first" option.
- Not done: Web Share (save-to-Files sheet) — plain file download is used; delete-all-data stays in Gate 7.

### Gate 3 — OFF + pending queue
- **Entry:** Gate 2 (so users can already back up).
- **Deliverables:** OFF client + limiter, state machine, triggers, review screen, badges, "+N pending", manual search, candidate selection, caching.
- **Exit:**
  - [ ] State-machine table test covers every transition; assertion that only user actions yield `resolved`.
  - [ ] Playwright offline flow: offline → log pending → reload → online → candidates → confirm.
  - [ ] Race test (edit during in-flight lookup) discards stale result.
  - [ ] Duplicate-request test: 3 identical pending → 1 request.
  - [ ] Backoff/429/503 tests with fake timers; limiter never exceeds 6/min in a 5-min soak test.
  - [ ] Two-tab test: one runner only.
  - [ ] Written confirmation (or documented attempt) from OFF about browser-client usage and attribution wording.
  - [ ] Attribution visible in About and on OFF foods.

**Gate 3 status (2026-10-09):**
- [x] State machine: table-tested; invariant test over every state × event proves only `USER_RESOLVE` can resolve an entry. Matches are never auto-applied (e2e checks totals stay 0 until the user chooses).
- [x] Playwright offline flow (`context.setOffline`): log without nutrition → reload (still queued) → online event → suggestions → review → choose a *different* candidate → totals update; chosen food is found offline afterwards.
- [x] Race: text edited while a lookup is in flight → stale answer discarded, corrected text looked up (unit test on real IndexedDB + e2e with a held response). Also resolved/deleted-meanwhile cases.
- [x] Duplicates: 3 identical foods → 1 request (unit + e2e). Two tabs → one runner (Web Locks) and both tabs see the result.
- [x] Backoff 15 s·2ⁿ ±20 % (cap 30 min), stop after 8 attempts until next app start or manual retry; 429/503 pause the shared limiter (Retry-After) without blaming the entry; limiter never exceeds 6/min and spaces calls ≥ 1.5 s (fake-clock tests); results cached 7 days (1 day for empty).
- [x] Privacy: only the search text is sent (no cookies/referrer/custom headers, plain GET); explicit "Search online" button, nothing on keystrokes; a setting turns online lookup off entirely; attribution on results and in Settings.
- [x] Review screen + "N items to confirm" on Today; per item: confirm suggestion, pick another, search myself (typo-tolerant), enter values by hand, look up again, remove. Axe clean in both themes.
- [x] **Live OFF verification** (endpoints, CORS, response shape): done with curl and `npm run smoke:off`; see decision log. Text search is intermittently 503; the queue backs off.
- [ ] **Written confirmation from OFF** that browser-based apps may call it (and how to identify the app, since browsers can't set `User-Agent`).
- Notes: pending entries are logged in grams only (a free-text name has no portion table); Frida foods remain gram-based.

**Barcode scanner (added after Gate 3):**
- [x] ZXing decoding verified against generated EAN-13/UPC-A images (Node) and end-to-end in Chromium with a fake camera stream showing a real barcode, through both the native-reader path and the forced WebAssembly path, under the production CSP.
- [x] Found / unknown / OFF busy / offline (kept → queue → review) / camera blocked (manual entry, invalid check digit explained) / online lookup off (no button). Camera tracks are stopped on success and on close. Only `/api/v2/product/<digits>?fields=…` is requested; no CDN requests. Axe + 320 px + 44 px targets in both themes.
- [ ] **Not yet tried on a real phone camera** (focus, glare, low light, iOS Safari standalone). Needs a manual pass on a real iPhone and an Android device.
- Cost: first install precaches ~1.4 MiB (the decoder is 1.1 MB, ~460 KB gzipped on the wire).

### Gate 4 — Workouts
- **Entry:** Gate 3.
- **Deliverables:** exercise + activity build scripts and search, cardio logging with MET estimate/override, strength logging, previous performance, repeat last, templates, custom exercises/activities.
- **Exit:**
  - [ ] Exercise search p95 < 30 ms; file budget met; filters by muscle/equipment correct on fixtures.
  - [ ] MET calculation matches hand-computed cases; skipped when no weight or habit-only.
  - [ ] Simulated dataset update (remove/rename IDs) leaves user workouts intact via snapshot + legacy map.
  - [ ] Timed task: repeat-last strength workout and adjust ≤ 30 s.
  - [ ] Written decision recorded on Compendium: permission obtained, or cited-only table confirmed.

**Gate 4 status (2026-10-09):**
- [x] Exercise library: 876 exercises, stable ids `ex:<id>`, deterministic build; search is offline and typo-tolerant; muscle/equipment filters; instructions load on demand; custom exercises and custom activities live in IndexedDB with their own id spaces (`cx:`, `ca:`), so library updates can't touch them.
- [x] Cardio: MET × kg × hours (unit-tested incl. missing/invalid inputs); skipped, not guessed, without a weight; your own number overrides and shows without "≈"; hidden in habit-only mode (e2e). Distance follows the units setting.
- [x] Strength: exercises → sets (weight, reps, warm-up/working), autosave while you type (debounced + flushed on hide), "Add set" copies the previous set, "Last time: 3×8 @ 60 kg" (earlier workouts only, warm-ups ignored; tested incl. same-day ordering and deleted workouts), pounds/kilograms (stored in kg), empty workouts are not left behind.
- [x] Repeat last (strength or cardio), templates (save, start from, delete with undo), delete with undo, edit anywhere. All of it is in backups (round-trip e2e).
- [x] Axe clean in both themes, 320 px no overflow, 44 px targets on the workout screens.
- [ ] Timed task "repeat-last strength workout and adjust ≤ 30 s" needs people; automated: repeat takes two taps.
- [ ] Written decision on the Compendium (permission) — still open (see above).
- Not in this gate: per-exercise progress charts and estimated 1RM display (Gate 6; the Epley helper and "previous performance" query are ready).

### Gate 5 — Weight & measurements
- **Entry:** Gate 4.
- **Deliverables:** weight card/quick-add, goal weight, measurement types (presets + custom), hints, log form, reminder card, hide-body-tracking.
- **Exit:**
  - [ ] Same-day replace/update semantics tested.
  - [ ] Weight fallback chain feeds cardio estimates correctly.
  - [ ] Hiding body tracking removes all related UI and charts but preserves data.
  - [ ] Unit round-trip tests (metric/imperial).
  - [ ] Copy review: no judgment colors or language.

**Gate 5 status (2026-10-09):**
- [x] One weight per day: logging the same day replaces it (same id `weight:<day>`, revives a deleted one); same for measurement sets (`meas:<day>`), partial sets allowed, editing the day updates it. Stored in kg / cm, shown in the chosen units without drift (round-trip tests incl. lb ↔ kg and in ↔ cm).
- [x] Latest logged weight feeds cardio estimates and beats the Settings value (e2e: 9.8 × 70 × 0.5, not × 100); the Settings weight remains the fallback; no weight → no estimate.
- [x] Presets (waist, hips, chest, neck, left/right upper arm, thigh, calf, body fat %) with stable ids and a how-to hint each; waist/hips/chest on by default; switching on/off in Settings never gets overwritten by later releases; your own types (name + unit) can be added, renamed, removed with undo; body fat is a typed percentage (no formulas).
- [x] Only enabled types appear in the log form; last values appear as placeholders; values for types switched off are kept.
- [x] Goal weight is direction-neutral ("Goal weight 85 kg · 5 kg away"); no BMI, no categories, no ahead/behind wording (asserted).
- [x] Hide body tracking removes the weight card, measurements and reminder everywhere and keeps the data; unhiding restores it.
- [x] Measurement reminder (1/2/4 weeks): in-app only, never for people who haven't measured before, snooze 3 days.
- [x] Weight, measurement types and entries, goal weight and the new settings are in backups (round-trip + validation tests; implausible weights rejected).
- [x] Axe, 320 px and 44 px checks on the weight sheet, measurements sheet (with hints) and the Settings/Manage screens, both themes.
- Not in this gate: weight trend and measurement charts (Gate 6).

### Gate 6 — History & Progress
- **Entry:** Gate 5.
- **Deliverables:** history calendar/list with pending marker, aggregates + rebuild, six charts, range selector, empty states, text alternatives/table view.
- **Exit:**
  - [ ] NFR-7 met with 3-year synthetic dataset on throttled mobile.
  - [ ] Aggregate rebuild equals incremental (property test).
  - [ ] Calculations (moving average, Epley, weekly averages, measurement deltas) unit-tested with fixtures incl. gaps and DST weeks.
  - [ ] Every chart has summary text, table view, keyboard focus; axe clean in both themes.
  - [ ] Readable at 320 px width.

**Gate 6 status (2026-10-09):**
- [x] **History**: month calendar (7 columns, Monday first) with a mark per kind of data (circle food, square workout, triangle body: shapes, not just colours), a **dashed outline plus the words "to confirm"** on days with unresolved food, today outlined, a spoken summary per day ("Friday 9 October: 2,140 kcal, 2 workouts, 72.4 kg, 1 to confirm"); tap opens that day. List view grouped by month with "Show earlier months". Honours habit-only (no calories) and hidden body tracking (no weight/measurement marks or legend entry).
- [x] **Progress**, range 1 mo / 3 mo / 6 mo / 1 yr / All (remembered while the app is open): weight (faint daily dots + 7-day average as the main line, headline = *trend change over the period*, optional goal line), calories and macros (daily bars up to ~3 months, weekly averages beyond; averages ignore days without food; metric switch; target line if set), workouts per week (strength solid vs cardio hatched), per-exercise strength (best set and Epley estimated 1RM, formula stated), cardio totals per week (activity filter, time/distance), body measurements (pick several, one chart per unit, change over the period, first-vs-latest table).
- [x] Friendly empty states for every chart (checked on a fresh install); neutral wording asserted (no "good/bad/ahead/behind…").
- [x] Every chart: `role="img"` with a text summary, headline in plain text, tap/drag or ←/→ to read exact values (announced politely), legend with marker shapes, and the same numbers as a table (built only when opened).
- [x] Calculations unit-tested with gaps, DST weeks, month clamping, unsorted input (moving average, trend, weekly averages, workouts/week, cardio per week, exercise progress, measurement comparison, LTTB downsampling).
- [x] Performance (NFR-7, 4× CPU throttle, 3 years of seeded data): Progress ready in ≈ 120–150 ms (1 yr) and ≈ 270–320 ms (all); History month ≈ 30 ms; ≤ 500 SVG elements per chart. Not measured on a real low-end phone.
- [x] Axe clean in both themes at 320 px for Progress (charts and opened tables) and History (calendar and list); no horizontal scroll.
- [ ] Period headline wording for the moving average on the very first days of data relies on ≥ 3 readings in 7 days; people who weigh in weekly will see the "log a few times" hint until they weigh more often. Worth revisiting after real use (maybe a 14-day window as a fallback).

**Gate 7 status (2026-10-09), release candidate `1.0.0-rc.1`:**
- [x] **Goals** (all optional): daily calories, protein/carbs/fat, workouts per week (+ goal weight under Body tracking). Shown only as a quiet caption on Today ("2,000 kcal · P 120 g", "This week 1 · target 3") and a dashed reference line on the charts; never a limit, remainder or score (asserted). Hidden in habit-only mode.
- [x] **Delete all data**: typed word, backup offered first, closes the connection and deletes the whole database, the theme mirror and any runtime caches, then reloads into a fresh start with a calm confirmation. Test inspects every store and Cache Storage afterwards.
- [x] **About and data sources** (lazy screen): privacy in plain words, datasets with their attribution (Frida DOI/licence, free-exercise-db commit, Open Food Facts ODbL, Compendium citation, ZXing-C++), every shipped library with its licence text (generated by `scripts/build-licenses.ts`, checked in CI by `check:about`). The old ad-hoc credit cards in Settings are gone.
- [x] **Install**: "Add to Home Screen" hint for iPhone/iPad (one-time, dismissible, shown after you have data, always explained in Settings) and an Install button when the browser offers one.
- [x] **Update toast** exists since Gate 0 (applies only on tap, never mid-edit); an end-to-end check needs two deployed builds, see RELEASE_CHECKLIST.
- [x] **Copy pass**: automated tone lint over all 480+ strings (no exclamation marks, blame, scoring, streaks, praise/pressure, weight labels, commands); two strings reworded.
- [x] **Final a11y pass**: axe clean on all 7 routes × 2 themes with data; keyboard open/Escape/focus-return (found and fixed: focus did not return to the opener after a sheet closed; a goal field lost its label association); reduced motion.
- [x] **Lighthouse (mobile)**: performance 99, accessibility 100, best practices 100, SEO 100 (added `robots.txt`); Chrome reports no installability errors; `npm run lighthouse` enforces the thresholds in CI.
- [x] README with privacy statement and deploy steps; RELEASE_CHECKLIST.md; version `1.0.0-rc.1`.
- [ ] NFR-12 on **WebKit and Firefox**: the projects are configured and run in CI; not run locally yet (browsers not installed here).
- [ ] Manual screen-reader pass and real-device checks (see RELEASE_CHECKLIST.md).

### Gate 7 — Settings, polish, release
- **Entry:** Gate 6.
- **Deliverables:** goals, units, theme, habit-only everywhere, delete-all, About/attributions generated from one source, update toast, iOS install hint, copy pass, final a11y pass.
- **Exit:**
  - [ ] NFR-1 … NFR-12 all green in CI.
  - [ ] Manual screen-reader pass (VoiceOver iOS, TalkBack or NVDA) on Today, add food, review queue, a chart.
  - [ ] Licenses audit: every dependency and dataset listed in About with required text; `check-licenses` clean.
  - [ ] Lighthouse targets met.
  - [ ] "Delete all data" verified to leave empty DB and caches.
  - [ ] Release checklist signed: README, privacy statement ("data never leaves your device"), version tag.

---

## 6. Traceability (brief requirement → where verified)

| Brief area | Spec § | Gate |
|---|---|---|
| Today, 30-second logging | 3.2–3.3 | 1 |
| Food sources & priority | 3.3, 3.4 | 1, 3 |
| Pending queue | 3.5 | 3 |
| Workouts, MET, templates | 3.6 | 4 |
| Weight & measurements | 3.7 | 5 |
| History, Progress | 3.8 | 6 |
| Settings, export/import | 3.9 | 2, 7 |
| PWA/offline | 3.10, NFR-9 | 0, 7 |
| Privacy/no third parties | NFR-2–4 | 0 (continuous) |
| Accessibility/dark mode | NFR-8, 11 | every gate, 7 |
| Sync-ready data | 3.1 | 0, 2 |

---

## 7. Open items tracked by gates
1. Compendium permission outcome — Gate 4.
2. OFF browser-client confirmation — Gate 3.
3. Final name, icon, contact email — before Gate 7.
