import { getConfig, loadEnv } from "../config/env.js";
import { METAFIELDS, NAMESPACE } from "../config/metafields.js";
import { shopifyGraphql, type UserError } from "../shopify/client.js";
import { getMetafieldDefinitions } from "../shopify/definitions.js";

/**
 * `npm run setup:dev` — prepares a DEV store (§11.1 step 3): blogs `inspired` + `press` and the §8 article
 * metafield definitions. Idempotent: anything that already exists is skipped. Test env only.
 */

/** Admin names as they appear on the live store (Settings → Custom data → Blog posts). */
const ADMIN_NAMES: Record<string, string> = {
  homepage_display_tag: "homepage display tag",
  reading_time: "reading time",
  article_author: "article author",
  quick_scoop_content: "quick scoop content",
  sidebar_cta_title: "sidebar cta title",
  sidebar_cta_text: "sidebar cta text",
  sidebar_cta_button_text: "sidebar cta button text",
  sidebar_button_link: "sidebar button link",
  article_toc_title: "article toc title",
  custom_content_with_badge: "Type 2 custom content1",
  custom_content_with_badge2: "Type 2 custom content2",
  faqs: "FAQS",
  cta_title_1: "cta title 1",
  cta_text_1: "cta text 1",
  cta_button_label_1: "cta button label 1",
  cta_button_link_1: "cta button link 1",
  blogtagline: "blogtagline",
  Article_Featured_product: "Article Featured product",
  featured: "featured",
  customurl: "customurl",
  customlink_text: "customlink_text",
  Add_Schema_Mentions: "Add Schema Mentions",
  // Not written by the tool, but exists on the live store so reviewers can set it in admin.
  Featured_Blog: "Featured Blog",
};

const BLOGS = [
  { handle: "inspired", title: "Inspired" },
  { handle: "press", title: "Press" },
];

loadEnv();
const cfg = getConfig();
if (cfg.env !== "test") {
  console.error("MCP_ENV is not test — setup:dev only runs against a dev store. Refusing.");
  process.exit(1);
}
console.log(`Setting up ${cfg.storeDomain}\n`);

// ---- blogs ----
const existing = await shopifyGraphql<{ blogs: { nodes: { handle: string }[] } }>(`{ blogs(first: 50) { nodes { handle } } }`);
const have = new Set(existing.blogs.nodes.map((b) => b.handle));
for (const b of BLOGS) {
  if (have.has(b.handle)) {
    console.log(`skip   blog ${b.handle} (exists)`);
    continue;
  }
  const r = await shopifyGraphql<{ blogCreate: { blog: { handle: string } | null; userErrors: UserError[] } }>(
    `mutation BlogCreate($blog: BlogCreateInput!) { blogCreate(blog: $blog) { blog { id handle } userErrors { field message code } } }`,
    { blog: b },
  );
  const errs = r.blogCreate.userErrors;
  console.log(errs.length ? `FAIL   blog ${b.handle}: ${errs.map((e) => e.message).join("; ")}` : `create blog ${r.blogCreate.blog!.handle}`);
}

// ---- metafield definitions ----
const defs = new Map((await getMetafieldDefinitions(true)).filter((d) => d.namespace === NAMESPACE).map((d) => [d.key, d.type]));
const wanted: [string, string][] = [...Object.entries(METAFIELDS).map(([k, s]) => [k, s.type] as [string, string]), ["Featured_Blog", "boolean"]];
let failed = 0;
for (const [key, type] of wanted) {
  const live = defs.get(key);
  if (live) {
    console.log(live === type ? `skip   ${key} (exists)` : `WARN   ${key} exists as ${live}, §8 says ${type} — fix by hand`);
    continue;
  }
  const r = await shopifyGraphql<{ metafieldDefinitionCreate: { createdDefinition: { key: string } | null; userErrors: UserError[] } }>(
    `mutation DefCreate($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { createdDefinition { id key type { name } } userErrors { field message code } } }`,
    { definition: { name: ADMIN_NAMES[key] ?? key, namespace: NAMESPACE, key, type, ownerType: "ARTICLE" } },
  );
  const errs = r.metafieldDefinitionCreate.userErrors;
  if (errs.length) failed++;
  console.log(errs.length ? `FAIL   ${key}: ${errs.map((e) => e.message).join("; ")}` : `create ${key} (${type})`);
}

console.log(failed ? `\n${failed} definition(s) failed.` : "\nDone.");
process.exit(failed ? 1 : 0);
