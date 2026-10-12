# Content Type: Press Article

Press articles are short "as seen in" posts that point to coverage of TOV on an external site.
Example live page: `https://tovfurniture.com/blogs/press/i-work-in-fashion-33-chic-amazon-items-im-eyeing-for-my-closet-vanity-and-home`

Unlike Inspired articles there is no long body, no FORMAT tags, no product cards, no FAQ, no TOC.
**No Gemini needed** — every field maps directly from input.

---

## 1. Shopify target

| Setting | Value |
|---|---|
| Blog handle | `press` |
| Template suffix | TBC — appears to be the default article template (confirm via API in Phase 1) |
| Published | `false` by default (fixed in code) |
| Metafield namespace | `custom` |

Metafield keys, types and value formats: see `docs/shopify-article-metafields.md` (authoritative, rule 7).

---

## 2. Frontend (what the theme renders)

- Full-width hero image (featured image) with the title in a centred white box
- "All Blogs" back link, month/year date, social share icons
- Body content (one short paragraph)
- "Read the article" link to the external coverage (from `customlink_text` + `customurl`)
- "Products featured in this article" product grid (from `Article_Featured_product`)

---

## 3. Field map

Legend as in `inspired-article.md` (CODE / FIXED / HUMAN; BLOCK / ADVISE / OPT).

### Native article fields
| Field | Source | Method | Level |
|---|---|---|---|
| title | Headline of the external article, exact | CODE | BLOCK |
| body | One short paragraph (e.g. "A fashion insider's chic Amazon picks for closet, vanity, and home include our Dex Small Round Ottoman.") wrapped in `<p>` | CODE | BLOCK |
| summary (excerpt) | not used (empty on live example) | — | OPT |
| tags | not used (empty on live example) | — | OPT |
| image (featured) | not in input yet | HUMAN (upload in app) | ADVISE for draft, BLOCK for publish |
| author (native) | open question (same as Inspired) | — | — |
| publish date | open question — coverage date? | — | — |

### Metafields (`custom.*`)
| Key | Source | Method | Level |
|---|---|---|---|
| featured | Publication name (e.g. `Who What Wear`) | CODE | BLOCK |
| customurl | External article URL (`url` type — must be valid absolute https URL) | CODE | BLOCK |
| customlink_text | default `read the article` | FIXED | BLOCK |
| Add_Schema_Mentions | `"true"` (boolean) | FIXED | BLOCK |
| Article_Featured_product | Product(s) mentioned → product reference list. App searches Shopify products by name, user confirms | CODE + HUMAN confirm | BLOCK (at least one) |

**Not written for Press:** all Inspired-only fields (reading_time, blogtagline, homepage_display_tag,
article_toc_title, article_author, quick_scoop_content, sidebar_*, Featured_Blog, Type 2 custom content,
faqs, cta_*), plus author_image, author_position, hidden, article_banner_tag, banner_position, bannor_imgas.

---

## 4. Input format (proposal — confirm with marketing)

Press items are tiny, so one Google Doc per press mention is overkill. Proposed: a **Press tracker
Google Sheet**, one row per mention, added to the bucket once. Each new row becomes its own queue item.

| Column | Example |
|---|---|
| Headline | I Work in Fashion— 33 Chic Amazon Items I'm Eyeing for My Closet, Vanity, and Home |
| Publication | Who What Wear |
| Article URL | https://www.whowhatwear.com/fashion/shopping/chic-amazon-fashion-beauty-home-items-2026 |
| Summary | A fashion insider's chic Amazon picks for closet, vanity, and home include our Dex Small Round Ottoman. |
| Products | Dex Ottoman (one or more product names or URLs, comma-separated) |
| Coverage date | 2026-10-04 |
| Image | (optional) Drive link or URL |

Alternative: a simple "Add press mention" form inside the app with the same fields.

---

## 5. Validation

- BLOCK: missing headline, publication, article URL, summary, or no confirmed product.
- BLOCK: article URL not reachable or not https (warn only if the site blocks bots).
- ADVISE: no featured image; duplicate check — an existing press article with the same `customurl`.

---

## 6. Open questions

1. What does marketing send today for a press mention? Is the summary sentence written by them?
2. Template suffix for the press blog (default, or a named one?).
3. Is `customlink_text` always "read the article"? Is `Add_Schema_Mentions` always True?
4. Should the article's publish/visible date be the coverage date (the page shows "OCT 2026")?
5. Can a press article feature more than one product?
6. Sheet-row input vs. in-app form — which does marketing prefer?
