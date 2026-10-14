# Prompt for Kiro: paste everything below the line into Kiro chat

---

You're continuing an existing project, the **TOV Blog Tool**, which another assistant built with me. It turns the
TOV marketing team's blog briefs (Google Docs) into **Shopify article drafts** through a custom MCP server called
`tov-shopify`. I'm Abbir, the developer, on **Windows**. Give me PowerShell commands, and explain step by step which
file to change and why, unless I say "go ahead and write it".

## Read these first, in this order
1. `TOV_BLOG_MCP_AGENTS.md` is the complete build spec and the source of truth. Read all of it.
2. `README.md` covers setup, the tools, and what the server enforces.
3. `server/src/` is the server code:
   - `index.ts` registers the tools.
   - `parse/` holds the deterministic parser.
   - `validate/` holds the verbatim check, metafield typing, and payload rules.
   - `shopify/` holds the Admin GraphQL code.
   - `google/` reads Google Docs.
   - `config/` holds spec §3, §7 and §8 as data.
4. `tests/unit/` holds 26 passing tests. `tests/fixtures/storage-ottomans-brief.txt` is the reference brief.
5. `knowledge/lessons.md` holds lessons every workflow step must follow (`## Active` only).
6. `runs/20261012-174726-paste-storage-ottomans/` is the first real run (files `00`–`06`). Its `pipeline.mjs` is a
   working script version of the whole agent flow, so use it as the reference.

## Non-negotiable rules (spec §2). Never weaken them, in code or in what you do
- **Drafts only.** There is no publish tool, and you must never add one.
- **Never touch published articles.**
- **Never invent text.** Every text value must come from the doc, apart from the fixed strings in §7.6. Don't
  paraphrase, fix typos, shorten, or improve anything. If you're unsure where something goes, add an advisory.
  **Never guess product URLs.** A product with no match gets `footer_text: ""` plus an advisory.
- Only the `inspired` and `press` blogs, and only the metafield keys in §8. **Never write `Featured_Blog`.**
- Only talk to the store in `SHOPIFY_STORE_DOMAIN`, and it must also be in `ALLOWED_STORES`.
- Secrets live only in `.env` and `secrets/`, both gitignored. Never print, log, or commit them.
- Ask me before adding any dependency, and before any write to a store, including test drafts.

## Current status (2026-10-12)
**Built and working:**
- The MCP server has 11 tools: `fetch_google_doc`, `parse_brief`, `get_metafield_definitions`, `find_products`,
  `upload_image`, `validate_payload`, `find_article_by_source`, `create_article_draft`, `update_article_draft`,
  `get_article`, and `delete_test_article` (that one only exists when `MCP_ENV=test`).
- Kiro registration is in `.kiro/settings/mcp.json`, pointing at `E:/TOV Blog Tool/dist/index.js`. Run `npm run build` first.
- npm scripts:
  - `build`, `test`, `inspect` (MCP Inspector).
  - `setup:dev` creates the blogs and §8 metafield definitions on a dev store. It's idempotent and only runs when `MCP_ENV=test`.
  - `test:cleanup` deletes `mcp-test` drafts.
- Every GraphQL operation has been validated against the Shopify Admin schema.

**Dev store `zaid-test-store-2.myshopify.com`:**
- `.env` is configured with a static Admin token (`SHOPIFY_ADMIN_TOKEN`), `MCP_ENV=test`, and `DRY_RUN=true`.
- `setup:dev` has run: the `inspired` and `press` blogs exist, along with 23 article metafield definitions (§8 plus
  `Featured_Blog`).
- The first real draft exists: article `gid://shopify/Article/749866385682` in Inspired, made from the pasted
  storage-ottomans doc with tags `src:paste-storage-ottomans` and `mcp-test`. Read-back matched every field.
- The dev store has no matching products, so all 6 product cards were left unresolved. That's correct behaviour.
- The dev theme has no `article-custom-json` template, so the page renders the `[[custom-content-with-badge]]`
  placeholder as text. That's expected. The live theme has the template. **Product matching and rendering will be
  tested on the live store.**

**Confirmed on the live store:**
- The Inspired template suffix is `article-custom-json`, which is what the server sends.
- Press uses "Default blog post", so the server sends `null`.
- Shopify displays tags alphabetically. That's fine: tagline and homepage tag are built from doc order before saving.

## Open items, roughly in this order
1. **Google credentials:** I'm creating a service account (Docs API and Drive API enabled, JSON key saved to
   `secrets/service-account.json`, docs shared with its email as Viewer). Once it's in place, test
   `fetch_google_doc` on a real doc link, then run the full flow from the link instead of pasted text.
2. **Compare with the live article:** I'll give you the live version of the storage-ottomans article (body HTML and
   metafields) that was made by hand with Claude. Compare it field by field against our draft `749866385682` and
   list every difference. Mark each one as either "our rule is wrong" or "human edit made during review". Don't
   change rules without asking me.
3. **Live store, read-only first:** add a new app and token for the live store, add it to `ALLOWED_STORES`, keep
   `DRY_RUN=true`, and check how many product cards `find_products` resolves on its own.
   - The auto-accept rule is in §4.3 and `shopify/products.ts`.
   - Card titles include extras such as `39"` and "With Reversible Tray Top", so strict matching may leave some
     unresolved.
   - A `PRODUCT LINKS:` section in the doc (`Name — URL` per line) is already supported and gives exact matches.
4. **Author question:** live articles show the person who entered them (for example "Abbir Ali"), but §7.3 says the
   author comes from the doc's Owner. Ask me which rule the team wants.
5. **Small bug:** some advisories appear twice with different wording because the parser and the validator both
   add one (for example "No featured image", or the CTA link). Dedupe them by `field`.
6. **Security:** rotate the dev app's client secret and token, because they were visible in a screenshot. Then
   update `SHOPIFY_ADMIN_TOKEN` in `.env`.
7. **Milestone 6:** the `blog <doc-url>` workflow in Kiro (see below), end to end on a real Google Doc.
8. **Milestone 8:** `learn` (diff a reviewed article against our payload and propose lessons for
   `knowledge/lessons.md`), `stats`, and golden tests in `tests/golden/`.

## The blog workflow (spec §4), adapted for Kiro
Kiro has no Claude Code subagents, so run the agents as **steps in order** in one session. Keep the hand-off
files exactly as in the spec. When I say `blog <google-doc-url>` (or paste doc text):
1. Create `runs/<YYYYMMDD-HHMMSS>-<docId>/` and write `00-input.json`.
2. **Intake:** call `fetch_google_doc` and write `01-source.json`. If the content type is unknown or the doc can't
   be accessed, BLOCK.
3. **Extractor:** call `parse_brief`. If `missing` isn't empty, BLOCK and name the labels. Otherwise handle only
   the `unparsed` judgement calls and write `02-draft.json`.
4. **Product Resolver:** call `find_products` for each card. Auto-accept only an exact handle match, or a single
   result with `containsAllSignificantWords: true`. Fill `footer_text` (see `footerText()` in
   `config/contentTypes.ts`) and `Article_Featured_product`. Write `03-products.json`.
5. **Media:** call `upload_image`, using `filePath` for doc images. If it fails, add an advisory and continue.
   Write `04-media.json`.
6. **Validator:** merge into `05-payload.json`, call `validate_payload` with the doc's `sourceText`, and decide
   PASS, FIX (at most 2 loops), or BLOCK. Write `05-validation.json`.
7. **Draft Writer** (PASS only, and confirm with me before writing):
   - Call `find_article_by_source`. If a draft exists, call `update_article_draft`; otherwise call `create_article_draft`.
   - Then call `get_article` and compare every field you sent against `payloadView`.
   - Write `06-result.json`.
8. **Reporter:** write `07-report.md` (status, admin link, review checklist) and append a row to `runs/index.csv`.

Never skip the Validator, and never call create or update before a PASS.

## First thing to do now
Read the files above. Then reply with:
- a summary of about 10 lines of the architecture and the current status, so I know you've understood it;
- confirmation that `tov-shopify` shows as connected in Kiro's MCP panel;
- which open item you suggest we tackle first.
