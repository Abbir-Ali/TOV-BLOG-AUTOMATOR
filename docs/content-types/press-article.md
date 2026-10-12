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
| Template suffix | none — **Default blog post** template (send null/empty `templateSuffix`) |
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
| image (featured) | `FEATURED IMAGE:` block in the doc (pasted image, Drive link or URL); missing → upload in app | CODE (+ HUMAN fallback) | ADVISE |
| author (native) | `OWNER:` line in the doc (Settings can switch to a fixed default name) | CODE | BLOCK |
| coverage date | `COVERAGE DATE:` line, stored for reference only (publishing is always a human action) | CODE | OPT |

### Metafields (`custom.*`)
| Key | Source | Method | Level |
|---|---|---|---|
| featured | Publication name (e.g. `Who What Wear`) | CODE | BLOCK |
| customurl | External article URL (`url` type — must be valid absolute https URL) | CODE | BLOCK |
| customlink_text | always `read the article` (confirmed) | FIXED | BLOCK |
| Add_Schema_Mentions | always `"true"` (boolean, confirmed) | FIXED | BLOCK |
| Article_Featured_product | `PRODUCTS:` block (one or more) → product GIDs. App matches by URL or name, user confirms | CODE + HUMAN confirm | BLOCK (at least one) |

**Not written for Press:** all Inspired-only fields (reading_time, blogtagline, homepage_display_tag,
article_toc_title, article_author, quick_scoop_content, sidebar_*, Featured_Blog, Type 2 custom content,
faqs, cta_*), plus author_image, author_position, hidden, article_banner_tag, banner_position, bannor_imgas.

---

## 4. Input format (decided)

One Google Doc per press mention, added to the bucket like Inspired docs, following
`docs/marketing/press-doc-template.md`:
`OWNER`, `HEADLINE`, `PUBLICATION`, `ARTICLE URL`, `COVERAGE DATE` (optional), `SUMMARY`, `PRODUCTS`
(one per line, name and/or TOV URL), `FEATURED IMAGE` (+ optional `FEATURED IMAGE ALT`).

## 5. Validation

- BLOCK: missing headline, publication, article URL, summary, or no confirmed product.
- BLOCK: article URL not reachable or not https (warn only if the site blocks bots).
- ADVISE: no featured image; duplicate check — an existing press article with the same `customurl`.

---

## 6. Open questions

1. Confirm marketing is happy to fill the press doc template (they write the SUMMARY sentence).
