# Fitwell design system

Calm, private, fast. Phones first; wider screens only add. Live reference: open the app at **`/#/design`** (not in the tab bar) to see every token and component in light and dark.

Source of truth: `src/styles/*.css` (tokens + component styles) and `src/ui/*` (Preact components). Enforced by `npm run contrast`, `npm run tokens` and the Playwright suites.

## Principles
1. **Calm, never guilt-inducing.** No red/green judgement on weight, measurements or calories. `--danger` appears only in destructive confirmations (lint-enforced).
2. **Phone first.** One column, 44 px targets, the one primary action pinned in the thumb zone, bottom sheets that never jump.
3. **Fast to log.** Common values are one tap (chips, recents). Ask of any element: does it make logging faster or the day clearer?
4. **Never colour alone.** Pair colour with text, shape or position. Errors carry an icon and say what to do. Chart series carry marker shapes.
5. **Everything is a token.** No raw colours or lengths in components.

## Files
| File | Purpose |
|---|---|
| `scale.css` | Theme-independent scales: type, spacing, sizes, radii, layers, motion |
| `tokens.css` | Themed colours + shadows (light, dark via media query, dark forced via `data-theme`) |
| `reset.css`, `typography.css` | Reset; type roles |
| `components.css` | Button, field, choice, segmented, card, list, notice, badge, toast, stat, sheet |
| `layout.css` | App frame, tab bar, day bar, primary bar, page rhythm |
| `utilities.css` | `sr-only`, `stack`, `cluster`, gaps, margins |
| `design.css` | Style-guide page only |

## Typeface
**Figtree** variable (400–700), self-hosted via `@fontsource-variable/figtree`, SIL OFL 1.1 (credited in Settings). System-font fallback. Tabular figures on by default so numbers align. No font services, no third-party requests.

## Type roles
| Role | Class / element | Size token | Weight |
|---|---|---|---|
| Display | `.t-display` | `--text-3xl` (40) | 700 |
| Stat | `.t-stat` | `--text-2xl` (32) | 700 |
| Title | `h1`, `.t-title` | `--text-xl` (24) | 700 |
| Heading | `h2`, `.t-heading` | `--text-lg` (18) | 600 |
| Subheading | `h3`, `.t-subheading` | `--text-md` (16) | 600 |
| Body / Label | `.t-body`, `.t-label` | `--text-md` (16) | 400 / 600 |
| Caption | `.t-caption` | `--text-sm` (14), muted | 400 |
| Overline | `.t-overline` | `--text-xs` (13), caps | 600 |

Body text and inputs are never below 16 px (iOS zooms smaller inputs). Choose the role by meaning, not size.

## Colour
Themed tokens, all contrast-checked in both themes (`npm run contrast`, 32+ pairs).

| Group | Tokens | Rule |
|---|---|---|
| Surfaces | `--bg`, `--surface`, `--surface-2` | Page → card → raised |
| Text | `--text`, `--text-muted` | Both ≥ 4.5:1 on every surface |
| Lines | `--border` (≥ 3:1, controls), `--divider` (decorative) | Never use `--divider` for a control edge |
| Accent | `--accent`, `--accent-strong`, `--on-accent`, `--accent-soft`, `--on-accent-soft` | Sage. One primary action per screen |
| Feedback | `--focus`, `--danger`, `--attention`, `--attention-soft`, `--on-attention-soft` | Focus ring everywhere. Danger only on destructive actions (`.btn.danger`, `.menu-item.danger`, `.link-btn.danger`). Attention (amber) for something waiting on you: items to confirm, a backup due, an error notice, warm-up sets |
| Charts | `--chart-1…6`, `--chart-grid`, `--chart-axis` | ≥ 3:1 on surfaces; pairwise ΔE ≥ 20 and ≥ 8 under protan/deutan/tritan simulation; always add markers or labels |

Deltas in weight, measurements and calories are neutral ink with a ± sign. Never red/green.

## Spacing, size, shape
- Scale (4 px base): `--space-1…8` = 4, 8, 12, 16, 24, 32, 48, 64.
- Page gutter `--gutter` = 16. Card padding 16 (compact 12 × 16). List rows 12 × 16.
- **Rhythm:** a screen is `.page` (flex column, `gap: --space-4`). Inside a group use `.stack` with a gap class (`gap-2/3/4`). Prefer `gap` over margins on children.
- Targets: `--tap` 44 px minimum for anything tappable; `--control-lg` 52 px for the one primary action; `--tabbar-h` 56 px.
- Radii: `--radius-s` controls, `--radius-m` cards and lists, `--radius-l` sheets, `--radius-pill` segments and the primary action.
- Elevation: `--shadow-1` cards/toasts, `--shadow-2` the primary action. Layers via `--z-*`.
- Motion: `--dur-fast/med`, `--ease-out`. Short and calm; all transitions off under `prefers-reduced-motion`.
- Breakpoints: 600 px (sheets centre), 840 px (sidebar nav replaces the tab bar).

## Icons
Lucide (`lucide-preact`, ISC), named imports only. Wrapped by `<Icon name size filled />`, decorative (`aria-hidden`). Three sizes: `--icon-sm/md/lg`. Add an icon by adding it to the map in `src/ui/Icon.tsx`.

## Components (`src/ui`)
| Component | Use | Notes |
|---|---|---|
| `Button` | `variant` primary / secondary / ghost / danger; `size` sm / md / lg; `block`, `icon` | Three levels: filled `primary` for the one main action per screen; outlined secondary for real alternatives; borderless `icon` buttons (tinted when pressed) for everything else, `icon outlined` only beside a field. `danger` only for destructive actions. Icon-only buttons need `aria-label`. Defaults to `type="button"` |
| `Menu` | Pop-up list of actions under a ⋯ (or custom) button | Arrow keys, Escape and outside tap close it; destructive items marked `danger` |
| `LinkButton` | Low-emphasis inline action | Same 44 px target |
| `Field` + `TextInput` / `Select` | Label, control, hint, error wired with ids | Errors: icon + calm instruction. Never placeholder-as-label |
| `Choice`, `Fieldset` | Radio / checkbox rows with optional help text | |
| `Segmented` | 2–5 short mutually exclusive options in one row | Meal selector, theme |
| `Card` | Grouped content on a raised surface | Name it with `label` / `labelledBy` |
| `List`, `ListRow`, `SectionTitle` | Tappable or static rows (main + sub) | |
| `Notice`, `Badge`, `EmptyState` | Calm inline messages and status pills | `Notice attention` (amber + icon) for something waiting on you; `Badge tone` neutral for passive facts, attention for to-confirm. `role="alert"` only for things to react to |
| `BigNumber`, `StatGrid`, `Meter`, `Sparkline` | Hero number; labelled values in a grid (optionally with a goal bar and note); thin progress bar; tiny trend line | Meter and sparkline are decorative: the number or caption beside them carries the meaning |
| `Sheet` | Modal bottom sheet on native `<dialog>` | Grab handle, ✕ icon to close, optional `subtitle`; `pinned` area stays, body scrolls; `tall` keeps height stable |
| `Screen` | Page header + focus management | Main tabs: large left title. Today: `nav` adds ‹ calendar › at the right. Pages opened from elsewhere: `back` adds a back arrow. `onSubtitle` makes the date a link |
| `Toaster`, `TabBar` | Transient messages; primary navigation | |

## Writing
Neutral and kind. Say what happened and what to do next. No "you failed", "over budget", "only", exclamation marks, or streak guilt. Errors never blame ("Enter an amount greater than zero.").

## Accessibility checklist (every change)
- Keyboard: everything reachable; visible 3 px focus ring; sheets trap focus and close on Escape.
- Labels: every control has a visible label (or `labelHidden` with an `sr-only` one).
- Contrast: use tokens; run `npm run contrast`.
- Not colour alone; respects `prefers-reduced-motion` and the light/dark/system setting.
- Axe runs on every screen and sheet in both themes (Playwright).

## Adding to the system
1. Need a value? Add a token to `scale.css` (theme-independent) or `tokens.css` (themed, with a dark value in **both** dark blocks) and, for colours, a contrast pair in `scripts/check-contrast.ts`.
2. Need a component? Build it from tokens in `components.css`, expose it in `src/ui`, add it to `src/features/design/Design.tsx`, and make sure `npm run tokens` and the design-page axe tests pass.
3. `npm run check` runs typecheck, lint, unit tests, contrast and token lint.
