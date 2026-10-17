# Connectors Directory listing assets

Carousel screenshots for the directory listing ([requirements](https://claude.com/docs/connectors/building/submission#carousel-screenshots-for-mcp-apps)): PNG, 1290 px wide, each cropped to the view only, without the prompt, in the light theme. The prompt that goes with each one is entered separately in the portal:

| Screenshot | Paired prompt |
|---|---|
| `1-workout-player.png` | "Start my legs and arms workout" |
| `2-dashboard.png` | "How am I doing?" |
| `3-weekly-review.png` | "How did my week go?" |
| `4-shopping-list.png` | "Show my shopping list for next week, for two people" |
| `5-exercise-guide.png` | "How do I use the leg press?" |

The data is the made-up demo person from `scripts/seed-review.ts`: 12 weeks, 84 → 79.5 kg.

## Making them again

```bash
npm run seed:review -w @fitwell/mcp -- --email dev@localhost --apply local
```

Then start the local server (`npm run dev:mcp`, which needs `.dev.vars` from `.dev.vars.example`) and the dev host (`npm run dev:host -w @fitwell/mcp`). Install `playwright-core` in any folder outside the repo, and run, from `apps/mcp`:

```bash
node directory/capture.mjs <that folder> directory
```

It uses the installed Google Chrome, headless at 3× scale. The workout view uses the dev host's sample workout ("Legs and arms").
