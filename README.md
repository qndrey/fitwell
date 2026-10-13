# Fitwell

A calm fitness and meal tracker. This repository is an npm workspaces monorepo:

| Workspace | What it is |
|---|---|
| [`apps/web`](apps/web/README.md) (`@fitwell/web`) | The Fitwell PWA: private, runs entirely in your browser, no accounts, no server. |
| [`apps/mcp`](apps/mcp/README.md) (`@fitwell/mcp`) | Fitwell for Claude: a remote MCP server on Cloudflare Workers (in progress, see [its plan](apps/mcp/PLAN.md)). |
| [`packages/core`](packages/core/README.md) (`@fitwell/core`) | Shared data model, domain logic, bundled datasets (Frida 5.5, free-exercise-db), search and the Open Food Facts client. |

## Develop
Node 22+ (see `.node-version`). Install once from the repository root:

```bash
npm install
```

| Command (from the root) | What it does |
|---|---|
| `npm run dev` | Web app dev server |
| `npm run dev:mcp` | MCP server in the local Workers runtime on :8787 (see [apps/mcp](apps/mcp/README.md)) |
| `npm run check` | typecheck + lint + unit tests (+ the web app's contrast and token lint) in every workspace |
| `npm run build` | Production build of the web app into `apps/web/dist` |
| `npm run test:e2e` · `lighthouse` · `size` · `licenses` · `check:about` | Web app release checks (see [apps/web/README.md](apps/web/README.md)) |

Run any workspace script directly with `npm run <script> -w <workspace>`.
