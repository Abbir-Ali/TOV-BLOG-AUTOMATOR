# TOV Blog Automator — Project Memory

This file is the permanent context for this project. Read it fully at the start of every session.
Update the "Decisions log" and "Current status" sections whenever something is decided or finished.

---

## 1. What this app is

An embedded Shopify app for **TOV Furniture** (tovfurniture.com) that automates creating blog content in Shopify.

The marketing team writes each blog in its own **Google Doc**. Today a person copies every field from a
formatted guide into Shopify admin by hand. This app removes that manual step completely.

**End-to-end flow:**

1. A user adds one or more Google Doc links to the **Bucket** and picks the **content type** (e.g. Article, Press, Blog).
2. The app fetches the doc through the Google Docs API.
3. **Gemini** extracts the doc's content into the structured fields defined by that content type's template.
4. The app **validates** everything: required fields present, metafield types correct (checked against Shopify's
   live metafield definitions), product handles exist, JSON fields well-formed, and every extracted text field
   actually appears in the source doc.
5. If something required is missing or invalid → status **Needs input**, the user sees exactly what is missing,
   and an email alert goes out.
6. If valid → status **Ready**. The scheduler (or an "urgent" action) creates the article in Shopify.
7. Emails go to configured recipients for: items needing input, failures, schedule summaries, and published items.

**Users:** Abbir (developer/admin) and the TOV marketing team (non-technical). The UI must be simple and visual.

---

## 2. Non-negotiable rules

These rules override convenience. Never weaken them without Abbir explicitly approving and logging it in the Decisions log.

1. **No invented copy.** Gemini is an *extractor/formatter*, not a writer. Every piece of text that reaches Shopify
   must come from the source Google Doc. After extraction, run a **verbatim check**: each text field (after
   normalizing whitespace and stripping HTML tags) must be found in the doc's text. Any mismatch → Needs input,
   never auto-fixed silently.
2. **Draft by default.** Articles are created with `isPublished: false` unless a schedule or urgent action
   explicitly says otherwise. Publish behaviour is set in code from app settings, never taken from Gemini output
   or from document content.
3. **Template rules come from the content-type config, not from the AI.** Blog handle, template suffix, and
   metafield namespace/key/type are fixed per content type and set in code.
4. **No duplicates.** Every queue item stores the Shopify article ID once created. Re-processing updates that
   article instead of creating a new one.
5. **Secrets never in code or Git.** All keys live in `.env` (gitignored). Provide `.env.example` with
   placeholder names only.
6. **Test against a development store first.** Never point a new feature at the live TOV store until it has worked
   on the dev store.
7. **Correct metafields and types, always.** Every metafield key, type and value format must match
   `docs/shopify-article-metafields.md` (and the dumped definitions JSON once it exists). Never guess
   a key or type, and validate every value against its definition before calling Shopify.

---

## 3. Tech stack

- **App framework:** Shopify's official app template (scaffolded with Shopify CLI), currently React Router based,
  embedded in Shopify admin. Use whatever UI component system the current template ships with (Polaris).
- **Language:** TypeScript.
- **Database:** PostgreSQL via Prisma. (Local dev can use a hosted free Postgres such as Neon to avoid installing
  Postgres on Windows.)
- **Background jobs + scheduling:** `pg-boss` (job queue that runs on Postgres — no Redis needed).
- **Google Docs:** Google Docs API + Drive API with a **service account**. Docs (or a shared Drive folder) are
  shared with the service account email.
- **Parsing first, AI second:** Most fields are mapped with plain deterministic code (see the content-type specs).
  Gemini is used only for judgement calls (e.g. splitting an unknown badge from a product name, reading editor
  notes) and as a fallback for malformed sections.
- **AI extraction:** Gemini API via Google's official JS SDK (`@google/genai`), using **structured output with a
  JSON schema** and low temperature. Model name comes from env var `GEMINI_MODEL` — never hardcode it.
- **Shopify:** Admin GraphQL API only (no REST). Pin the API version in one config place. Key operations:
  look up blog by handle, `articleCreate`, `articleUpdate`, read `metafieldDefinitions` for owner type ARTICLE,
  look up products by handle.
- **Email:** Resend (or another transactional provider if Abbir chooses). Wrap it behind one `sendEmail()` module
  so the provider can be swapped.
- **Hosting:** Render / Railway / Fly (to be decided). Must support a long-running web process + worker.
- **Developer machine:** Windows. Give Windows-compatible commands (PowerShell), and note any differences.

---

## 4. Reference docs (read before working on related code)

- `docs/shopify-article-metafields.md` — authoritative metafield keys, types and value formats
- `docs/content-types/inspired-article.md` — Inspired spec (field map, parsing rules, validation)
- `docs/content-types/inspired-article-rules.md` — original Claude Project instructions (source of truth for rules)
- `docs/content-types/press-article.md` — Press spec
- `docs/samples/` — real input brief and finished output examples

---

## 4b. Core domain model (starting point — refine in Phase 0/2)

- **ContentType** — one per kind of blog (Inspired Article, Press, …).
  - name, blogHandle, templateSuffix, defaultAuthor
  - inputKind: `google_doc` (one doc per item, e.g. Inspired) | `sheet_rows` (one row per item, e.g. Press) | `form`
  - fieldMap: list of fields → for each: label, target (`title` | `body` | `summary` | `tags` | `author` |
    `handle` | `image` | `metafield`), metafield namespace/key/type, required (bool), extraction hint
  - extraction instructions for Gemini specific to this type (e.g. how FORMAT tags map to HTML)
  - Seeded from JSON files in `/config/content-types/`, editable later in Settings.
- **QueueItem** — one Google Doc in the bucket.
  - docUrl, docId, contentTypeId, position (order), priority (normal/urgent)
  - status (see below), lastError, missingFields[]
  - extractedPayload (JSON), sourceSnapshotHash (to detect doc changes)
  - scheduledFor, shopifyArticleId, shopifyAdminUrl, createdBy, timestamps
- **Schedule** — rules such as "N per day, these weekdays, between these hours, this timezone", plus mode
  (create as draft / create with future publish date / publish immediately). Pausable.
- **NotificationRule** — event type → list of email recipients.
- **ActivityLog** — every action and error per item, for the History page.

**Queue item statuses:**
`Queued → Fetching → Extracting → Validating → Ready | NeedsInput | Failed → Scheduled → Created (draft) | Published`

---

## 5. Features (target scope)

1. **Bucket** — add single or bulk Google Doc links (or a sheet whose rows become items, or a form entry,
   depending on the content type), choose content type, drag to reorder, pause/remove, see status badges.
2. **Processing pipeline** — fetch → extract (Gemini) → verbatim check → template mapping → validation against
   Shopify metafield definitions → product handle checks.
3. **Review / Needs input** — side-by-side view: extracted fields vs. source doc. Missing/invalid fields
   highlighted. User can fill gaps manually in the app or fix the doc and click "Re-check".
4. **Preview** — rendered preview of the article before it goes to Shopify.
5. **Scheduling** — rules + calendar view of what goes out when; per-item date override.
6. **Urgent** — "Process now" skips the queue; optional "publish now" with a confirmation step.
   Still must pass validation.
7. **Shopify push** — create/update article with all metafields atomically; tag drafts that needed manual input
   (e.g. `auto:needs-review`) so they are visible in Shopify admin too.
8. **Product picker** (shared) — search Shopify products by name/URL, show thumbnails, user confirms. Used for
   Inspired product-card links and Press `Article_Featured_product`. Always stores product GIDs.
9. **Email alerts** — needs input, failed, schedule summary (e.g. daily digest of what's coming), published
   confirmations. Recipients configurable per event.
10. **History** — log of everything created, with links to Shopify admin and errors.
11. **Settings** — content types/templates, schedule defaults, email recipients, connection tests
    (Shopify, Google, Gemini, email).

---

## 6. Build phases

Work one phase at a time. Do not start the next phase until Abbir confirms the current one works.

- **Phase 0 — Specs.** Collect content-type templates, sample Google Docs, metafield definitions. Write them into
  `/docs/` and `/config/content-types/`. No app code yet.
- **Phase 1 — Scaffold.** Shopify CLI app, Prisma + Postgres, `.env.example`, connection tests for Shopify,
  Google, Gemini, email.
- **Phase 2 — Templates + doc reading.** ContentType config loading; fetch a Google Doc and convert it to clean
  text/HTML (headings, lists, links, bold preserved).
- **Phase 3 — Extraction + validation.** Gemini structured extraction per content type, verbatim check,
  validation against Shopify metafield definitions. Run from a test script first.
- **Phase 4 — Shopify push.** Create/update draft articles on the dev store with all metafields.
- **Phase 5 — Bucket UI + Review page.**
- **Phase 6 — Scheduler + Urgent.**
- **Phase 7 — Email notifications.**
- **Phase 8 — History, Settings, polish.**
- **Phase 9 — Deployment + switch to live store.**

---

## 7. Working style with Abbir (important)

- Abbir is building his fundamentals and wants to **learn while building**, not just receive finished code.
  Treat React/JS concepts at a beginner-friendly level and briefly explain *why*, not just *what*.
- **Default mode: step-by-step guidance.** For coding tasks, tell Abbir which file to create or open, what code
  to add, and why — so he can write/paste it himself. Only create or edit files directly when he says so
  (e.g. "go ahead and write it").
- **Plan before code.** At the start of each phase, present a short plan and wait for approval.
- Keep steps small and testable. After each step, say how to verify it worked.
- Ask before adding any new dependency, and explain what it is for.
- Never guess metafield keys, types, or template fields — ask or read them from `/config` and `/docs`.

---

## 8. Decisions log

Record each decision with date and reason.

- 2026-10-12 — Build a standalone embedded Shopify app (chosen over Claude + n8n) so marketing gets a visual tool.
- 2026-10-12 — Input source is Google Docs (one doc per blog). Gemini used for extraction only.
- 2026-10-12 — Articles created as drafts by default; publishing only via explicit schedule/urgent settings.
- 2026-10-12 — Deterministic parsing for most fields; Gemini only for judgement calls, always verbatim-checked.
- 2026-10-12 — Validation has two levels: BLOCK (item cannot be created) and ADVISE (draft created, checklist warning).
- 2026-10-12 — Press uses sheet rows or an in-app form instead of one Google Doc per mention (to confirm with marketing).
- 2026-10-12 — Metafield types confirmed from Shopify admin; see docs/shopify-article-metafields.md (rule 7).

---

## 9. Open questions (resolve in Phase 0)

- See the "Open questions" section at the end of each content-type spec.
- Exact metafield keys marked TBC in docs/shopify-article-metafields.md (confirm with the definitions dump).
- Any further content types beyond Inspired and Press.
- URL handle and SEO title/description: from the doc or auto-generated from the title?
- Should urgent items be allowed to publish immediately, or only create a draft immediately?
- Email provider and sender domain.
- Hosting provider.

---

## 10. Current status

- Phase 0 in progress: Inspired and Press specs, metafield reference and samples written; open questions pending.
