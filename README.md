# Fitwell

A calm, private fitness and meal tracker. Everything stays on your device: no accounts, no backend, no tracking.

Design tokens and components: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (live at `/#/design`).

See [PLAN.md](PLAN.md) for the architecture and [TECH_SPEC.md](TECH_SPEC.md) for specs and phase gates.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm run preview` | Production build / serve it on :4173 |
| `npm run typecheck` · `lint` · `test` | Static checks and unit tests |
| `npm run test:e2e` | Playwright (builds and serves the app itself) |
| `npm run check` | typecheck + lint + unit tests + contrast + token lint |
| `npm run contrast` | WCAG contrast check of design tokens, both themes |
| `npm run tokens` | Design-token lint (no raw colours/lengths) |
| `npm run licenses` · `size` | Production licence allow-list · bundle budget |
