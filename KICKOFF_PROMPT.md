Paste everything below the line into Claude Code (in VS Code), from inside the new project folder
that already contains CLAUDE.md.

---

We are starting a new project: the **TOV Blog Automator**, an embedded Shopify app that automates creating
blog posts for TOV Furniture from Google Docs.

First, read `CLAUDE.md` in the project root completely. It is the permanent memory for this project:
what we are building, the non-negotiable rules, the tech stack, the data model, the feature list,
the build phases, and how I want you to work with me. Follow it in every session.

Today we are only doing **Phase 0 — Specs**. Do not write any app code or scaffold anything yet.

Please do the following, in order:

1. Summarise back to me, in your own words and in under 15 lines, what the app does and the non-negotiable
   rules — so I can confirm you understood.
2. Point out anything in CLAUDE.md that is unclear, contradictory, or risky, and suggest improvements.
3. Read every file in `/docs` (metafield reference, content-type specs, original rules, samples).
   Tell me if anything is missing, inconsistent between files, or contradicts CLAUDE.md.
   Then create an empty `/config/content-types/` folder.
4. Propose a JSON schema for a content-type config file (blog handle, template suffix, field map,
   metafields with namespace/key/type/required, extraction hints). Show me one filled-in example using
   placeholder values, and explain each part.
5. Give me a checklist of everything you need from me to finish Phase 0 (templates, metafield definitions,
   sample docs, etc.), grouped by content type.

Then stop and wait for me. I will provide the templates and samples one content type at a time.

Remember: guide me step by step and explain why — I want to understand what we build. Only create or edit
files directly when I say so (I am saying so for creating the /config/content-types/ folder in step 3).
