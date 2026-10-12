# TOV Blog Tool — Repo Structure

Full spec: `TOV_BLOG_MCP_AGENTS.md` §12. This file is a quick-reference.

## Layout

```
TOV Blog Tool/
├─ server/src/
│  ├─ index.ts                         # MCP server entry — tool registration (§5)
│  ├─ config/
│  │  ├─ contentTypes.ts               # CONTENT_TYPES enum + blog/template mappings (§3)
│  │  ├─ metafields.ts                 # metafield allowlists and type table (§8)
│  │  └─ env.ts                        # loadEnv(), getConfig(), ToolError
│  ├─ google/
│  │  └─ docs.ts                       # fetch_google_doc — Docs + Drive API, image download
│  ├─ parse/
│  │  ├─ index.ts                      # parseBrief() dispatcher
│  │  ├─ inspired.ts                   # deterministic Inspired parser (§7.1–7.4)
│  │  ├─ press.ts                      # deterministic Press parser (§7.5)
│  │  ├─ detect.ts                     # content-type detection
│  │  └─ types.ts                      # shared parse types
│  ├─ validate/
│  │  ├─ payload.ts                    # validatePayload() — orchestrates all checks
│  │  ├─ verbatim.ts                   # verbatim check (§5)
│  │  ├─ metafields.ts                 # metafield type + allowlist validation (§8)
│  │  └─ schema.ts                     # PayloadSchema (zod) — §6 shape
│  ├─ shopify/
│  │  ├─ client.ts                     # adminFetch(), rate-limit backoff, adminUrl()
│  │  ├─ articles.ts                   # createArticleDraft, updateArticleDraft, getArticle,
│  │  │                                #   findArticleBySource, deleteTestArticle, toPayloadView
│  │  ├─ products.ts                   # findProducts()
│  │  ├─ files.ts                      # stagedUpload + fileCreate + poll (uploadImage internals)
│  │  └─ definitions.ts                # getMetafieldDefinitions() with 10-min cache
│  ├─ images.ts                        # uploadImage() — glues files.ts + source types
│  └─ scripts/
│     └─ cleanup.ts                    # test:cleanup script — deletes mcp-test drafts
├─ tests/
│  ├─ unit/                            # vitest unit tests (npm test)
│  │  ├─ parse-inspired.test.ts
│  │  ├─ parse-press.test.ts
│  │  └─ validate.test.ts
│  ├─ fixtures/                        # sample brief text files used by unit tests
│  │  ├─ glass-decor-paste-guide.txt
│  │  └─ storage-ottomans-brief.txt
│  ├─ integration/                     # vitest integration tests (npm run test:integration)
│  └─ golden/                          # golden payload tests (npm run test:golden) — §10
├─ knowledge/
│  └─ lessons.md                       # Active lessons (read by every agent step); Proposed section
├─ runs/                               # created at runtime — gitignored
│  ├─ index.csv                        # one row per run (runId, docId, type, status, …)
│  └─ <YYYYMMDD-HHMMSS>-<docId>/      # per-run hand-off files
│     ├─ 00-input.json
│     ├─ 01-source.json
│     ├─ 02-draft.json
│     ├─ 03-products.json
│     ├─ 04-media.json
│     ├─ 05-payload.json
│     ├─ 05-validation.json
│     ├─ 06-result.json
│     └─ 07-report.md
├─ secrets/                            # gitignored — Google service account key goes here
├─ dist/                               # compiled output (npm run build) — gitignored
├─ .kiro/settings/mcp.json             # Kiro MCP server config (points to dist/index.js)
├─ .mcp.json                           # Claude Code MCP config (same server)
├─ .env / .env.example                 # runtime config (§11.3)
├─ TOV_BLOG_MCP_AGENTS.md             # complete build spec — source of truth
└─ KIRO_PROMPT.md                      # onboarding prompt for Kiro sessions
```

## Agent workflow → run-folder files

The blog workflow runs as **sequential steps** in one Kiro session (no subagents).
Each step reads its inputs from the run folder and writes exactly one output file:

| Step | Agent | Reads | Writes |
|---|---|---|---|
| 1 | Intake | `00-input.json` | `01-source.json` |
| 2 | Extractor | `01-source.json` | `02-draft.json` |
| 3 | Product Resolver | `02-draft.json` | `03-products.json` |
| 4 | Media | `01-source.json` + `02-draft.json` | `04-media.json` |
| 5 | Validator | `01–04` → merges | `05-payload.json` + `05-validation.json` |
| 6 | Draft Writer | `05-payload.json` (PASS only) | `06-result.json` |
| 7 | Reporter | all run files | `07-report.md` + row in `runs/index.csv` |

FIX loops (max 2) route back to the step named in the Validator's `routeTo`. BLOCK stops the run.
