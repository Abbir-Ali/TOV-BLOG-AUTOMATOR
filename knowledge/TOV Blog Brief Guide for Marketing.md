# TOV Blog Brief Guide for Marketing

Blog briefs feed an automated Shopify publishing system. The system reads each brief as plain text. It picks
up labels written in CAPS followed by a colon, and FORMAT markers written in square brackets. It ignores
tables, HTML, markdown and rich text formatting.

---

## Which template to use

Make a copy of the template you need. Never edit the master templates.

- **Inspired Post** — editorial articles, trend pieces, product roundups, how-tos and brand stories.
- **Press Article** — when an outside publication covers TOV or one of our products.

Share your copy with **tovblogautomation@log-analysis-241402.iam.gserviceaccount.com** as **Viewer** before
submitting. The system cannot read the doc without this.

---

## The golden rules

**Write only after the colon** on each label line, or on the line directly below it if the value is long.

**Never write [ADD LINK], [TBD], XXX or anything in square brackets.** Leave the field blank instead.

**Plain text only.** No bold, no bullet points, no markdown, no pasted tables in the body sections.

**Non-content goes in Editor notes.** SEO notes, research sources, reminders and internal context go in
Editor notes only — never in the article body.

**Never write FEATURED_BLOG.** That flag is set manually in Shopify after review.

**Delete unused FORMAT sections** from the body before submitting. Keep the CTA section — it is always
required.

**Lines starting with // are template guidance** and are ignored by the system. Never start a field value
with //.

---

## What stops the system (blockers)

The system stops and will not create a draft if any of these are missing:

| Missing | What to do |
|---|---|
| HEADLINE | Add the article title on one line |
| READ TIME | Add e.g. `5 min read` |
| TAGS | Add at least one lowercase tag |
| SUMMARY (TLDR) | Add 1–2 plain sentences |
| TYPE_5_CTA section | Keep it — it is required |
| Doc not shared with service account | Share with tovblogautomation@log-analysis-241402.iam.gserviceaccount.com as Viewer |

---

## What does NOT stop the system (advisories)

These are noted in the review checklist but the draft is created anyway:

- No featured image → reviewer adds it in Shopify
- Owner left blank → author defaults to "TOV Furniture"
- CTA LINK: left blank → reviewer adds the URL before publishing
- Products not found in the store → product name is saved, reviewer adds the PDP link
- No badges on product cards → reviewer confirms during review

---

## Tag order matters

The first tag becomes the **blog card label** (e.g. "Storage Ottomans").
The first two tags become the **tagline** (e.g. "Storage Ottomans · Storage Benches").
Put the most specific tag first. Separate tags with commas. All lowercase, spaces are fine.

---

## Product cards (Inspired posts only)

For posts with product roundups (`[FORMAT: TYPE_2_OPTIONS]`), each product needs three things:

1. **A name line:** the product name, optionally followed by one badge at the end.
   Known badges: `New Arrival`, `Best Seller`, `Statement Length`, `Most Flexible`, `Final Sale`

2. **A description paragraph** that ends with: `Best for [who this is for].`

3. **A matching line in PRODUCT LINKS:**
   ```
   Product Name — https://tovfurniture.com/products/handle
   ```
   The name in PRODUCT LINKS must match the card name exactly, **without the badge**.

If you don't have the product URL yet, write the name only — the system will search by name and add an
advisory to confirm the link. Do not leave the name out.

---

## Editor notes: what the system acts on

Use these exact phrasings in the Editor notes field:

- **Add a Design Services quote in the "[Section Name]" section** — inserts the Design Box in that section
- **Sidebar CTA should link to https://… instead of Design Box** — changes the sidebar button
- **Sidebar CTA title should be "[Title]"** — changes the sidebar heading
- **Confirm … before publishing** — adds an item to the reviewer checklist

Research sources, SEO notes and internal context go in Editor notes and are never published.

---

## Common mistakes

| Mistake | Fix |
|---|---|
| READ TIME or TAGS left blank | Fill both — the system stops without them |
| [ADD LINK HERE] or TBD in a field | Leave the field blank instead |
| SEO notes or sources in the body | Move them to Editor notes |
| FORMAT line missing from a body section | Keep `[FORMAT: TYPE_X_NAME]` as the first line of each section |
| IN THIS ARTICLE doesn't match body headings | Copy and paste the headings exactly from the FORMAT sections |
| Product name differs between card and PRODUCT LINKS | Make them identical, minus the badge |
| Description doesn't end with "Best for…" | Every product description must end with it |
| Unused body sections left in | Delete any FORMAT section you didn't fill |
| CTA section deleted | Always keep it — it is required |
| Doc not shared with service account | Share with tovblogautomation@log-analysis-241402.iam.gserviceaccount.com as Viewer |
