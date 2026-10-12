# TOV Blog Tool — Tech Stack

Full spec: `TOV_BLOG_MCP_AGENTS.md`. This file is a quick-reference.

## Runtime & language

- **Node.js** 20.12+ (project uses `"engines": { "node": ">=20.12" }`)
- **TypeScript** — strict, ESM (`"type": "module"`). No plain JS in server code.
- Compiled output lands in `dist/`. Always run `npm run build` before starting or testing the MCP server.

## Key libraries

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server (`McpServer`, `StdioServerTransport`) |
| `zod` | Input schema validation for every tool |
| `googleapis` | Google Docs API + Drive API (service account) |
| `vitest` | Unit, integration, and golden tests |
| `typescript` | Compilation |

All at exact/pinned versions in `package.json`. Ask Abbir before adding anything new.

## Commands (PowerShell, run from project root)

```powershell
npm install              # install deps
npm run build            # compile TypeScript → dist/
npm test                 # unit tests (vitest run tests/unit) — must show 26 passing
npm run inspect          # MCP Inspector UI for manual tool testing
npm run test:integration # integration tests (MCP_ENV=test required)
npm run test:golden      # golden payload tests
npm run test:cleanup     # delete leftover mcp-test drafts from the dev store
```

Do **not** run long-lived processes (`npm run dev`) as background commands — start them manually in a terminal.

## Transport & entry point

- stdio transport only (local). Streamable HTTP is a future milestone (§12 m9).
- Entry point: `dist/index.js` (built from `server/src/index.ts`).
- Kiro reads `.kiro/settings/mcp.json`; Claude Code reads `.mcp.json`.

## Environment

- All config via `.env` (never committed). Template: `.env.example`.
- Key vars: `SHOPIFY_STORE_DOMAIN`, `ALLOWED_STORES`, `SHOPIFY_API_VERSION`, `SHOPIFY_ADMIN_TOKEN` (or
  `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`), `GOOGLE_APPLICATION_CREDENTIALS`, `MCP_ENV`, `DRY_RUN`.
- `DRY_RUN=true` → server returns GraphQL variables without calling Shopify (safe for first runs).
- `MCP_ENV=test` → `delete_test_article` tool is registered; test articles get tagged `mcp-test`.
- Google service account key: `secrets/service-account.json` (gitignored).
