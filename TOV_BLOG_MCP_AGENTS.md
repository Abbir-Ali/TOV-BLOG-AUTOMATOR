# TOV Blog Drafts — Multi-Agent Claude + Shopify MCP System

> **For the coding assistant:** This file is the complete build spec. Read all of it before writing code.
> Build in the milestone order in §12. Ask before adding dependencies. Never weaken a rule in §2.
> The developer (Abbir) is on **Windows** — give PowerShell commands. He prefers step-by-step guidance:
> explain which file to create/edit, what to add, and why, unless he says "go ahead and write it".

---

## 0. Goal (one paragraph)

The TOV marketing team writes a blog in a Google Doc. A person gives Claude the doc link (or several links).
A team of Claude agents reads the doc, maps every piece of text into the correct Shopify article fields and
metafields **without inventing any text**, resolves products and images, validates everything, and creates the
article **as a draft** in the correct Shopify blog through a **custom MCP server**. It then verifies the draft by
reading it back and reports the admin link plus a review checklist. No human touches anything between "here is
the doc" and "draft is ready for review" unless the doc itself is missing required content.

**Why a custom MCP server:** the stock Shopify connector in Claude has no blog/article tools. Our own server gives
us exactly the tools we need and lets us enforce the safety rules in code, not in prompts.

---

## 1. Architecture

```
            ┌───────────────────────── Claude Code (local, Windows) ─────────────────────────┐
 Doc URLs → │  /blog command → ORCHESTRATOR (main session)                                    │
            │      │ spawns subagents in order, passes run-folder file paths                   │
            │      ├─► 1 Intake ─► 2 Extractor ─► 3 Product Resolver ─► 4 Media               │
            │      │                                   │                                       │
            │      ├─► 5 Validator ──FIX──► (back to 2/3/4, max 2 loops) ──BLOCK──► 7 Reporter │
            │      │        │PASS                                                              │
            │      ├─► 6 Draft Writer ─► 7 Reporter                                            │
            │      └─► 8 Learner (separate command, after human review)                       │
            └──────────────────────────────┬──────────────────────────────────────────────────┘
                                           │ MCP (stdio locally / Streamable HTTP when remote)
                              ┌────────────▼─────────────┐
                              │  tov-shopify MCP server   │  Node 20 + TypeScript
                              │  (rules enforced in code) │  @modelcontextprotocol/sdk
                              └──────┬─────────────┬──────┘
                       Google Docs + Drive API   Shopify Admin GraphQL API (pinned version)
                       (service account)         (dev store first, live store later)
```

- **Multi-agent runtime:** Claude Code subagents (`.claude/agents/*.md`) + a slash command
  (`.claude/commands/blog.md`). The main session is the Orchestrator.
- **Hand-off between agents:** JSON files in a run folder `runs/<runId>/`. Agents receive file paths, write their
  output file, and return a one-line status. Files make every step inspectable and re-runnable.
- **Optional later:** expose the same MCP server over Streamable HTTP as a claude.ai custom connector so the
  team can use it from a claude.ai Project (single-agent mode, same tools, same server-side rules).

---

## 2. Non-negotiable rules

Enforced **in the MCP server code** (§5) — prompts repeat them, but code is the guarantee.

1. **Drafts only.** Every create/update sends `isPublished: false`. There is **no publish tool**. Publishing is
   always done by a human in Shopify admin.
2. **Never touch published articles.** `update_article_draft` refuses if the target article is published.
3. **No invented text.** Every text value must come from the source doc, except the fixed strings listed in §7.
   The server runs a verbatim check (§5, `validate_payload`). Any mismatch → blocked.
4. **Allowlists.** Only blogs `inspired` and `press`. Only the metafield keys listed for that content type (§8).
   Template suffix is set by the server from the content type, never from the model.
5. **Correct metafield types, always.** Values are validated against the live metafield definitions from the
   store (cached by `get_metafield_definitions`) and the table in §8.
6. **Never write `Featured_Blog`.** Marketing sets it manually during review.
7. **Store guard.** The server only talks to the store in `SHOPIFY_STORE_DOMAIN`, which must be in
   `ALLOWED_STORES`. Default `.env` points to the **dev store**.
8. **Secrets** only in `.env` (gitignored). Commit `.env.example` with names only.
9. **Idempotent.** Re-running the same doc updates the existing draft (matched by `sourceDocId` stored in a
   metafield-free way: an article tag `src:<googleDocId>`), never creates a duplicate.

---

## 3. Content types (summary)

| | Inspired | Press |
|---|---|---|
| Blog handle | `inspired` | `press` |
| Template suffix | `article-custom-json` | none (Default blog post) → send `null` |
| Detected by | `[FORMAT: TYPE_…]` tags / `HEADLINE:` label | `CONTENT TYPE: PRESS` line |
| Frequency | most posts | occasional |

---

## 4. Agents

Every agent: reads its inputs from the run folder, writes exactly one output file, returns
`OK <file>` / `FIX <reason>` / `BLOCK <reason>`. Agents never call Shopify write tools except the Draft Writer.
Every agent reads `knowledge/lessons.md` (§10) before starting.

### 4.0 Orchestrator (main Claude Code session, started by `/blog <doc-url> [more urls…]`)
- **Receives:** one or more Google Doc URLs (or a file `queue.txt` with one URL per line).
- **Does:** creates `runs/<YYYYMMDD-HHMMSS>-<docId>/`, writes `00-input.json`, runs agents 1→7 in order,
  handles FIX loops (max **2** per run), processes multiple docs one after another.
- **Decides:** next agent; whether to loop back (FIX → the agent named in the Validator's `routeTo`); when to stop
  (BLOCK, or loop limit reached → treat as BLOCK).
- **Passes on:** file paths only.
- **Never:** edits payloads itself, calls Shopify write tools, or skips the Validator.

### 4.1 Intake agent — `intake`
- **Receives:** `00-input.json` `{ docUrl }`.
- **Does:** calls `fetch_google_doc` → plain text with paragraph boundaries + list of inline images
  (position, short-lived contentUri, alt text). Detects content type. Splits into labelled sections.
- **Decides:** content type (`inspired` | `press` | `unknown` → BLOCK). Whether the doc is readable
  (permission error → BLOCK with "share the doc with <service-account-email>").
- **Writes:** `01-source.json`
  ```json
  { "docId": "", "docTitle": "", "contentType": "inspired", "rawText": "",
    "sections": [{ "label": "HEADLINE", "text": "" }, { "format": "TYPE_1_TEXT", "lines": [] }],
    "images": [{ "afterLineIndex": 0, "role": "featured|inline", "contentUri": "", "alt": "" }] }
  ```

### 4.2 Extractor agent — `extractor`
- **Receives:** `01-source.json` + content-type rules (§7).
- **Does:** first calls `parse_brief` (deterministic parser in the server) to map everything mechanical. Then
  handles only the judgement calls: splitting an unknown badge from a product name line, reading Editor notes for
  sidebar overrides / expert-quote slots (→ Design Box paragraph) / checklist items.
- **Decides:** field values, using only text present in `rawText` or the fixed strings in §7.
- **Writes:** `02-draft.json` = the article payload (shape in §6) with `productCards[].productRef` left as
  `{ "query": "<name>", "url": "<if PRODUCT LINKS gave one>" }`, plus `advisories[]` and `checklist[]`.
- **Must not:** paraphrase, fix typos, shorten, or "improve" any text. If unsure where text goes → advisory.

### 4.3 Product Resolver agent — `product-resolver`
- **Receives:** `02-draft.json`.
- **Does:** for each product card (and each Press product) calls `find_products` with the URL handle if present,
  else the name. Picks a match.
- **Decides:** match confidence. **Auto-accept** only when: exact handle match from a URL, OR exactly one result
  whose title contains every significant word of the card title. Otherwise unresolved → `footer_text` set to
  the plain product name (not empty) + advisory "confirm product link for <title>".
- **Never** assume a product URL from a hyperlink in the doc body — the Docs API returns plain text only.
  The only source of URLs is `PRODUCT LINKS:`. If a URL is missing, say so explicitly in the advisory.
- **Writes:** `03-products.json` `{ resolved: [{ cardIndex, productGid, handle, url, title }], unresolved: [] }`.

### 4.4 Media agent — `media`
- **Receives:** `01-source.json` images + `02-draft.json`.
- **Does:** featured image → `upload_image` (from contentUri, Drive link or URL). Inline images → `upload_image`,
  returns Shopify CDN URL for `<img>` insertion at the recorded position.
- **Decides:** if an upload fails after retries → continue without it + advisory (never block a draft on images).
- **Writes:** `04-media.json` `{ featured: { url, alt } | null, inline: [{ position, url, alt }] }`.
  Missing alt text → advisory (never invent alt text).

### 4.5 Validator agent — `validator`
- **Receives:** `01-source.json`, `02-draft.json`, `03-products.json`, `04-media.json`.
- **Does:** merges them into `05-payload.json`, calls `validate_payload` (server: types, required fields,
  allowlist, verbatim check, placeholder counts, TOC ↔ h2 consistency, JSON shape, no newlines in single-line
  fields), then does its own review against §7.
- **Decides:**
  - `PASS` → Draft Writer.
  - `FIX` → returns `{ routeTo: "extractor|product-resolver|media", errors: [...] }` (only for fixable model
    mistakes, e.g. wrong field mapping, malformed JSON).
  - `BLOCK` → the doc itself lacks required content (e.g. no HEADLINE) or verbatim check fails twice.
- **Writes:** `05-payload.json` + `05-validation.json` `{ status, errors[], advisories[], checklist[] }`.

### 4.6 Draft Writer agent — `draft-writer`
- **Receives:** `05-payload.json` (PASS only).
- **Does:** `find_article_by_source` (tag `src:<docId>`) → `update_article_draft` if found and still a draft,
  else `create_article_draft`. Then `get_article` and compares every field it sent with what Shopify stored.
- **Decides:** success only if read-back matches. Mismatch → one retry, then BLOCK with the diff.
- **Writes:** `06-result.json` `{ articleId, adminUrl, action: "created|updated", readBackOk: true }`.

### 4.7 Reporter agent — `reporter`
- **Receives:** all run files.
- **Does:** writes `07-report.md`: status, admin link, review checklist (advisories + Editor-note items +
  "set Featured Blog if needed" for Inspired), blocking reasons with exact missing labels. Appends one line to
  `runs/index.csv` (runId, docId, type, status, fixLoops, advisories, articleId).
- **Optional:** post the report to Slack / email via the connected Slack or Gmail tools if configured.

### 4.8 Learner agent — `learner` (separate command `/learn <articleId>` or `/learn-all`)
- **Receives:** the run's `05-payload.json` + the current article from `get_article` (after humans reviewed it).
- **Does:** diffs what we created vs. what humans changed (§10).
- **Decides:** which differences are patterns (same kind of edit ≥ 2 times) vs one-offs.
- **Writes:** proposed additions to `knowledge/lessons.md` in a `## Proposed` section. **Never** changes rules in
  §2/§7 or the agent files itself — Abbir approves and moves items to `## Active`.

---

## 5. MCP server — `tov-shopify`

Node 20, TypeScript, `@modelcontextprotocol/sdk`, `zod` for schemas, `googleapis` for Docs/Drive, native
`fetch` for Shopify GraphQL. Transport: stdio (local). Add Streamable HTTP later behind auth.

### Tools

| Tool | Input | Output | Notes |
|---|---|---|---|
| `fetch_google_doc` | `{ docUrlOrId }` | `{ docId, title, text, paragraphs[], images[] }` | Service account. Download inline images immediately (contentUri expires). |
| `parse_brief` | `{ contentType, text }` | partial payload + `unparsed[]` | **Deterministic**, no AI. Implements §7 mechanics. |
| `get_metafield_definitions` | `{}` | `[{ namespace, key, type, name }]` | `metafieldDefinitions(ownerType: ARTICLE)`, cached 10 min. |
| `find_products` | `{ handle? , query? , limit≤10 }` | `[{ gid, title, handle, url, status, imageUrl }]` | Read-only. |
| `upload_image` | `{ source: url \| contentUri \| driveFileId, alt? }` | `{ url, fileGid }` | `stagedUploadsCreate` → upload → `fileCreate` → poll until READY. |
| `validate_payload` | `{ payload, sourceText }` | `{ ok, errors[], advisories[] }` | Same validator the write tools run internally. |
| `find_article_by_source` | `{ blogHandle, docId }` | `{ articleId, isPublished } \| null` | Looks for tag `src:<docId>`. |
| `create_article_draft` | `{ payload }` | `{ articleId, adminUrl }` | Re-validates; forces `isPublished:false`, template suffix, blog. |
| `update_article_draft` | `{ articleId, payload }` | `{ articleId, adminUrl }` | Refuses if article is published. |
| `get_article` | `{ articleId }` | full article + metafields | For read-back and Learner. |
| `delete_test_article` | `{ articleId }` | `{ deleted }` | **Only registered when `MCP_ENV=test`** and article has tag `mcp-test`. |

There is deliberately **no** `publish_article`, `delete_article` (outside test), or generic GraphQL tool.

### Server-side enforcement inside create/update
1. `SHOPIFY_STORE_DOMAIN ∈ ALLOWED_STORES`, else refuse.
2. `blogHandle ∈ {inspired, press}`; resolve blog GID by handle.
3. Overwrite `isPublished=false`, `templateSuffix` from content type, add tags `src:<docId>` (+ `mcp-test` in test).
4. Drop/deny any metafield key not in the content type's allowlist (§8). Deny `Featured_Blog`.
5. Validate every metafield value against the cached definition type + §8 format rules.
6. Verbatim check every text field (see below).
7. `DRY_RUN=true` → return the exact GraphQL variables instead of calling Shopify.

### Verbatim check
Normalize (strip HTML tags, decode entities, collapse whitespace, unify quotes/dashes) both the field value and
the source text. Each text field must be a substring of the source, **except** the fixed strings in §7 and
derived values (tags formatting, `·`/`||` joins of source strings, title-cased tags, footer_label pattern).
Derived values are checked component-wise (each joined piece must be in source).

### Shopify API details
- Admin GraphQL only, version pinned in `SHOPIFY_API_VERSION`.
- Mutations: `articleCreate(article: ArticleCreateInput!)`, `articleUpdate(id, article: ArticleUpdateInput!)`.
  Input fields used: `blogId, title, body, summary, tags, templateSuffix, isPublished, author { name },
  image { url, altText }, metafields [{ namespace, key, type, value }]`.
- Always read `userErrors`; map `field` paths to our field names in the error message.
- Rate limits: honour `extensions.cost.throttleStatus`; exponential backoff (0.5s, 1s, 2s, 4s; max 4 retries) on
  `THROTTLED` and 5xx. Never retry 4xx validation errors blindly.
- Required scopes: `read_content, write_content, read_products, read_files, write_files`.

---

## 6. Payload shape (`05-payload.json`)

```json
{
  "contentType": "inspired",
  "source": { "docId": "", "docUrl": "" },
  "article": {
    "title": "", "bodyHtml": "", "summary": "", "tags": ["glass-decor", "colored-glass-vases"],
    "authorName": "", "image": { "url": "", "altText": "" }
  },
  "metafields": { "reading_time": "5 min read", "custom_content_with_badge": [ ... ] },
  "advisories": [{ "field": "cta_button_link_1", "message": "Not in doc — add during review" }],
  "checklist": ["Set Featured Blog if this post should be featured"]
}
```
The server converts `metafields` into typed `{namespace:"custom", key, type, value}` entries (§8).

---

## 7. Content rules

### 7.1 Inspired — input doc format (plain text lines, no heading styles)
```
EDITOR METADATA
Week: … / Owner: … / Existing URL: … / Internal links FROM: … / Editor notes: …
HEADLINE: …            SUBTITLE: …          READ TIME: …
TAGS: a, b, c          (doc order matters)
SUMMARY (TLDR): …
FEATURED IMAGE:        (optional; pasted image below, or Drive link/URL on same line)
FEATURED IMAGE ALT: …  (optional)
IN THIS ARTICLE:       (list of h2 headings)
[FORMAT: TYPE_1_TEXT]       heading, paragraphs
[FORMAT: TYPE_3_SUBTITLES]  heading, (sub-heading, paragraph)×n
[FORMAT: TYPE_2_OPTIONS]    heading, optional intro, (product name line [+ badge], description with "Best for…")×n
PRODUCT LINKS:              (optional) "Name — URL" per line — **only source for product URLs; hyperlinks in
                            the doc body are invisible to the Google Docs API and must never be assumed**
[FORMAT: TYPE_4_FAQ]        heading, (question ending "?", answer)×n
[FORMAT: TYPE_5_CTA]        heading, paragraph, button label, optional "CTA LINK: url"
[FORMAT: TYPE_6_COMPARISON] comparison pairs
```
Headings vs paragraphs: use the `IN THIS ARTICLE` list (exact h2 names) and FORMAT structure; sub-headings are
short lines without terminal punctuation followed by a paragraph.

### 7.2 Inspired — body HTML
- TYPE_1: `<h2 id="tocN">heading</h2>` + `<p>` per paragraph.
- TYPE_3: `<h2 id="tocN">` + `<h3>` per sub-heading + `<p>` per paragraph.
- TYPE_2: `<h2 id="tocN">` + optional intro `<p>` + placeholder: 1st TYPE_2 section → `[[custom-content-with-badge]]`,
  2nd → `[[custom-content-with-badge2]]`. More than two → BLOCK. No card content in body.
- TYPE_6: comparison card block:
  ```html
  <div style="background:#ffffff; border-radius:16px; box-shadow:0 1px 3px rgba(0,0,0,0.08); padding:24px; margin-bottom:32px;">
    <div style="display:flex; gap:16px; margin-bottom:20px;">
      <img src="[A]" alt="[Brand A product]" style="width:50%; border-radius:12px; object-fit:cover;">
      <img src="[B]" alt="[Brand B product]" style="width:50%; border-radius:12px; object-fit:cover;">
    </div>
    <p>[intro]</p>
    <p><strong>[Brand A product]</strong><br>[description and price]</p>
    <p><strong>[Brand B product — Better Value]</strong><br>[description, price, savings, link]</p>
    <p><a href="[PDP]" style="color: rgb(183, 91, 100);">Shop the [Product] →</a></p>
  </div>
  ```
  Missing image → `src="[CONFIRM IMAGE URL]"` + advisory.
- TYPE_4 and TYPE_5 never go in the body.
- `tocN` numbered over content sections only. Data tables → plain `<table><thead>…</thead><tbody>…</tbody></table>`.
- All body links: `style="color: rgb(183, 91, 100);"`.
- Inline images from the doc → `<img src="{cdnUrl}" alt="{alt}">` at the same position.
- **Design Box rule:** if Editor notes ask for an expert / designer / Design Services quote in a section, append
  at the end of that section exactly:
  `<p>Upload a photo of your room and let our visualizer show you exactly how it looks. <a href="https://tovfurniture.com/pages/design-box" style="color: rgb(183, 91, 100);">Try The Design Box →</a></p>`
  (no checklist item for it).

### 7.3 Inspired — field mapping
| Field | Rule |
|---|---|
| title | HEADLINE exact |
| summary (excerpt) | SUMMARY (TLDR), plain text |
| tags | TAGS → lowercase, spaces→hyphens, keep doc order |
| authorName (native) | Owner (fallback `TOV Furniture`) |
| image | FEATURED IMAGE (else advisory) |
| reading_time | READ TIME exact |
| blogtagline | first two tags **in doc order**, title case, joined ` · ` |
| homepage_display_tag | first tag in doc order, title case |
| article_toc_title | h2 texts joined `\|\|` (no FAQ/CTA) |
| article_author | Owner (fallback `TOV Furniture`) |
| quick_scoop_content | SUMMARY (TLDR) as **rich text JSON** |
| sidebar_cta_title / _text / _button_text / sidebar_button_link | fixed defaults `See It In Your Space` / `Upload a photo of your room and let our visualizer show you exactly how it looks.` / `Try The Design Box` / `https://tovfurniture.com/pages/design-box`, unless Editor notes override |
| cta_title_1 / cta_text_1 / cta_button_label_1 | TYPE_5 heading / paragraph / button label line |
| cta_button_link_1 | `CTA LINK:` if present, else omit + advisory |
| custom_content_with_badge(2) | product cards (7.4) |
| faqs | `[{"question","answer"}]` from TYPE_4 |
| Article_Featured_product | all resolved product-card products (GIDs) |
| Featured_Blog | **never written** (checklist reminder) |

### 7.4 Product cards (JSON array, keys in this exact order)
```json
{ "title": "", "badge": "", "badge_color": "", "badge_text_color": "#ffffff",
  "description": "", "bullets": ["Best for …"], "footer_label": "Shop {FirstWord} →",
  "footer_text": "<a href=\"{PDP}\" style=\"color: rgb(183, 91, 100);\">{product name without size}</a>" }
```
- Known badges at end of name line: New Arrival `#b15a63`, Best Seller `#485b59`, Statement Length `#6a596b`,
  Most Flexible `#3f4b59`, Final Sale `#5b3630`. Other badges cycle `#805e39, #8a5955, #5b5e4b, #645248, #1d3037`
  (no two different badges share a colour in one post). No badge → `"badge": "", "badge_color": ""` + advisory.
- `description` = paragraph minus the "Best for…" sentence; `bullets` = `["Best for…"]` or `[]`.
- No PDP resolved → `footer_text: ""` + advisory. Never put placeholder text inside JSON.
- `title` plain text only.

### 7.5 Press — input doc format and mapping
```
CONTENT TYPE: PRESS
OWNER: …            HEADLINE: …         PUBLICATION: …
ARTICLE URL: …      COVERAGE DATE: …    (optional)
SUMMARY: …
PRODUCTS:           one per line, "Name — URL" (≥1)
FEATURED IMAGE: …   FEATURED IMAGE ALT: …
```
| Field | Rule |
|---|---|
| title | HEADLINE exact |
| bodyHtml | `<p>{SUMMARY}</p>` |
| authorName | OWNER |
| image | FEATURED IMAGE (else advisory) |
| featured | PUBLICATION |
| customurl | ARTICLE URL (valid absolute https) |
| customlink_text | fixed `read the article` |
| Add_Schema_Mentions | fixed `true` |
| Article_Featured_product | resolved PRODUCTS (GIDs) |
Required: OWNER, HEADLINE, PUBLICATION, ARTICLE URL, SUMMARY, ≥1 product.

### 7.6 Fixed strings allowed (the only non-doc text)
Sidebar defaults, Design Box paragraph, `read the article`, `footer_label` pattern, product anchor text from the
resolved product name, `TOV Furniture` author fallback, badge colours, `#ffffff`.

---

## 8. Metafield reference (namespace `custom`)

| Key | Type | Value format | Inspired | Press |
|---|---|---|---|---|
| `homepage_display_tag` | single_line_text_field | string, no newlines | ✓ | |
| `reading_time` | single_line_text_field | string | ✓ | |
| `article_author` | single_line_text_field | string | ✓ | |
| `quick_scoop_content` | **rich_text_field** | `{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"…"}]}]}` | ✓ | |
| `sidebar_cta_title` | single_line_text_field | string | ✓ | |
| `sidebar_cta_text` | multi_line_text_field | string | ✓ | |
| `sidebar_cta_button_text` | single_line_text_field | string | ✓ | |
| `sidebar_button_link` | single_line_text_field | URL as string | ✓ | |
| `article_toc_title` | single_line_text_field | `A\|\|B\|\|C` | ✓ | |
| `custom_content_with_badge` | json | `JSON.stringify(array)` | ✓ | |
| `custom_content_with_badge2` | json | `JSON.stringify(array)` | ✓ | |
| `faqs` | json | `JSON.stringify(array)` | ✓ | |
| `cta_title_1` | single_line_text_field | string | ✓ | |
| `cta_text_1` | multi_line_text_field | string | ✓ | |
| `cta_button_label_1` | single_line_text_field | string | ✓ | |
| `cta_button_link_1` | single_line_text_field | URL as string | ✓ | |
| `blogtagline` | single_line_text_field | `A · B` | ✓ | |
| `Article_Featured_product` | **list.product_reference** (Product list — confirmed) | `JSON.stringify(["gid://shopify/Product/1", …])` — always an array, even for one product | ✓ | ✓ |
| `featured` | single_line_text_field | publication name | | ✓ |
| `customurl` | **url** | absolute https URL | | ✓ |
| `customlink_text` | single_line_text_field | `read the article` | | ✓ |
| `Add_Schema_Mentions` | boolean | `"true"` (lowercase) | | ✓ |

**Never written:** `Featured_Blog`, `author_image`, `author_position`, `hidden`, `article_banner_tag`,
`banner_position`, `bannor_imgas` (intentional typo), and anything not listed above.
If the live definitions disagree with this table, the live definitions win — stop and tell Abbir.

---

## 9. Error handling

| Class | Example | Handled by | Action |
|---|---|---|---|
| Input missing | No HEADLINE, no TYPE_5 heading | Intake / Validator | **BLOCK** — report names the exact missing label |
| Doc access | 403 from Docs API | Intake | **BLOCK** — "share doc with <service account email>" |
| Unknown type | No FORMAT tags, no `CONTENT TYPE: PRESS` | Intake | **BLOCK** |
| Model mapping error | Paragraph in wrong field, bad JSON, wrong toc numbering | Validator → FIX → Extractor | Up to 2 loops with the exact error list, then BLOCK |
| Verbatim failure | Text not found in source | Validator | FIX once (re-extract that field); second failure → BLOCK, show both strings |
| Product unresolved | 0 or ambiguous matches | Product Resolver | **Advisory**, `footer_text: ""`, continue |
| Image failure | Expired contentUri, Drive 403 | Media | Retry 2×, then **advisory**, continue without image |
| Shopify userErrors | Type mismatch on a metafield | Draft Writer | Map to field; if caused by payload → FIX to Extractor once; else BLOCK |
| Throttle / 5xx | `THROTTLED`, 502 | MCP server | Exponential backoff, max 4 retries, then BLOCK |
| Auth | 401/403 from Shopify | MCP server | **Stop the whole batch**, report "token/scopes" |
| Published target | Article already live | MCP server | Refuse update; report "already published — edit manually" |
| Read-back mismatch | Stored value ≠ sent value | Draft Writer | Retry once, then BLOCK with diff |
| Loop limit | 3rd FIX requested | Orchestrator | BLOCK |

Batch behaviour: one doc's BLOCK never stops the others (except auth errors). Every run keeps its folder so it can
be re-run with `/blog --resume <runId>` from the failed step.

---

## 10. How the system improves

1. **Run log:** `runs/index.csv` gives metrics per run — first-pass PASS rate, FIX loops, advisories, blocks by
   reason. `/stats` command summarises the last 30 runs.
2. **Human-edit learning:** `/learn <articleId>` (Learner agent) diffs our draft vs. the reviewed article. Common
   edits (e.g. "CTA link always set to the collection named in the button label", "badge X always recoloured")
   become **proposed lessons**.
3. **Lessons file:** `knowledge/lessons.md` with `## Active` (read by every agent) and `## Proposed`
   (Learner writes, Abbir approves). Lessons can add guidance, never override §2.
4. **Golden tests:** `tests/golden/<case>/` = input doc text + expected `05-payload.json`. Every change to prompts,
   parser or validator must keep all golden cases passing (`npm run test:golden`). Each real BLOCK/FIX that
   revealed a bug becomes a new golden case.
5. **Parser first:** when the Learner sees the same judgement call repeatedly solved the same way, move it from the
   Extractor prompt into `parse_brief` code (deterministic beats prompt).

---

## 11. Local testing with the dev store

### 11.1 Shopify setup (dev store only)
1. In the Shopify Dev Dashboard create an app for the **development store**; grant scopes
   `read_content, write_content, read_products, read_files, write_files`; install it on the dev store.
2. Get an Admin API access token for the dev store (client-credentials token from the Dev Dashboard app, refreshed
   by the server when expired — or a static token if the store has a legacy custom app).
3. On the dev store: create blogs `inspired` and `press`; recreate the article metafield definitions (same keys and
   types as §8 — check with `get_metafield_definitions`); add a few test products (e.g. "Fishy Water Glass, Set of 4",
   "Dex Ottoman"); make sure the theme has the `article-custom-json` template.

### 11.2 Google setup
Google Cloud project → enable Docs API + Drive API → service account → JSON key. Share test docs (or a Drive
folder) with the service account email.

### 11.3 `.env.example`
```
SHOPIFY_STORE_DOMAIN=tov-dev-store.myshopify.com
ALLOWED_STORES=tov-dev-store.myshopify.com
SHOPIFY_API_VERSION=2026-07
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_ADMIN_TOKEN=            # only if using a static token
GOOGLE_APPLICATION_CREDENTIALS=./secrets/service-account.json
MCP_ENV=test                    # test | prod
DRY_RUN=false
```
(Set `SHOPIFY_API_VERSION` to the latest stable version when building.)

### 11.4 Test layers
1. **Unit (Vitest):** parser, verbatim check, metafield value formatter, validator — using
   `tests/fixtures/storage-ottomans-brief.txt` and the glass-decor example.
2. **MCP Inspector:** `npx @modelcontextprotocol/inspector node dist/index.js` → call each tool by hand against the
   dev store. Start with `get_metafield_definitions`, `find_products`, then `create_article_draft` with `DRY_RUN=true`,
   then for real.
3. **Integration (Vitest, `MCP_ENV=test`):** create → get → update → read-back → `delete_test_article`. All test
   articles carry tag `mcp-test`; `npm run test:cleanup` deletes leftovers.
4. **Claude Code end-to-end:** register the server (`claude mcp add tov-shopify -- node dist/index.js` or
   `.mcp.json`), check with `/mcp`, then run `/blog <test-doc-url>` and inspect `runs/<runId>/`.
5. **Golden tests** (§10) before every merge.

### 11.5 Going live (later, by Abbir + the engineering team)
New app/token for the live store, add it to `ALLOWED_STORES`, `MCP_ENV=prod`, `delete_test_article` disappears
automatically. First live runs: `DRY_RUN=true`, compare, then real drafts.

---

## 12. Repo layout & build milestones

```
tov-blog-mcp/
├─ .mcp.json                    # registers tov-shopify for Claude Code
├─ .claude/
│  ├─ commands/blog.md          # /blog orchestrator instructions
│  ├─ commands/learn.md         # /learn
│  ├─ commands/stats.md         # /stats
│  └─ agents/{intake,extractor,product-resolver,media,validator,draft-writer,reporter,learner}.md
├─ server/src/
│  ├─ index.ts                  # MCP server, tool registration
│  ├─ shopify/{client,articles,products,files,definitions}.ts
│  ├─ google/docs.ts
│  ├─ parse/{inspired,press}.ts # parse_brief
│  ├─ validate/{verbatim,metafields,payload}.ts
│  └─ config/{contentTypes,metafields}.ts   # §3, §7, §8 as data
├─ knowledge/lessons.md
├─ runs/                        # gitignored
├─ tests/{unit,integration,golden,fixtures}/
├─ .env.example  .gitignore  package.json  tsconfig.json  README.md
```

Agent file format (Claude Code subagent):
```markdown
---
name: validator
description: Validates the merged payload against TOV rules and decides PASS / FIX / BLOCK.
tools: Read, Write, mcp__tov-shopify__validate_payload, mcp__tov-shopify__get_metafield_definitions
---
<role, inputs, decisions, output file, rules — copied from §4.5 and §2>
```
Give each agent only the tools it needs (only `draft-writer` gets create/update tools).

**Milestones** (finish and test each before the next):
1. Scaffold server + `get_metafield_definitions` + `find_products`; test in MCP Inspector on dev store.
2. `create_article_draft` / `update_article_draft` / `get_article` with all server-side enforcement + `DRY_RUN`.
3. `fetch_google_doc` + `parse_brief` (Inspired) + unit tests with the storage-ottomans fixture.
4. `validate_payload` (verbatim, types, allowlist) + unit tests.
5. `upload_image`.
6. Agents + `/blog` command; end-to-end on one Inspired doc.
7. Press type.
8. Reporter extras (Slack/email), `/learn`, `/stats`, golden tests.
9. Optional: Streamable HTTP + auth for claude.ai custom connector.

**Done means:** `/blog <url>` on a real Inspired doc creates a draft on the dev store whose every field matches the
golden expected payload, read-back passes, the report lists the right checklist, and re-running updates the same
draft instead of creating a new one.