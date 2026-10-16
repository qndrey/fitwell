# Fitwell

Fitwell for Claude: a calm fitness and meal tracker that lives in Claude, as a remote MCP server. This repository is an npm workspaces monorepo:

| Workspace | What it is |
|---|---|
| [`apps/mcp`](apps/mcp/README.md) (`@fitwell/mcp`) | Fitwell for Claude: a remote MCP server on Cloudflare Workers (see [its plan](apps/mcp/PLAN.md) and [roadmap](apps/mcp/ROADMAP.md)). |
| [`packages/core`](packages/core/README.md) (`@fitwell/core`) | Shared data model, domain logic, bundled datasets (Frida 5.5, free-exercise-db), search and the Open Food Facts client. |

The earlier Fitwell web app (a local-only PWA) was retired on 2026-10-16. Its backup files can still be imported with the `import_fitwell_backup` tool.

## Develop
Node 22+ (see `.node-version`). Install once from the repository root:

```bash
npm install
```

| Command (from the root) | What it does |
|---|---|
| `npm run dev` | MCP server in the local Workers runtime on :8787 (setup in [apps/mcp](apps/mcp/README.md#develop)) |
| `npm run check` | typecheck + lint + unit tests in every workspace |
| `npm run typecheck` · `lint` · `test` | One of those steps, in every workspace |

Run any workspace script directly with `npm run <script> -w <workspace>`.
