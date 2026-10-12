# Shopify Blog Post Metafield Definitions (authoritative)

**Rule: always use the correct metafield key AND type. Never guess either.**
Source: Shopify admin → Settings → Custom data → Blog posts (screenshot 2026-10-12).
Keys below marked TBC must be confirmed by the Phase 1 definitions dump
(`metafieldDefinitions(ownerType: ARTICLE)` → `docs/shopify-article-metafield-definitions.json`).
If the dump disagrees with this file, the dump wins — update this file and tell Abbir.

| Admin name | Key (namespace `custom`) | Shopify type | Value format to send | Used by |
|---|---|---|---|---|
| Featured Blog | `Featured_Blog` | `boolean` | `"true"` / `"false"` (lowercase string) | Inspired |
| homepage display tag | `homepage_display_tag` | `single_line_text_field` | plain string, no newlines | Inspired |
| reading time | `reading_time` | `single_line_text_field` | e.g. `5 min read` | Inspired |
| author image | `author_image` | `file_reference` | file GID — **not used** | — |
| article author | `article_author` | `single_line_text_field` | plain string | Inspired |
| author position | `author_position` | `single_line_text_field` | **not used** | — |
| quick scoop content | `quick_scoop_content` | **`rich_text_field`** | **Shopify rich-text JSON**, not plain text (see below) | Inspired |
| sidebar cta title | `sidebar_cta_title` | `single_line_text_field` | plain string | Inspired |
| sidebar cta text | `sidebar_cta_text` | `multi_line_text_field` | plain string (newlines allowed) | Inspired |
| sidebar cta button text | `sidebar_cta_button_text` | `single_line_text_field` | plain string | Inspired |
| sidebar button link | `sidebar_button_link` | `single_line_text_field` (not URL type) | URL as plain string | Inspired |
| article toc title | `article_toc_title` | `single_line_text_field` | h2 texts joined with `\|\|` | Inspired |
| Type 2 custom content1 | TBC (guide says `custom_content_with_badge`) | `json` | JSON array, serialized as string | Inspired |
| Type 2 custom content2 | TBC | `json` | JSON array, serialized as string | Inspired (2nd product section?) |
| FAQS | `faqs` (TBC) | `json` | `[{"question","answer"}]` serialized as string | Inspired |
| cta title 1 | `cta_title_1` | `single_line_text_field` | plain string | Inspired |
| cta text 1 | `cta_text_1` | `multi_line_text_field` | plain string | Inspired |
| cta button label 1 | `cta_button_label_1` | `single_line_text_field` | plain string | Inspired |
| cta button link 1 | `cta_button_link_1` | `single_line_text_field` (not URL type) | URL as plain string | Inspired |
| Article Featured product | `Article_Featured_product` (TBC) | product reference — **single vs list TBC** (live glass article holds 4 products, so likely `list.product_reference`) | single: `"gid://shopify/Product/123"`; list: `"[\"gid://…\",\"gid://…\"]"` | Press (+ Inspired?) |
| banner position | `banner_position` | `single_line_text_field` | **not written** (checklist reminder only) | — |
| hidden | `hidden` | **`number_integer`** | **not used** | — |
| article banner tag | `article_banner_tag` | `single_line_text_field` | **not used** | — |
| featured | `featured` | `single_line_text_field` | publication name | Press |
| Add Schema Mentions | `Add_Schema_Mentions` | `boolean` | `"true"` | Press |
| banner imgae | `bannor_imgas` (intentional typo, TBC) | `file_reference` | **not used** | — |
| customlink_text | `customlink_text` | `single_line_text_field` | e.g. `read the article` | Press |
| customurl | `customurl` | **`url`** | must be a valid absolute https URL | Press |
| blogtagline | `blogtagline` | `single_line_text_field` | e.g. `Glass Decor · Colored Glass Vases` | Inspired |

## Type gotchas

- **Booleans** (`Featured_Blog`, `Add_Schema_Mentions`): send `"true"`, never `"True"`. The old paste guide
  says "True" because a human was typing it into a toggle.
- **Rich text** (`quick_scoop_content`): the value must be Shopify's rich-text JSON, e.g.
  `{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"Plain clear glass is…"}]}]}`.
  Sending plain text will be rejected.
- **Single line text** fields must not contain newlines — strip them during mapping; validation fails if any remain.
- **JSON** fields: build the object in code, then `JSON.stringify` once. Never hand-build JSON strings.
- **URL** (`customurl`): validate with `new URL()` and require `https:`.
- **Product reference**: resolve products to GIDs via the product picker; never send handles or titles.
- Before every `articleCreate`/`articleUpdate`, validate each metafield value against the dumped definition
  (type + any validations). Mismatch → item goes to Needs input with the field name and reason.
