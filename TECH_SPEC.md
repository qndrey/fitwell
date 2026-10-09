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

### Gate 4 — Workouts
- **Entry:** Gate 3.
- **Deliverables:** exercise + activity build scripts and search, cardio logging with MET estimate/override, strength logging, previous performance, repeat last, templates, custom exercises/activities.
- **Exit:**
  - [ ] Exercise search p95 < 30 ms; file budget met; filters by muscle/equipment correct on fixtures.
  - [ ] MET calculation matches hand-computed cases; skipped when no weight or habit-only.
  - [ ] Simulated dataset update (remove/rename IDs) leaves user workouts intact via snapshot + legacy map.
  - [ ] Timed task: repeat-last strength workout and adjust ≤ 30 s.
  - [ ] Written decision recorded on Compendium: permission obtained, or cited-only table confirmed.

### Gate 5 — Weight & measurements
- **Entry:** Gate 4.
- **Deliverables:** weight card/quick-add, goal weight, measurement types (presets + custom), hints, log form, reminder card, hide-body-tracking.
- **Exit:**
  - [ ] Same-day replace/update semantics tested.
  - [ ] Weight fallback chain feeds cardio estimates correctly.
  - [ ] Hiding body tracking removes all related UI and charts but preserves data.
  - [ ] Unit round-trip tests (metric/imperial).
  - [ ] Copy review: no judgment colors or language.

### Gate 6 — History & Progress
- **Entry:** Gate 5.
- **Deliverables:** history calendar/list with pending marker, aggregates + rebuild, six charts, range selector, empty states, text alternatives/table view.
- **Exit:**
  - [ ] NFR-7 met with 3-year synthetic dataset on throttled mobile.
  - [ ] Aggregate rebuild equals incremental (property test).
  - [ ] Calculations (moving average, Epley, weekly averages, measurement deltas) unit-tested with fixtures incl. gaps and DST weeks.
  - [ ] Every chart has summary text, table view, keyboard focus; axe clean in both themes.
  - [ ] Readable at 320 px width.

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
