# Prompt for Kiro — paste everything below the line into Kiro chat

---

You are taking over an existing project: the **TOV Blog Tool**. It turns the TOV marketing team's blog briefs (Google
Docs) into **Shopify article drafts** through a custom MCP server called `tov-shopify`. I'm Abbir, the developer,
on **Windows**. Give me PowerShell commands and explain step by step what file to change and why, unless I say
"go ahead and write it".

## Read these first, in this order
1. `TOV_BLOG_MCP_AGENTS.md` is the complete build spec. It's the source of truth, so read all of it.
2. `README.md` covers setup, the tools, and what the server enforces.
3. `server/src/` holds the MCP server code. `tests/unit/` holds the tests. `tests/fixtures/` holds the sample briefs.
4. `knowledge/lessons.md` holds the lessons every agent step must follow (`## Active` only).

## What already exists (milestones 1–5 and 7 of spec §12, server side)
- The MCP server lives in `server/src/index.ts` and builds to `dist/index.js` over a stdio transport. Its tools are
  `fetch_google_doc`, `parse_brief`, `get_metafield_definitions`, `find_products`, `upload_image`,
  `validate_payload`, `find_article_by_source`, `create_article_draft`, `update_article_draft`, `get_article`, and
  `delete_test_article` (that last one only exists when `MCP_ENV=test`).
- The deterministic parsers are `server/src/parse/inspired.ts` and `server/src/parse/press.ts`.
- The validator lives in `server/src/validate/`: verbatim check, metafield typing, payload rules.
- §3, §7 and §8 are stored as data in `server/src/config/`.
- The unit tests pass with `npm test`.
- The MCP server is registered for Kiro in `.kiro/settings/mcp.json`.

## Non-negotiable rules (spec §2). Never weaken them, in code or in your own behaviour
- **Drafts only.** There is no publish tool, and you must never add one. Publishing is done by a human in Shopify admin.
- **Never touch published articles.**
- **Never invent text.** Every text value must come from the doc, except the fixed strings in §7.6. Don't
  paraphrase, fix typos, shorten, or "improve" anything. If you're unsure where some text goes, add an advisory.
- Only the `inspired` and `press` blogs are allowed, along with only the metafield keys in §8. **Never write `Featured_Blog`.**
- Only talk to the store in `SHOPIFY_STORE_DOMAIN`, which must also be in `ALLOWED_STORES`. Use the dev store until I say otherwise.
- Secrets live only in `.env` and `secrets/`, both gitignored. Never print or commit them.
- Ask me before adding any dependency.

## Your first tasks
1. Read the files above. Then summarise the architecture back to me in about 10 lines, so I know you understood it.
2. Create Kiro steering files in `.kiro/steering/`:
   - `product.md`: the goal, the two content types, and the §2 rules.
   - `tech.md`: Node 20+, TypeScript, MCP SDK, zod, googleapis, Vitest, and the commands (`npm run build`,
     `npm test`, `npm run inspect`).
   - `structure.md`: the repo layout and which file implements which part of the spec.
   Keep them short and point to `TOV_BLOG_MCP_AGENTS.md` for details instead of copying it.
3. Check that the `tov-shopify` MCP server shows as connected in Kiro's MCP panel. If it doesn't, help me fix it
   (run `npm run build` first; the path in `.kiro/settings/mcp.json` must point to `dist/index.js`).
4. Walk me through testing against the dev store, one tool at a time, as in spec §11.4:
   `get_metafield_definitions` → `find_products` → `create_article_draft` with `DRY_RUN=true` → a real draft →
   `get_article` read-back → `delete_test_article`.

## The blog workflow (spec §4), adapted for Kiro
Claude Code subagents don't exist in Kiro. Run the agents as **sequential steps** in one session, and keep the
hand-off files exactly as the spec describes. When I say `blog <google-doc-url>`:
1. Create `runs/<YYYYMMDD-HHMMSS>-<docId>/` and write `00-input.json`.
2. **Intake:** call `fetch_google_doc` and write `01-source.json`. Unknown content type or no access → BLOCK.
3. **Extractor:** call `parse_brief`, then handle only the `unparsed` judgement calls. Write `02-draft.json`.
4. **Product Resolver:** call `find_products` for each product card or Press product. Auto-accept only an
   exact handle match, or a single result with `containsAllSignificantWords: true`. Write `03-products.json`.
5. **Media:** call `upload_image`. Prefer `filePath` for doc images. If an upload fails, add an advisory and
   continue. Write `04-media.json`.
6. **Validator:** merge into `05-payload.json` and call `validate_payload` with the doc's `sourceText`.
   The result is PASS, FIX (at most 2 loops back to the step at fault), or BLOCK. Write `05-validation.json`.
7. **Draft Writer** (only after PASS): call `find_article_by_source`. If a draft exists, call
   `update_article_draft`; otherwise call `create_article_draft`. Then call `get_article` and compare every
   field sent against `payloadView`. Write `06-result.json`.
8. **Reporter:** write `07-report.md` with the status, admin link and review checklist. Append a row to
   `runs/index.csv`.

Never skip the Validator, and never call the create/update tools before a PASS. You may automate this later with
a Kiro spec or hooks, but propose that to me first.

## Remaining milestones (spec §12)
- 6: the blog workflow above, end to end on one Inspired doc.
- 8: `/learn` (diff a reviewed article against our payload and propose lessons), `/stats`, and golden tests.
- 9 (optional): a Streamable HTTP transport with auth.

Done means `blog <url>` on a real Inspired doc creates a dev-store draft that matches the golden expected payload,
the read-back passes, and re-running it updates the same draft instead of creating a new one.
