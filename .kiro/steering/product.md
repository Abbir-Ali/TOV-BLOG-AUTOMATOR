# TOV Blog Tool — Product & Rules

Full spec: `TOV_BLOG_MCP_AGENTS.md`. This file is a quick-reference; the spec is the source of truth.

## Goal

Turn TOV marketing blog briefs (Google Docs) into **Shopify article drafts**, fully mapped and validated, with no
human steps between "here is the doc" and "draft is ready for review".

## Content types

| Type | Blog handle | Template suffix | Detected by |
|---|---|---|---|
| Inspired | `inspired` | `article-custom-json` | `[FORMAT: TYPE_…]` tags / `HEADLINE:` label |
| Press | `press` | none (`null`) | `CONTENT TYPE: PRESS` line |

## Non-negotiable rules (§2) — never weaken, never work around

1. **Drafts only.** Every write sends `isPublished: false`. There is no publish tool. Publishing = human in
   Shopify admin.
2. **Never touch published articles.** `update_article_draft` refuses published targets.
3. **No invented text.** Every text value must come verbatim from the source doc, except the fixed strings in §7.6.
   Do not paraphrase, fix typos, shorten, or "improve" anything. Unsure where text goes → add an advisory.
4. **Allowlists.** Only blogs `inspired` and `press`. Only the metafield keys listed in §8 for that content type.
   **Never write `Featured_Blog`** — marketing sets it manually.
5. **Correct metafield types.** Validated against live definitions from the store.
6. **Store guard.** Only talk to `SHOPIFY_STORE_DOMAIN`, which must also be in `ALLOWED_STORES`.
7. **Secrets** only in `.env` and `secrets/` (both gitignored). Never print or commit them.
8. **Idempotent.** Re-running the same doc updates the existing draft (matched by tag `src:<docId>`), never
   creates a duplicate.
9. **Ask before adding any dependency.**
10. **Validator must PASS before any write.** Never call `create_article_draft` or `update_article_draft` without
    a PASS from `validate_payload` first.
