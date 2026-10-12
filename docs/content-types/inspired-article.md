# Content Type: Inspired Article

Source of truth for the existing manual process: `docs/content-types/inspired-article-rules.md`
(the full Claude Project instructions, copied verbatim). This spec maps those rules to app behaviour.
Samples: `docs/samples/storage-ottomans-brief.txt` (raw brief) and `docs/samples/glass-decor-paste-guide.txt`
(finished output for a different brief).

---

## 1. Shopify target

| Setting | Value |
|---|---|
| Blog handle | `inspired` |
| Template suffix | `article-custom-json` (fixed in code) |
| Published | `false` by default (fixed in code; only schedule/urgent settings can change it) |
| Metafield namespace | `custom` |

Metafield keys, types and value formats: see `docs/shopify-article-metafields.md` (authoritative, rule 7).
Types below are only repeated where they affect mapping. Phase 1 must include a script that reads
`metafieldDefinitions(ownerType: ARTICLE)` from the dev store and saves them to
`docs/shopify-article-metafield-definitions.json`. Validation uses those real definitions.

---

## 2. Processing strategy (decision)

Most transformation rules are deterministic, so they are implemented in **plain code**, not Gemini.
This guarantees the "no invented text" rule for almost every field.

**Gemini is used only for judgement calls**, always with structured JSON output, and every text it returns
is passed through the verbatim check:
- Splitting a product-card name line into title + badge when the badge is not in the known badge list.
- Reading EDITOR METADATA notes to detect: sidebar CTA overrides, expert/Design Services quote slots
  (and which section they belong to), and pre-publish instructions to turn into checklist items.
- Fallback when a section is malformed and code parsing fails (result must still pass verbatim check,
  otherwise → Needs input).

---

## 3. Input brief format

Plain-text sections in this order (from the Google Doc):
`EDITOR METADATA` (Week, Owner, Existing URL, Internal links FROM, Editor notes), `HEADLINE`, `SUBTITLE`,
`READ TIME`, `TAGS`, `SUMMARY (TLDR)`, `IN THIS ARTICLE` (list of section headings), then body sections
each starting with a format tag line:

- `[FORMAT: TYPE_1_TEXT]` — heading line, then paragraphs
- `[FORMAT: TYPE_2_OPTIONS]` — heading, optional intro paragraph, then product blocks
  (name line, description paragraph ending in a "Best for…" sentence)
- `[FORMAT: TYPE_3_SUBTITLES]` — heading, then repeated (sub-heading line, paragraph)
- `[FORMAT: TYPE_4_FAQ]` — heading, then repeated (question line ending in `?`, answer paragraph)
- `[FORMAT: TYPE_5_CTA]` — heading, body paragraph, last line = button label
- `[FORMAT: TYPE_6_COMPARISON]` — comparison pairs (no sample yet — see open questions)

Confirmed: marketing docs use **plain text lines, not Google heading styles** (exactly like the sample).
The parser therefore relies on the label lines, the FORMAT tags and the `IN THIS ARTICLE` list.

New optional labels (see `docs/marketing/inspired-doc-template.md`):
- `FEATURED IMAGE:` followed by a pasted image, or a Drive link / image URL on the same line;
  optional `FEATURED IMAGE ALT:` line.
- `CTA LINK:` line at the end of the TYPE_5 section. If present it is NOT the button label — the button label is
  the last line before it.
- `PRODUCT LINKS:` block (product name — URL per line) to pre-fill product matches.
- **Images inside body sections** (pasted in the doc) are uploaded to Shopify Files and inserted as
  `<img src="…" alt="…">` at the same position. Optional `IMAGE ALT:` line directly under an image. Missing alt
  text → ADVISE (never invented).

Google Docs API note: inline images expose a short-lived `contentUri`; download immediately during fetch.

Parsing note: the Google Doc export should keep paragraph boundaries. Distinguish heading lines from
paragraphs using the doc's heading styles where available; fall back to "short line without terminal
punctuation" heuristics and the `IN THIS ARTICLE` list (which names every h2).

---

## 4. Field map

Legend — **Method**: CODE (deterministic), AI (Gemini + verbatim check), FIXED (constant), HUMAN (cannot
come from the brief). **Level**: BLOCK = missing → Needs input, item cannot be created; ADVISE = item can be
created as draft but shows a warning + checklist entry; OPT = optional.

### Native article fields
| Field | Source | Method | Level |
|---|---|---|---|
| title | HEADLINE, exact | CODE | BLOCK |
| summary (excerpt) | SUMMARY (TLDR), plain text | CODE | BLOCK |
| tags | TAGS → lowercase, spaces→hyphens, comma-joined | CODE | BLOCK |
| templateSuffix | `article-custom-json` | FIXED | — |
| isPublished | `false` unless schedule/urgent says otherwise | FIXED | — |
| author (native) | EDITOR METADATA Owner (Settings can switch to a fixed default name) | CODE | BLOCK |
| image (featured) | `FEATURED IMAGE:` block in the doc — pasted image, Google Drive link, or image URL. App downloads it and uploads to Shopify. Alt text from `FEATURED IMAGE ALT:` if given. Missing → upload in app | CODE (+ HUMAN fallback) | ADVISE |
| handle | Shopify auto from title (unless brief adds one) | CODE | OPT |
| body | built from body sections (section 5) | CODE | BLOCK |

### Metafields (`custom.*`)
| Key | Source | Method | Level |
|---|---|---|---|
| reading_time | READ TIME, exact | CODE | BLOCK |
| blogtagline | first two TAGS **in the order written in the doc** (never Shopify's alphabetical order), title case, joined ` · ` | CODE | BLOCK |
| homepage_display_tag | first TAG in doc order, title case | CODE | BLOCK |
| article_toc_title | body h2 texts joined with `\|\|` (no FAQ/CTA) | CODE | BLOCK |
| article_author | EDITOR METADATA Owner; fallback `TOV Furniture` | CODE | BLOCK |
| quick_scoop_content | SUMMARY (TLDR), converted to Shopify rich-text JSON (type is rich_text_field) | CODE | BLOCK |
| sidebar_cta_title | default `See It In Your Space` unless notes override | FIXED / AI | BLOCK |
| sidebar_cta_text | default `Upload a photo of your room and let our visualizer show you exactly how it looks.` | FIXED / AI | BLOCK |
| sidebar_cta_button_text | default `Try The Design Box` | FIXED / AI | BLOCK |
| sidebar_button_link | default `https://tovfurniture.com/pages/design-box` | FIXED / AI | BLOCK |
| Featured_Blog | **not written** — marketing sets it manually during review | — | — |
| cta_title_1 | TYPE_5 heading | CODE | BLOCK if TYPE_5 exists |
| cta_text_1 | TYPE_5 body paragraph | CODE | BLOCK if TYPE_5 exists |
| cta_button_label_1 | TYPE_5 last line | CODE | BLOCK if TYPE_5 exists |
| cta_button_link_1 | `CTA LINK:` line in the TYPE_5 section if present; otherwise left blank (optional) — can be filled in the app | CODE | ADVISE |
| custom_content_with_badge ("Type 2 custom content1", JSON) | first TYPE_2 section (section 6) | CODE + AI | BLOCK if TYPE_2 exists |
| custom_content_with_badge2 ("Type 2 custom content2", JSON) | second TYPE_2 section, if any. Generic JSON slot — content depends on what marketing provides; most posts use only content1 | CODE + AI | OPT |
| faqs | TYPE_4 section → `[{"question","answer"}]` | CODE | BLOCK if TYPE_4 exists |
| Article_Featured_product | every product confirmed in the product cards, as product GIDs (format per metafield type) | CODE | ADVISE |

**Never written** (TOV does not use): `author_image`, `author_position`, `hidden`, `article_banner_tag`,
`featured`, `Add_Schema_Mentions`, `bannor_imgas` (intentional typo), `customlink_text`, `customurl`,
`banner_position` (checklist reminder only).

---

## 5. Body HTML rules (summary — full rules in inspired-article-rules.md)

- TYPE_1: `<h2 id="tocN">heading</h2>` + `<p>` per paragraph.
- TYPE_3: `<h2 id="tocN">` + `<h3>` per sub-heading + `<p>` per paragraph.
- TYPE_2: `<h2 id="tocN">` + optional intro `<p>` + literal placeholder. First TYPE_2 section →
  `[[custom-content-with-badge]]` (fills `custom_content_with_badge`); second TYPE_2 section →
  `[[custom-content-with-badge2]]` (fills `custom_content_with_badge2`). More than two TYPE_2 sections → BLOCK
  (theme supports only two). No product content in the body. (Logic lives in the theme section
  `article-custom-layout.liquid`.)
- TYPE_6: comparison card HTML block (template in rules file); missing images → `src="[CONFIRM IMAGE URL]"`
  + ADVISE.
- TYPE_4 and TYPE_5: excluded from body.
- `tocN` numbered sequentially over content sections only.
- All body links: `style="color: rgb(183, 91, 100);"`.
- **Design Box rule:** if editor notes request an expert / designer / Design Services quote in a section,
  append this exact paragraph at the end of that section (no checklist item):
  `<p>Upload a photo of your room and let our visualizer show you exactly how it looks. <a href="https://tovfurniture.com/pages/design-box" style="color: rgb(183, 91, 100);">Try The Design Box →</a></p>`

---

## 6. Product cards

One JSON array, keys in this exact order:
`title, badge, badge_color, badge_text_color, description, bullets, footer_label, footer_text`.

- Name line → `title` + `badge`. Known badges (match at end of line): New Arrival, Best Seller,
  Statement Length, Most Flexible, Final Sale. Unknown trailing phrase → AI split (verbatim check).
- `description` = paragraph minus the sentence starting with "Best for"; `bullets` = `["Best for…"]` or `[]`.
- `badge_color`: New Arrival `#b15a63`, Best Seller `#485b59`, Statement Length `#6a596b`,
  Most Flexible `#3f4b59`, Final Sale `#5b3630`; other badges cycle `#805e39`, `#8a5955`, `#5b5e4b`,
  `#645248`, `#1d3037` so no two different badges in one post share a colour. No badge → `badge: ""`,
  `badge_color: ""`.
- `badge_text_color` always `#ffffff`.
- `footer_label` = `Shop {first word of title} →`.
- `footer_text` = `<a href="{PDP URL}" style="color: rgb(183, 91, 100);">{product name without size}</a>`.
- **PDP URLs are not in the brief.** App feature: search Shopify products by card title, show best matches,
  user confirms in the Review page. Unconfirmed → `footer_text: ""` + ADVISE.
- Never put placeholder text inside JSON (it renders live). Escape `"` (e.g. `47\"`).

---

## 7. Review checklist (ADVISE items, shown in app + included in emails)

Auto-generated per item: set Featured Blog if this post should be featured; upload featured image; confirm `cta_button_link_1`; products with empty badge;
products with no confirmed PDP URL; check `banner_position` if needed; plus every pre-publish instruction
found in EDITOR METADATA notes (e.g. "confirm product URLs", "add Search Console KPI", stock/returns checks).

---

## 8. Open questions

1. A sample brief containing `TYPE_6_COMPARISON`, and its finished output.

## 9. Resolved (2026-10-12)

- Native author = Owner from the doc (with a setting for a fixed default).
- Article_Featured_product is filled from the confirmed product-card products.
- Tagline/homepage tag use the doc's tag order.
- CTA link optional via `CTA LINK:`; blank + ADVISE when missing.
- Featured and body images come from the doc (pasted image, Drive link or URL).
- Docs use plain text lines, not heading styles.
- Featured_Blog is not written by the app; marketing sets it manually during review.
- Second product-card section uses metafield `custom_content_with_badge2` and placeholder
  `[[custom-content-with-badge2]]` (confirmed in theme section `article-custom-layout.liquid`).
