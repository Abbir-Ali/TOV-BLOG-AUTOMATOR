# Lessons

Read by every agent before starting. Lessons add guidance; they never override the non-negotiable rules (§2) or
content rules (§7) in TOV_BLOG_MCP_AGENTS.md.

## Active

### L-000 — Never ask clarifying questions before creating the draft
The one and only confirmation is "Validator passed — ready to create the draft? (yes/no)". That is it.
Do not ask for the author name. Do not ask for the featured image URL. Do not ask for the CTA link.
Do not ask about product URLs. Do not ask about badges. Build the best draft possible from what
is in the doc, note everything missing as an advisory, and ask only once for the final yes/no.
If the user says "go ahead" or "create it" or "do it" at any point after the validator passes,
treat that as yes and create the draft immediately.

### L-001 — Unresolved products are advisories, not blockers
If find_products returns no match for a product card, set footer_text to the product name as plain text
(not a link, not empty). Continue building the draft. Do not stop. The reviewer adds the PDP URL during
review. Never leave footer_text blank when you know the product name.

### L-002 — Missing image, Owner and CTA link are advisories, not blockers
A draft can be created without a featured image, without an Owner (defaults to "TOV Furniture") and without
a CTA button link. Note each as an advisory and continue. Never stop for these.

### L-003 — Card key order is normalised automatically
The server normalises product card key order before validating, so never retry a payload just because cards
came back in alphabetical order. If the validator rejects cards, check for other errors first.

### L-004 — Template instruction lines are stripped automatically
The parser strips lines like "Text section — heading + paragraphs", "Product roundup — name, description,
Best for.", "Tips or how-to —", "Call to action — REQUIRED, always last", "Before you submit", and ☐
checklist lines from the doc template. If you see these in parse output, rebuild is not needed — they were
already stripped.

### L-005 — When the doc is the master template, not a filled-in brief
If parse_brief returns missing[] with HEADLINE, READ TIME, TAGS and SUMMARY all empty, the user has
probably shared the blank master template instead of a filled-in doc. Say clearly:
"This looks like the blank master template. Please make a copy, fill in the required fields, share it with
tovblogautomation@log-analysis-241402.iam.gserviceaccount.com as Viewer, and send me the new link."

### L-006 — Test store vs live store for product resolution
On the dev store (zaid-test-store-2), most TOV products do not exist. Unresolved products on the dev store
are expected and normal. Do not tell the user "this product doesn't exist" — say "not found on the dev
store — will resolve on the live store." Misty, Dex Ottoman and Fishy Water Glass are among the few test
products that do exist on the dev store.

### L-007 — Confirm before writing, then be direct
Always ask for yes/no confirmation before calling create_article_draft or update_article_draft. Once the
user says yes, execute immediately without re-explaining. After creation, show only: title, admin link,
advisories, checklist. Do not repeat the full payload or re-list things the user already approved.

### L-008 — Blank CTA LINK is intentional, not an error
When CTA LINK: is blank in the doc, the marketing team wants to add it during review (the URL may not be
confirmed yet). This is expected. Add one advisory "Add CTA button link before publishing" and continue.
Never invent a URL for the CTA link, even if you can guess it from context.

### L-009 — "Shop the full edit" and similar inline links have no URL in the doc
When the doc body contains phrases like "Shop the full edit", "Browse all sofas", "See the full collection"
without a URL, these are internal links the editor adds manually in Shopify. Do not try to resolve them.
Add an advisory: "Add internal links to [phrase] during review."

### L-010 — The doc format the team uses
TOV blog briefs follow a strict template with [FORMAT: TYPE_X_Y] section markers. The team uses Google
Docs with the service account tovblogautomation@log-analysis-241402.iam.gserviceaccount.com as Viewer.
When a 403 error occurs, always give the full email address to share with — do not abbreviate it.

### L-011 — Hyperlinks in the doc body ARE now extracted automatically
As of the latest server build, the Google Docs API extracts hyperlinks from the document body. If a
product name is hyperlinked in the doc, the URL is passed to parse_brief via the `links` parameter and
used automatically for the product card footer. Always pass fetch_google_doc's `links` field to
parse_brief as the `links` parameter. Do NOT tell the user "hyperlinks are invisible" — that was true
before, it is no longer true. The correct advice now is: hyperlinks in the doc body work, AND
PRODUCT LINKS: also works. If a product still has no URL after both, then say:
"Add it to PRODUCT LINKS: in the doc or hyperlink the product name in the body."

### L-012 — Always show a pre-flight summary before asking for yes/no
After the validator passes, before asking for confirmation, show a structured summary so the user
can review without reading the full payload. Format it exactly like this:

---
**Pre-flight summary**

📄 **Title:** [title]
📝 **Blog:** inspired · article-custom-json (or press · default)
🏷️ **Tags:** [tag1, tag2, ...]
👤 **Author:** [name] *(or "TOV Furniture — no Owner in doc")*
🖼️ **Featured image:** [URL shortened] *(or "⚠️ None — add before publishing")*
🔗 **CTA link:** [URL] *(or "⚠️ None — add before publishing")*

**Product cards ([N]):**
- [Product name] — ✅ URL resolved *(or "⚠️ No URL — add to PRODUCT LINKS: or hyperlink in doc")*

**Advisories ([N]):**
- [each advisory on its own line]

**Reviewer checklist:**
- [each checklist item]

Ready to create the draft? Reply **yes** to confirm, **no** to cancel, or tell me what to change first.
---

If the user says yes / go ahead / do it / create it → create immediately, no further questions.
If the user asks to change something → make the change, re-validate if needed, show summary again.

### L-013 — When products have no URL, always suggest how to fix it
When a product card has no URL, always tell the user both options:
1. Add a line in the doc under PRODUCT LINKS: → `Product Name — https://tovfurniture.com/products/handle`
2. Or hyperlink the product name anywhere in the doc body — the system extracts it automatically

Never just say "no URL found" without the fix instructions.

## Proposed

_(the Learner writes here; Abbir approves and moves items to Active)_
