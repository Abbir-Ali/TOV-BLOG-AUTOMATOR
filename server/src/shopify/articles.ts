import { AUTHOR_FALLBACK, BLOG_HANDLE, TEMPLATE_SUFFIX, type ContentType } from "../config/contentTypes.js";
import { assertStoreAllowed, getConfig, ToolError } from "../config/env.js";
import { NAMESPACE } from "../config/metafields.js";
import { parseStoredValue } from "../validate/metafields.js";
import { validatePayload, type ValidationResult } from "../validate/payload.js";
import { adminUrl, shopifyGraphql, type UserError } from "./client.js";
import { getMetafieldDefinitions } from "./definitions.js";

/** §5 article tools with all server-side enforcement (rules 1–9). */

export const TEST_TAG = "mcp-test";
export const sourceTag = (docId: string) => `src:${docId}`;

const ARTICLE_FIELDS = /* GraphQL */ `
  id
  title
  handle
  body
  summary
  tags
  templateSuffix
  isPublished
  publishedAt
  updatedAt
  author { name }
  image { url altText }
  blog { id handle title }
  metafields(first: 50, namespace: "${NAMESPACE}") { nodes { namespace key type value } }
`;

export interface StoredArticle {
  id: string;
  title: string;
  handle: string;
  body: string;
  summary: string | null;
  tags: string[];
  templateSuffix: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
  author: { name: string } | null;
  image: { url: string; altText: string | null } | null;
  blog: { id: string; handle: string; title: string };
  metafields: { nodes: { namespace: string; key: string; type: string; value: string }[] };
}

// ---------- blogs ----------

const blogIdCache = new Map<string, string>();

export async function getBlogId(handle: string): Promise<string> {
  if (!Object.values(BLOG_HANDLE).includes(handle)) throw new ToolError("NOT_ALLOWED", `Blog "${handle}" is not allowed (only inspired, press)`);
  const cached = blogIdCache.get(handle);
  if (cached) return cached;
  const data = await shopifyGraphql<{ blogs: { nodes: { id: string; handle: string }[] } }>(
    `query Blog($q: String!) { blogs(first: 5, query: $q) { nodes { id handle } } }`,
    { q: `handle:${handle}` },
  );
  const blog = data.blogs.nodes.find((b) => b.handle === handle);
  if (!blog) throw new ToolError("NOT_FOUND", `Blog with handle "${handle}" does not exist on ${getConfig().storeDomain}`);
  blogIdCache.set(handle, blog.id);
  return blog.id;
}

// ---------- read ----------

export async function getArticle(articleId: string): Promise<StoredArticle> {
  const data = await shopifyGraphql<{ article: StoredArticle | null }>(
    `query Article($id: ID!) { article(id: $id) { ${ARTICLE_FIELDS} } }`,
    { id: toArticleGid(articleId) },
  );
  if (!data.article) throw new ToolError("NOT_FOUND", `Article ${articleId} not found`);
  return data.article;
}

/** Stored article in §6 payload shape, so the Draft Writer can compare field by field. */
export function toPayloadView(a: StoredArticle) {
  const metafields: Record<string, unknown> = {};
  for (const m of a.metafields.nodes) metafields[m.key] = parseStoredValue(m.type, m.value);
  return {
    contentType: (a.blog.handle === "press" ? "press" : "inspired") as ContentType,
    article: {
      title: a.title,
      bodyHtml: a.body,
      summary: a.summary ?? "",
      tags: a.tags,
      authorName: a.author?.name ?? "",
      image: a.image ? { url: a.image.url, altText: a.image.altText ?? "" } : null,
    },
    templateSuffix: a.templateSuffix,
    isPublished: a.isPublished,
    metafields,
    metafieldTypes: Object.fromEntries(a.metafields.nodes.map((m) => [m.key, m.type])),
  };
}

export async function findArticleBySource(blogHandle: string, docId: string): Promise<{ articleId: string; isPublished: boolean; adminUrl: string } | null> {
  await getBlogId(blogHandle); // allowlist + existence
  const tag = sourceTag(docId);
  const data = await shopifyGraphql<{ articles: { nodes: { id: string; tags: string[]; isPublished: boolean; blog: { handle: string } }[] } }>(
    `query BySource($q: String!) { articles(first: 20, query: $q) { nodes { id tags isPublished blog { handle } } } }`,
    { q: `tag:'${tag.replace(/'/g, "\\'")}'` },
  );
  // The search index is fuzzy on punctuation — confirm the exact tag and blog ourselves.
  const hit = data.articles.nodes.find((n) => n.tags.includes(tag) && n.blog.handle === blogHandle);
  return hit ? { articleId: hit.id, isPublished: hit.isPublished, adminUrl: adminUrl("articles", hit.id) } : null;
}

// ---------- write ----------

export interface WriteResult {
  articleId: string | null;
  adminUrl: string | null;
  action: "created" | "updated" | "dry-run";
  advisories: ValidationResult["advisories"];
  dryRunVariables?: unknown;
}

/** Steps 1–6 of §5 enforcement. Returns the ArticleCreateInput/UpdateInput fields. */
async function buildArticleInput(payload: unknown, sourceText: string) {
  const cfg = getConfig();
  assertStoreAllowed(cfg); // 1
  const defs = await getMetafieldDefinitions();
  const v = validatePayload(payload, sourceText, defs); // 4, 5, 6
  if (!v.ok || !v.payload) {
    throw new ToolError("VALIDATION", `Payload failed validation (${v.errors.length} errors) — nothing was written`, { errors: v.errors });
  }
  const p = v.payload;
  const blogId = await getBlogId(BLOG_HANDLE[p.contentType]); // 2

  const tags = new Set((p.article.tags ?? []).filter((t) => !t.startsWith("src:") && t !== TEST_TAG));
  tags.add(sourceTag(p.source.docId)); // 3 / rule 9
  if (cfg.env === "test") tags.add(TEST_TAG);

  const input: Record<string, unknown> = {
    title: p.article.title,
    body: p.article.bodyHtml,
    summary: p.article.summary ?? "",
    tags: [...tags],
    templateSuffix: TEMPLATE_SUFFIX[p.contentType], // never from the model
    isPublished: false, // rule 1 — drafts only
    author: { name: p.article.authorName?.trim() || AUTHOR_FALLBACK },
    metafields: v.metafieldInputs,
  };
  if (p.article.image?.url) input.image = { url: p.article.image.url, altText: p.article.image.altText ?? "" };
  return { input, blogId, validation: v, contentType: p.contentType, docId: p.source.docId };
}

function throwUserErrors(errs: UserError[], metafieldKeys: string[]): void {
  if (!errs.length) return;
  const mapped = errs.map((e) => {
    const path = e.field ?? [];
    const mi = path.indexOf("metafields");
    const field = mi >= 0 && path[mi + 1] !== undefined ? `metafields.${metafieldKeys[Number(path[mi + 1])] ?? path[mi + 1]}` : path.filter((x) => x !== "article").join(".");
    return { field, message: e.message, code: e.code ?? null };
  });
  throw new ToolError("USER_ERRORS", `Shopify rejected the article: ${mapped.map((m) => `${m.field}: ${m.message}`).join("; ")}`, { userErrors: mapped });
}

export async function createArticleDraft(payload: unknown, sourceText: string): Promise<WriteResult> {
  const { input, blogId, validation, contentType, docId } = await buildArticleInput(payload, sourceText);

  // Idempotency (rule 9): never create a duplicate for the same doc.
  const existing = await findArticleBySource(BLOG_HANDLE[contentType], docId);
  if (existing) {
    throw new ToolError(
      existing.isPublished ? "PUBLISHED" : "VALIDATION",
      existing.isPublished
        ? `An article for this doc is already published (${existing.adminUrl}) — edit it manually in Shopify admin`
        : `A draft for this doc already exists (${existing.articleId}) — use update_article_draft`,
      existing,
    );
  }

  const variables = { article: { ...input, blogId } };
  if (getConfig().dryRun) return { articleId: null, adminUrl: null, action: "dry-run", advisories: validation.advisories, dryRunVariables: variables };

  const data = await shopifyGraphql<{ articleCreate: { article: { id: string } | null; userErrors: UserError[] } }>(
    `mutation Create($article: ArticleCreateInput!) { articleCreate(article: $article) { article { id } userErrors { field message code } } }`,
    variables,
  );
  throwUserErrors(data.articleCreate.userErrors, validation.metafieldInputs.map((m) => m.key));
  const id = data.articleCreate.article!.id;
  return { articleId: id, adminUrl: adminUrl("articles", id), action: "created", advisories: validation.advisories };
}

export async function updateArticleDraft(articleId: string, payload: unknown, sourceText: string): Promise<WriteResult> {
  const { input, blogId, validation, docId } = await buildArticleInput(payload, sourceText);
  const id = toArticleGid(articleId);
  const current = await getArticle(id);

  // Rule 2 — never touch published articles.
  if (current.isPublished) {
    throw new ToolError("PUBLISHED", `Article ${id} is already published — edit it manually in Shopify admin`, { adminUrl: adminUrl("articles", id) });
  }
  if (current.blog.id !== blogId) {
    throw new ToolError("NOT_ALLOWED", `Article ${id} is in blog "${current.blog.handle}", not the payload's blog`);
  }
  if (!current.tags.includes(sourceTag(docId))) {
    throw new ToolError("NOT_ALLOWED", `Article ${id} has no tag ${sourceTag(docId)} — it was not created from this doc. Refusing to overwrite.`);
  }

  const variables = { id, article: input };
  if (getConfig().dryRun) return { articleId: id, adminUrl: adminUrl("articles", id), action: "dry-run", advisories: validation.advisories, dryRunVariables: variables };

  const data = await shopifyGraphql<{ articleUpdate: { article: { id: string } | null; userErrors: UserError[] } }>(
    `mutation Update($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { article { id } userErrors { field message code } } }`,
    variables,
  );
  // Metafields not in this payload are left as they are (a reviewer may have filled e.g. cta_button_link_1).
  throwUserErrors(data.articleUpdate.userErrors, validation.metafieldInputs.map((m) => m.key));
  return { articleId: id, adminUrl: adminUrl("articles", id), action: "updated", advisories: validation.advisories };
}

/** Only registered when MCP_ENV=test; only deletes drafts tagged mcp-test. */
export async function deleteTestArticle(articleId: string): Promise<{ deleted: string }> {
  if (getConfig().env !== "test") throw new ToolError("NOT_ALLOWED", "delete_test_article is only available when MCP_ENV=test");
  const a = await getArticle(articleId);
  if (!a.tags.includes(TEST_TAG)) throw new ToolError("NOT_ALLOWED", `Article ${a.id} has no ${TEST_TAG} tag — refusing to delete`);
  if (a.isPublished) throw new ToolError("PUBLISHED", `Article ${a.id} is published — refusing to delete`);
  const data = await shopifyGraphql<{ articleDelete: { deletedArticleId: string | null; userErrors: UserError[] } }>(
    `mutation Del($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { field message code } } }`,
    { id: a.id },
  );
  throwUserErrors(data.articleDelete.userErrors, []);
  return { deleted: data.articleDelete.deletedArticleId ?? a.id };
}

/** All test drafts (for `npm run test:cleanup`). */
export async function listTestArticles(): Promise<{ id: string; title: string; isPublished: boolean; tags: string[] }[]> {
  const data = await shopifyGraphql<{ articles: { nodes: { id: string; title: string; isPublished: boolean; tags: string[] }[] } }>(
    `query T($q: String!) { articles(first: 100, query: $q) { nodes { id title isPublished tags } } }`,
    { q: `tag:${TEST_TAG}` },
  );
  return data.articles.nodes.filter((n) => n.tags.includes(TEST_TAG));
}

export function toArticleGid(id: string): string {
  const s = id.trim();
  if (s.startsWith("gid://shopify/Article/")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Article/${s}`;
  const m = /\/articles\/(\d+)/.exec(s);
  if (m) return `gid://shopify/Article/${m[1]}`;
  throw new ToolError("VALIDATION", `Not an article id: ${id}`);
}
