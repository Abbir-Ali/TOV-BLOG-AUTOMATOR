# tov-shopify MCP server

Turns TOV Google Doc blog briefs into **Shopify article drafts**. Full spec: [TOV_BLOG_MCP_AGENTS.md](TOV_BLOG_MCP_AGENTS.md).

Node 20+ · TypeScript · `@modelcontextprotocol/sdk` · stdio transport.

## Setup (PowerShell)

```powershell
npm install
Copy-Item .env.example .env        # then fill in the dev store + credentials
# put the Google service account key at .\secrets\service-account.json
npm run build
npm test                           # unit tests (parser, verbatim, metafields, validator)
```

Try the tools by hand:

```powershell
npm run inspect                    # MCP Inspector → start with get_metafield_definitions, find_products
```

Register with Claude Code: `.mcp.json` in this folder already does it (check with `/mcp`), or
`claude mcp add tov-shopify -- node dist/index.js`.

## Tools

| Tool | What it does |
|---|---|
| `fetch_google_doc` | Reads the doc (service account), returns text + paragraphs + images (downloaded to `runs/_images/`) + `sourceText` |
| `parse_brief` | Deterministic §7 parser → partial payload, `missing`, `decisions`, `unparsed` |
| `get_metafield_definitions` | Live ARTICLE definitions, cached 10 min |
| `find_products` | Read-only; exact handle match or name search with `containsAllSignificantWords` |
| `upload_image` | url / contentUri / Drive id or link / downloaded file → Shopify Files CDN url |
| `validate_payload` | Same validator the write tools run |
| `find_article_by_source` | Finds the draft tagged `src:<docId>` |
| `create_article_draft` / `update_article_draft` | Drafts only, all §5 enforcement, `DRY_RUN` support |
| `get_article` | Article + metafields, plus `payloadView` for read-back |
| `delete_test_article` | Only when `MCP_ENV=test`, only `mcp-test` drafts |

There is no publish tool, no generic delete, and no raw GraphQL tool.

## Rules the code enforces

- `isPublished: false` on every write; updates refuse published articles and articles without the doc's `src:` tag.
- Store guard: `SHOPIFY_STORE_DOMAIN` must be in `ALLOWED_STORES`.
- Blogs `inspired` / `press` only; template suffix set by the server.
- Metafield allowlist per content type; `Featured_Blog` (and other §8 "never written" keys) denied.
- Values typed against live definitions; if they disagree with §8 the write is refused.
- Verbatim check: every text value must appear in the doc (except the §7.6 fixed strings).
- One draft per doc: create refuses if a `src:<docId>` draft exists → use update.
- Throttle/5xx backoff 0.5/1/2/4 s; 401/403 → `AUTH` error (stop the batch).

Errors come back as `{ error, code, details }` with codes such as `VALIDATION`, `PUBLISHED`, `AUTH`, `DOC_ACCESS`,
`STORE_GUARD`, `USER_ERRORS`, `IMAGE`.

## Scripts

- `npm run test:cleanup` deletes leftover `mcp-test` drafts (test env only).
