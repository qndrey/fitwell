# Fitwell — Technical Implementation Plan

Status: decisions in §0 confirmed (all defaults accepted; Preact + custom CSS, Cloudflare/Netlify root hosting, cited-only MET table, OFF via explicit button). Specs and phase gates live in [TECH_SPEC.md](TECH_SPEC.md). No app code written yet.

---

## 0. Decisions needing your confirmation (item 12, up front)

| # | Question | My default if you don't answer |
|---|----------|-------------------------------|
| 1 | **Compendium of Physical Activities licensing is unverified** (see §11). OK to ship a small hand-curated MET table (~60 activities) with citation, and email the Compendium maintainers for written permission before any larger import? | Yes. |
| 2 | **Open Food Facts search is limited to 10 req/min per IP** (per user, since calls come from the browser). Confirm: no search-as-you-type on OFF; explicit "Search online" button only. | Yes. |
| 3 | Framework: **Preact + Vite + TypeScript** (small bundle) vs React (bigger ecosystem). | Preact. |
| 4 | Hosting target: GitHub Pages sub-path (`/fitwell/`) vs root domain. Affects `base` and PWA scope. | Cloudflare Pages / Netlify at root; config works with a sub-path too. |
| 5 | Day boundary: calendar day in local time, no "late-night counts as yesterday" rule? | Local calendar day. |
| 6 | Energy unit: kcal only, or also kJ? | kcal only in v1. |
| 7 | Serving/unit model: grams as the base unit, plus per-food "portions" (1 egg = 50 g). Volume units (cup, ml) only where the food has a portion defined. OK? | Yes. |
| 8 | Persistent storage: ask the browser for `navigator.storage.persist()` on first meaningful save (no prompt on Chrome; Safari/Firefox may prompt). OK? | Yes. |
| 9 | Languages: English only for v1 (strings still go through a tiny `t()` helper). | English only. |
| 10 | Strength weight increments / plate math: skip in v1. | Skip. |
| 11 | Name/domain, app icon, and contact email for the OFF User-Agent string. | Name and domain placeholders. App icon: a leaf whose vein is a rising pulse line (`scripts/make-icons.ts`), also on the start-up screen (`public/splash.css`). |

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Schema safety for a long-lived local data model. |
| UI | **Preact + preact/compat not needed**, Preact signals | ~4 KB vs ~45 KB for React; signals give fine-grained updates on low-end phones. |
| Build | **Vite** | Fast, static output, first-class PWA plugin, easy worker/chunk splitting. |
| Routing | `wouter-preact` or ~60-line hash/history router | 4 tabs + a few modal routes; no need for a full router. Hash routing avoids SPA-fallback config on GitHub Pages. |
| Storage | **IndexedDB via `idb`** (~1.2 KB) with a thin repository layer | Structured, indexed, async, large quota. `localStorage` is too small and synchronous. Dexie (~25 KB) is nicer but heavier; `idb` + own repos keeps control over migrations. |
| PWA | `vite-plugin-pwa` (Workbox, `generateSW` precache) | Precaches the app shell + bundled datasets; offline after first load; installable. |
| Search | **MiniSearch** (~7 KB) for exercises and small food sets; **custom prefix index** for the USDA set (see §3) | MiniSearch gives fuzzy/prefix/field boost; USDA set is large enough that a purpose-built compact index is better on low-end phones. |
| Charts | **Hand-rolled SVG with `d3-scale` + `d3-shape` + `d3-array` (~12 KB gz)**, wrapped in small Preact components | Our six charts are lines, bars, and areas. uPlot (~15 KB) is canvas, poor for screen-reader text alternatives; Chart.js (~60 KB) and Recharts (~100 KB+) are overkill. SVG gives accessibility hooks (title/desc, focusable points) and crisp dark mode via CSS variables. |
| Styling | Plain CSS with custom properties (design tokens), no CSS-in-JS | Dark mode via `prefers-color-scheme` + `data-theme`; zero runtime. |
| Validation | `valibot` (~1 KB tree-shaken) for import validation and OFF responses | Much smaller than zod. |
| Dates | Own `YYYY-MM-DD` local-date helpers; `Intl.DateTimeFormat` | Avoids date-fns/dayjs and timezone bugs (store days as strings, never as UTC instants). |
| IDs | `crypto.randomUUID()`, or ULID-style time-sortable IDs for logs | Stable, collision-free, sync-ready. |
| Tests | Vitest (unit), `fake-indexeddb`, Playwright (e2e incl. offline), axe-core (a11y) | See §7. |

**Bundle budget:** initial JS ≤ 90 KB gz (app + libs), datasets lazy-loaded and precached separately. Datasets total ≈ 2–3 MB gz, precached after first load.

---

## 2. Data model

### 2.1 Conventions (sync-ready)
Every user-owned record has:
```ts
interface Base { id: string; createdAt: number; updatedAt: number; deletedAt?: number; rev: number }
```
- `id`: UUID/ULID, never reused. `updatedAt`: ms epoch, set by the repository layer only.
- `deletedAt` (soft delete / tombstone) on everything the user creates; purged by a "compact" job after 90 days (and never purged once sync exists without an ack).
- `rev` increments per write (for future last-writer-wins / merge).
- Dates of days are strings `YYYY-MM-DD` (`day`), not timestamps.
- Bundled data is **never** stored in user stores; it lives in static files. User records reference bundled items by stable ID + a snapshot (see 2.3).

### 2.2 Stores (IndexedDB object stores)

```ts
// ---- Foods ----
type FoodSource = 'usda' | 'off' | 'custom';
interface NutrientsPer100g { kcal: number; protein: number; carbs: number; fat: number;
                             fiber?: number; sugar?: number; sodiumMg?: number }
interface Portion { label: string; grams: number }          // "1 egg", "1 slice"

interface CachedFood extends Base {     // store: foods (cache of online + imported-from-bundle on use)
  source: 'off' | 'usda'; sourceId: string;       // OFF barcode / USDA fdcId
  name: string; brand?: string; per100g: NutrientsPer100g; portions: Portion[];
  fetchedAt: number;
}
interface CustomFood extends Base {     // store: customFoods
  name: string; brand?: string;
  basis: 'per100g' | 'perServing';
  per100g: NutrientsPer100g;            // normalized on save
  portions: Portion[];
}
// Bundled USDA foods: static file, read-only, ID "usda:<fdcId>"

interface FavoriteFood { id: string; foodRef: FoodRef; updatedAt: number; deletedAt?: number }
type FoodRef = { kind: 'usda'|'off'|'custom'; id: string };

// ---- Food log ----
type EntryState = 'resolved' | 'pending' | 'awaiting_confirmation' | 'unmatched';
interface FoodEntry extends Base {      // store: foodEntries; index: day, state
  day: string; slot: 'breakfast'|'lunch'|'dinner'|'snacks'; order: number;
  state: EntryState;
  queryText?: string;                   // free text the user typed (pending/unmatched/awaiting)
  quantity: { amount: number; unit: 'g'|'serving'|'piece'|'portion'; portionLabel?: string };
  // Snapshot: entries keep their own nutrition so totals never change if a cached food is edited/removed.
  foodRef?: FoodRef; foodName: string;
  nutrition?: { kcal: number; protein: number; carbs: number; fat: number }; // totals for this entry; absent unless resolved
  manual?: boolean;                     // values typed by hand
  lookup?: { attempts: number; nextAttemptAt?: number; lastError?: string;
             queryVersion: number;      // bumped when user edits queryText; guards races
             candidates?: Candidate[]; suggestedIndex?: number; completedAt?: number };
}
interface Candidate { source: 'off'; sourceId: string; name: string; brand?: string;
                      per100g: NutrientsPer100g; portions?: Portion[]; score: number }

interface SavedMeal extends Base { name: string; items: { foodRef: FoodRef; foodName: string;
                                    quantity: FoodEntry['quantity']; nutrition: FoodEntry['nutrition'] }[] }

// ---- Exercises ----
// Bundled: static "ex:<free-exercise-db id>"; custom: store customExercises
interface BundledExercise { id: string; name: string; category: string; level?: string; equipment?: string;
                            force?: string; mechanic?: string; primary: string[]; secondary: string[]; instructions: string[];
                            /* images?: string[]  -- reserved, not shipped in v1 */ }
interface CustomExercise extends Base { name: string; primary: string[]; equipment?: string; notes?: string }
interface CardioActivity { id: string; name: string; met: number; category: string }   // bundled "act:<slug>"
interface CustomCardioActivity extends Base { name: string; met: number }

// ---- Workouts ----
interface Workout extends Base {         // store: workouts; index: day
  day: string; type: 'cardio' | 'strength'; name?: string; startedAt?: number; notes?: string;
  cardio?: { activityRef: string; activityName: string; durationMin: number; distanceKm?: number;
             met: number; kcalEstimated?: number; kcalOverride?: number; weightKgUsed?: number };
  strength?: { exercises: { exerciseRef: string; exerciseName: string; order: number;
                            sets: { id: string; type: 'warmup'|'working'; reps: number; weightKg: number; done?: boolean }[] }[] };
}
interface WorkoutTemplate extends Base { name: string; type: 'cardio'|'strength'; body: Omit<Workout,keyof Base|'day'> }

// ---- Body ----
interface WeightEntry extends Base { day: string; kg: number }           // unique index on day (live rows)
interface MeasurementType extends Base { key: string; label: string; unit: 'length'|'percent'|'custom'; customUnit?: string;
                                         enabled: boolean; preset: boolean; order: number }
interface MeasurementEntry extends Base { day: string; values: Record<string /*typeId*/, number> } // canonical cm / % / raw
```
All units stored canonical (kg, cm, km); conversion only in the view layer.

### 2.3 Settings & goals (single-document stores)
```ts
interface Settings { id: 'settings'; units: 'metric'|'imperial'; theme: 'light'|'dark'|'system';
  habitOnly: boolean; hideBodyTracking: boolean; fallbackWeightKg?: number;
  measurementReminderWeeks?: 1|2|4; backupReminderDays: number;
  lastBackupAt?: number; lastMeasurementPromptDismissedAt?: number; updatedAt: number }
interface Goals { id: 'goals'; kcal?: number; proteinG?: number; carbsG?: number; fatG?: number;
  workoutsPerWeek?: number; goalWeightKg?: number; updatedAt: number }
```
Plus `meta` store: `{schemaVersion, installId, bundledDataVersions:{usda,exercises,activities}}`, and `lookupQueue` is **derived** from `foodEntries` where state in (`pending`, `awaiting…`) — no separate queue store, so the queue cannot drift from the log.

Derived/cached (rebuildable, never exported): `dailyAggregates` (`day → {kcal,p,c,f,pendingCount,workoutCount,weightKg?}`), maintained transactionally with each write.

### 2.4 Indexes
`foodEntries`: `day`, `state`, `[day+slot]`. `workouts`: `day`, `type`. `weightEntries`: `day` (unique among non-deleted — enforced in repo). `measurementEntries`: `day`. `foods`: `[source+sourceId]`, `name` (for local search). `recents` computed from entries (last 60 distinct foodRefs) and cached in `meta`.

### 2.5 Schema versioning & migrations
- IndexedDB `version` = integer DB schema; separate `meta.schemaVersion` = **logical data version** also written into every export (`{app:"fitwell", schemaVersion, exportedAt, data:{…}}`).
- Migrations: ordered array `migrations[n]: (tx) => Promise<void>`, run in the `upgrade` callback (store/index changes) and a post-open data pass for heavier transforms. Each migration is pure, idempotent, unit-tested with fixture DBs from every prior version.
- Before any migration with data rewrites: auto-snapshot affected stores into a `backup_v{n}` store; keep until the next successful start.
- Import: validate with valibot → if `schemaVersion` < current, run the same migrations on the in-memory object → if greater, refuse with a friendly "made with a newer version" message. Import modes: **replace all** (default, with a preview of counts) and **merge** (by `id`, newer `updatedAt` wins; tombstones respected).
- Bundled-data references use stable IDs, plus a `meta.bundledDataVersions` check; when a bundled ID disappears in a release, a `legacyIdMap.json` redirects it, and entries always hold a name snapshot, so nothing breaks.

---

## 3. USDA dataset plan

**Source:** USDA FoodData Central, Foundation Foods + SR Legacy (CC0 / US public domain). Download the official JSON/CSV bundles at build time (pinned release, checksum recorded).

**Fields kept per food** (≈ 8,000 SR Legacy + ~350 Foundation → ~7,500 after dedupe/filtering):
`id` (fdcId), `name` (cleaned: "Chicken, broilers or fryers, breast, meat only, cooked, roasted" → kept, plus a short display name generated by rule), `kcal, protein, carbs, fat` per 100 g (Atwater-corrected via nutrient 1008 or 2047/2048; fallback compute 4/4/9), optional `fiber, sugar, sodiumMg`, `portions[]` (from `foodPortion`: label + gram weight, max 4, dedup), `cat` (category index). Drop: micronutrients, footnotes, source-data details, branded entries, infant formula & baby foods, items with missing macros.

**Preprocessing script** (`scripts/build-usda.ts`, Node, run manually and in CI on version bump):
1. Parse CSVs → join nutrient/portion tables. 2. Normalize names, drop junk. 3. Emit **columnar JSON** (arrays per field, quantized to 1 decimal for macros/ints for kcal) → `foods.usda.v1.json`; plus a **separate search-token file**. 4. Brotli precompress; record `dataVersion` and a content hash.

**Expected size:** ~7,500 foods × ~60 B names + numbers ≈ 700 KB raw JSON columnar → **~200–250 KB brotli**. Portions add ~60 KB. Total < 350 KB.

**Search approach** (target < 30 ms/keystroke on a low-end Android):
- On first use (lazy-loaded chunk, then cached) build an in-memory index in a **Web Worker** to keep the UI thread free: tokenized lowercase/ASCII-folded words → posting lists (prefix lookups via sorted token array + binary search), with a simple scoring: exact word > prefix > second-word match, boosted by shorter names and by "raw/plain" over "prepared", with common-food boosts (hand-curated alias list: "chicken breast", "oats", "rice").
- Alternatively persist a prebuilt index inside the data file so there is no build step on the device (preferred: index built at preprocessing time, loaded as typed arrays).
- Fallback for typos: MiniSearch fuzzy (distance 1) only when the main query yields < 3 results.
- Local user data (recents/favorites/custom/cached) is small, searched on the main thread synchronously and ranked above bundled results per the required priority.

---

## 4. Open Food Facts integration

- **Endpoints (see TECH_SPEC decision log for what was verified):** barcode product API `/api/v2/product/<code>` (dependable) and, for typed text, `https://world.openfoodfacts.org/cgi/search.pl?search_terms=…&search_simple=1&json=1&page_size=10&fields=code,product_name,brands,nutriments,serving_size,serving_quantity` (verify against the current v2/search-a-licious docs at build time; the API is migrating, so isolate it behind `OffClient` with a single adapter).
- **Only the search term is sent.** No cookies (`credentials: 'omit'`), no referrer (`referrerPolicy: 'no-referrer'`), no user IDs.
- **User-Agent:** OFF asks apps to identify themselves with a custom UA (`Fitwell/1.0 (contact@…)`). Browsers forbid overriding `User-Agent` in `fetch`, so we cannot set it. Mitigation: use OFF's accepted alternative — pass identifying info via a query parameter / `app_name` style hint if documented, and **confirm with OFF** (their support/Slack) that browser-based apps are acceptable. This is flagged as a risk (§7).
- **Rate limits (official docs):** search 10 req/min/IP (applies per user for client-side apps), product reads 15 req/min; exceeding can cause 503/IP ban. Strategy:
  - Global token bucket in the app: max 6 searches/minute, min 1.5 s between requests, 1 in flight at a time.
  - No search-as-you-type against OFF; manual "Search online" button; the queue worker is the only other caller and shares the same bucket (interactive requests take priority).
  - Cache every response (query → candidate list, 7-day TTL) and every food the user picks (in `foods`, forever).
  - Honor `429/503` + `Retry-After`; exponential backoff with jitter; pause the queue for the cooldown period.
- **Offline behavior:** `navigator.onLine` is only a hint → also treat any failed fetch as offline. UI hides the "Search online" button's action (not the button) and offers "Log as pending" instead.
- **Normalization:** prefer `nutriments.*_100g`; reject candidates without energy/macros; compute kcal from kJ if needed; sanity-check ranges (kcal ≤ 900/100 g) and drop outliers; extract `serving_quantity` as a portion.
- **Attribution:** About screen + footer in search results: "Food data from Open Food Facts, © Open Food Facts contributors, licensed under ODbL 1.0; individual contents under the Database Contents License." Show a small "Open Food Facts" badge on foods from OFF. No images are fetched.
- **ODbL implication:** the cached data stays on the user's device and is exported with their own backup; we don't publish a derived database, so share-alike is not triggered. Do **not** bundle OFF data in the repo.

---

## 5. Folder structure

```
fitwell/
├─ public/                  icons, manifest source, robots
├─ data/                    raw inputs (gitignored) + pinned versions.json
├─ scripts/                 build-usda.ts, build-exercises.ts, build-activities.ts, check-licenses.ts
├─ src/
│  ├─ main.tsx  app.tsx  router.ts
│  ├─ styles/               tokens.css (light/dark), base.css, components.css
│  ├─ db/                   open.ts, migrations/, repos/ (foodEntries, workouts, weight, …), aggregates.ts, export.ts, import.ts, schema.ts (valibot)
│  ├─ domain/               nutrition.ts, units.ts, dates.ts, met.ts, oneRm.ts, movingAverage.ts, totals.ts
│  ├─ data/                 loaders for bundled datasets (lazy), generated/ (output of scripts)
│  ├─ search/               foodSearch.worker.ts, exerciseSearch.ts, ranking.ts
│  ├─ off/                  client.ts, normalize.ts, rateLimiter.ts
│  ├─ queue/                lookupQueue.ts (state machine), triggers.ts, backoff.ts
│  ├─ features/
│  │  ├─ today/  history/  progress/  settings/
│  │  ├─ food/ (addFood, review, customFood, savedMeals)
│  │  ├─ workout/ (cardio, strength, templates)
│  │  └─ body/ (weight, measurements)
│  ├─ charts/               LineChart.tsx, BarChart.tsx, Sparkline, a11ySummary.tsx
│  ├─ components/           Button, Sheet, Field, Badge, EmptyState, Toast
│  ├─ pwa/                  register.ts, updatePrompt.tsx, storagePersist.ts
│  └─ about/                attributions.ts (single source of truth for licences)
├─ tests/                   unit/, e2e/ (playwright), fixtures/ (db dumps per schema version)
├─ LICENSES/                third-party licence texts
├─ vite.config.ts  tsconfig.json  package.json
└─ PLAN.md
```

---

## 6. Phased build plan

| Phase | Scope | Milestone / exit criteria |
|---|---|---|
| **0. Foundations** (new, 2–3 d) | Repo, Vite+Preact+TS, CI, design tokens (light/dark, AA contrast), router, IndexedDB layer with migrations + repo pattern + export/import **skeleton**, About page skeleton. | App installs, works offline, DB open/migrate test passes. |
| **1. Shell + meals offline** | Today screen, day nav, slots, USDA build script + worker search, custom foods, recents/favorites/saved meals, quantity entry, totals, edit/delete. | Log a full day offline in < 30 s (timed manually); search p95 < 50 ms on throttled CPU. |
| **2. Export/import + backup reminder (pulled forward)** | Full export/import with validation, persisted-storage request, backup nudge. | Round-trip test: export → wipe → import = identical data. *Moved earlier than your Phase 6 because it is the only protection against data loss, so it must exist before anyone stores real history.* |
| **3. OFF + pending queue** | OFF client, rate limiter, state machine, triggers, review screen, badges, "+N pending". | Simulated-offline e2e green; kill-tab/reload resumes queue; no duplicate requests. |
| **4. Workouts** | Exercise + activity data scripts, search/filter, cardio with MET, strength sets, previous performance, repeat last, templates, custom items. | Log strength workout < 30 s using "repeat last". |
| **5. Weight & measurements** | Weight card + goal, measurement types/entry, reminders, hide-body-tracking. | Replacement semantics (one per day) tested. |
| **6. History + Progress** | Calendar/list, aggregates, all six charts, empty states, a11y text alternatives, perf pass. | 1 year of synthetic data renders < 300 ms on throttled mobile profile. |
| **7. Settings, polish, a11y** | Goals, units, habit-only, theme, delete-all, copy review for tone, axe + screen-reader pass, keyboard pass, Lighthouse PWA ≥ 95. | Release checklist (below). |

Why the changes: export/import before real usage (data-loss risk), and a Phase 0 so migrations/design tokens exist before features depend on them. Settings are touched incrementally in each phase (units and habit-only are needed from Phase 1), so Phase 7 is polish rather than first implementation.

---

## 7. Testing & risks

**Testing layers:** unit tests for pure domain code (totals, unit conversion, MET calc, moving average, Epley, migrations on fixture DBs, import validation); repo tests on `fake-indexeddb`; component tests (Vitest + Testing Library); Playwright e2e on Chromium/WebKit/Firefox with mobile emulation; axe-core on every screen in both themes; Lighthouse CI for PWA/perf budgets; property-based tests (fast-check) for "export → import is lossless" and "queue never loses an entry".

| Risk | Mitigation |
|---|---|
| **Storage limits/eviction** (Safari ITP evicts script-writable storage after ~7 days of non-use in browsers, not installed PWAs; low disk) | Request `navigator.storage.persist()`; show quota via `storage.estimate()` in Settings; install-as-PWA nudge on iOS ("Add to Home Screen" improves retention); catch `QuotaExceededError` and surface calmly, never silently dropping writes. |
| **Data loss** (user clears browser data) | Early export/import; periodic gentle backup reminder; "last backed up" in Settings; optional File System Access API / Web Share of backup file (progressive enhancement). |
| **Search performance on low-end phones** | Worker + precomputed index, lazy chunk, results capped at 30, debounce 80 ms, perf test under 6× CPU throttle in Playwright/CDP. |
| **Wrong OFF matches from free text** | Never auto-apply; confirmation required; show candidate nutrition inline so mismatches are obvious; "enter by hand" always available; entry stays out of totals until confirmed. |
| **OFF rate limits / UA header restriction / API change** | Token bucket, cache, adapter layer, contract tests against recorded fixtures plus a manual live smoke test; confirm browser-client policy with OFF. |
| **Compendium licence unclear** | See §11; ship minimal cited table, seek permission. |
| **Multi-tab concurrency** | Single-writer rule for the queue via Web Locks API (`navigator.locks`), `BroadcastChannel` to refresh UI; versionchange handler closes DB. |
| **PWA update staleness / bad service-worker deploy** | "Update available" toast (no forced reload mid-edit), versioned precache, kill-switch SW. |
| **iOS PWA quirks** (no `beforeinstallprompt`, background sync absent) | Triggers are foreground-only (open/online/visibility), never rely on Background Sync. |
| **Timezone / DST bugs** | Day strings, local-time helpers, DST test cases. |
| **Tone drift** (guilt-inducing copy/colors) | Copy lint list, neutral palette for deltas (no red/green), review checklist in PR template. |

---

## 8. Pending-food queue design

**State machine** (per `FoodEntry`):
```
            user logs free text            lookup returns ≥1 candidate
 (new) ──────────────────────▶ pending ───────────────────────────────▶ awaiting_confirmation
                                 │  ▲                                          │   │   │
          lookup returns 0       │  │ retry (network/5xx; stays pending)       │   │   └─ manual search ─▶ (new candidates, same state)
                                 ▼  │                                          │   └─ user edits text ──▶ pending (queryVersion++)
                             unmatched                                         ▼
                                 │                                        resolved ◀── user confirms / picks other / types values
                                 └─ search manually / custom food / enter values ──▶ resolved
```
Transitions to `resolved` happen **only** by a user action. `resolved` entries can be edited normally. Any state can be deleted (soft delete).

**Triggers:** app start, `online` event, `visibilitychange→visible`, after a new pending entry is created (if online), and a timer for scheduled retries (only while the tab is open). No Background Sync.

**Worker loop:** single runner guarded by a Web Lock (`fitwell-queue`). Picks entries `state=pending AND (nextAttemptAt ≤ now)`, oldest first, one at a time through the shared rate limiter.
- **Dedup:** normalize query (lowercase, trim, collapse spaces); identical queries share one cached lookup result; in-flight map keyed by normalized query.
- **Backoff:** network error/5xx/429 → `delay = min(30 min, 15 s × 2^attempts) ± 20% jitter`, `attempts++`, persisted in `lookup.nextAttemptAt`. After 8 attempts → stays `pending` with a calm "couldn't check — retry now" action (no auto-retry until next app open). 429/503 → global pause.
- **Result handling:** 0 candidates → `unmatched`; else store top 5 with `suggestedIndex` → `awaiting_confirmation`.

**Conflict handling (edit during lookup):** every edit of `queryText` (or deletion) bumps `lookup.queryVersion`. The worker captures the version at request start; on completion it opens one IDB transaction, re-reads the entry, and **applies the result only if the entry still exists, is still `pending`, and `queryVersion` matches**; otherwise the result is discarded (but the query→candidates response is still cached for later). Quantity edits don't invalidate the lookup (quantity is independent). If the user resolved the entry by hand meanwhile, the state check also drops the result.

**Persistence:** the queue *is* the entries (no separate store), so reload/restart safe; `in-flight` isn't persisted — on boot everything `pending` is simply eligible again.

**Testing:** (a) unit: reducer/state machine with table-driven transitions, backoff math with fake timers; (b) integration: fake `fetch` returning scripted sequences (timeouts, 503, 429 + Retry-After, empty, success); (c) e2e Playwright: `context.setOffline(true)` → log pending → reload → still pending → `setOffline(false)` (dispatches `online`) → candidates appear → badge count → confirm; plus route-mocked OFF for deterministic results; (d) race test: delay the mocked response, edit text mid-flight, assert stale result discarded; (e) duplicate-request test: log "oat milk" ×3 → one request; (f) multi-tab: two pages, one lock holder.

---

## 9. Bundled exercise data

- **Source:** `free-exercise-db` (Unlicense; `dist/exercises.json`, 800+ exercises; fields: id, name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions, category, images). Pinned to a commit hash in `data/versions.json`.
- **Script `build-exercises.ts`:** keep `id, name, category, level, equipment, force, mechanic, primaryMuscles, secondaryMuscles, instructions`; **drop `images`** (but retain the original `id`, which is the future image key). Normalize nulls, lowercase enums into small integer lookup tables, emit columnar JSON + enum tables. Fail the build on duplicate IDs. Generate `changelog` by diffing IDs with the previous release and write `legacyIdMap.json` for renamed/removed exercises.
- **Size:** instructions dominate; ~800 × ~700 B ≈ 560 KB raw → **~120–150 KB brotli**. Instructions may be split into a second lazy file (`exercises.instructions.json`) since search doesn't need them → search file ≈ 40 KB brotli.
- **Search/filter:** MiniSearch over `name` (boost 3), muscles, equipment; filters (muscle, equipment, category) are plain bitmask/array checks applied before ranking; user custom exercises merged into the same index at runtime, ranked first when names tie; recently used exercises boosted.
- **Update strategy:** user data stores `exerciseRef` (stable `ex:<id>`) **and** `exerciseName` snapshot; bundled data is a static, versioned asset replaced wholesale by new releases; custom exercises live in IndexedDB with their own `cx:<uuid>` IDs, so there is no way for an update to overwrite them. A start-up check compares `meta.bundledDataVersions`; if refs in user data are missing from the new bundle, `legacyIdMap` redirects them, else the snapshot name is shown ("exercise no longer in library") and history/charts still work by ref.

Cardio activities: separate small `activities.json` (~60 entries, < 5 KB) — see licensing for the source caveat.

---

## 10. Charting plan

**Library:** d3-scale/shape/array primitives + our own SVG components (≈ 12 KB gz total, lazy-loaded with the Progress route). Rationale vs. alternatives: Chart.js ≈ 60 KB, ECharts ≈ 300 KB+, Recharts ≈ 100 KB+ with React; uPlot is tiny and fast but canvas-only, which makes accessibility and dark-mode theming harder. Our charts have ≤ 400 points per series after downsampling, which SVG handles easily.

**Aggregates:**
- `dailyAggregates` store maintained in the same IDB transaction as each write (kcal/macros, pending count, workout counts by type, weight). Rebuildable from raw records (a "rebuild" runs after import or migration).
- Computed on demand from daily aggregates (cheap; no extra cache): weekly averages (ISO weeks, days with data only), 7-day moving average (window over calendar days, requires ≥ 3 points in the window else gap), workouts/week, cardio weekly totals, measurement deltas (first vs. latest in range, shown with neutral colors).
- **Estimated 1RM:** Epley `w × (1 + reps/30)`, only for sets with reps ≤ 12 and `type=working`; reps = 1 → w. Formula stated beneath the chart. Per-exercise series are computed from a `exerciseSets` index (`exerciseRef, day, bestWeight, best1RM`) written at workout save.
- Memoization keyed by `(range, dataRevision)`; `dataRevision` bumps on any write; computations run in a worker if > 5 ms on the profile.
- **Downsampling:** for ranges beyond 6 months, weekly buckets for dense series (calories/macros), LTTB for weight points; raw daily faint points kept only ≤ 180 days.

**Performance targets (Moto G-class, 4× CPU throttle):** Progress route interactive ≤ 400 ms after chunk load; render of 1 year of data per chart ≤ 100 ms; no layout shift; 60 fps on scroll; each chart ≤ 400 DOM nodes.

**Accessibility:** each chart wrapped in `<figure>` with `role="img"`, a text summary (headline, min/max, trend, range), a "View data as table" toggle (semantic `<table>`), keyboard-focusable points with tooltips, color + shape/pattern distinctions (never color alone), contrast-checked tokens in both themes; weight/measurement deltas shown in neutral ink with ± sign, no red/green.

---

## 11. Licensing review

| Item | License | Obligations | Status |
|---|---|---|---|
| **USDA FoodData Central** (Foundation, SR Legacy) | Public domain / CC0 1.0 | None legally; USDA requests citation: "U.S. Department of Agriculture, Agricultural Research Service, FoodData Central." | Verified from USDA's documented policy (re-check at build). |
| **Open Food Facts** (API data) | Database: **ODbL 1.0**; individual contents: **DbCL 1.0**; images CC BY-SA (not used) | Attribution; share-alike applies to publicly distributed derived *databases*. Client-side cache on the user's device and the user's private export don't constitute publishing. Don't bundle OFF data. Rate limits above. | Confirmed via OFF's FAQ/docs; verify exact attribution wording at build. |
| **free-exercise-db** | **The Unlicense** (public domain) | None; attribution courtesy. | Confirmed on the repo page. Images excluded in v1 (the repo's images may have separate provenance — check before enabling later). |
| **Compendium of Physical Activities** | **Unclear / unverified.** My searches did not surface a reuse policy on pacompendium.com. Related Compendium *papers* (Youth, Older Adult) appear under CC BY-NC-ND, which would be a problem for bundling a reworked table. | If terms are non-commercial/no-derivatives: bundling a transformed table would be risky even for a free app. | **Action:** (1) read the terms page on pacompendium.com directly, (2) email the maintainers for written permission, (3) until then ship only a small hand-assembled table of widely published MET values (~60 activities) with the 2011/2024 Compendium citation, flagged as "estimates", or alternatively let users enter MET/kcal manually. Alternative sources if refused: no widely licensed substitute exists, so fall back to user-entered calories + generic intensity levels (light/moderate/vigorous with ~3.5/5/8 MET) documented as approximate. |
| **Preact** | MIT | Include license text. | OK |
| **Vite, vite-plugin-pwa, Workbox** | MIT / MIT / MIT | Include licences in bundle notices. | OK |
| **idb** | ISC | Include notice. | OK |
| **MiniSearch** | MIT | Include notice. | OK |
| **d3-scale / shape / array** | ISC | Include notice. | OK |
| **valibot** | MIT | Include notice. | OK |
| Dev-only (Vitest, Playwright, axe-core MPL-2.0) | MIT / Apache-2.0 / MPL-2.0 | Not shipped to users (axe is test-only). | OK |

Process: `scripts/check-licenses.ts` (license-checker) runs in CI and fails on any new dependency with an unapproved license; the About screen is generated from `src/about/attributions.ts` + `LICENSES/`. I'm not a lawyer; the Compendium item in particular needs a human decision.

---

## 12. Next step
Confirm or adjust the questions in §0 (especially #1, #3 and #4) and I'll start with Phase 0 and Phase 1.
