#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { CONTENT_TYPES } from "./config/contentTypes.js";
import { getConfig, loadEnv, ToolError } from "./config/env.js";
import { fetchGoogleDoc } from "./google/docs.js";
import { uploadImage } from "./images.js";
import { parseBrief } from "./parse/index.js";
import {
  createArticleDraft,
  deleteTestArticle,
  findArticleBySource,
  getArticle,
  toPayloadView,
  updateArticleDraft,
} from "./shopify/articles.js";
import { adminUrl } from "./shopify/client.js";
import { getMetafieldDefinitions } from "./shopify/definitions.js";
import { findProducts } from "./shopify/products.js";
import { validatePayload } from "./validate/payload.js";
import { PayloadSchema } from "./validate/schema.js";

/**
 * tov-shopify MCP server (§5). Deliberately has NO publish tool, NO generic delete, NO generic GraphQL tool.
 * Every write goes through the same validator and server-side enforcement.
 */

loadEnv();
const cfg = getConfig();

const server = new McpServer(
  { name: "tov-shopify", version: "0.1.0" },
  {
    instructions:
      "Creates TOV blog articles as Shopify DRAFTS from Google Doc briefs. Drafts only; never invent text; " +
      "only blogs inspired/press; Featured_Blog is never written. Flow: fetch_google_doc → parse_brief → " +
      "find_products → upload_image → validate_payload → find_article_by_source → create/update_article_draft → get_article (read-back).",
  },
);

type Json = Record<string, unknown> | unknown[];

/** Wraps a handler: JSON text result on success, structured {error, code, details} with isError on failure. */
function run<A>(fn: (args: A) => Promise<Json>) {
  return async (args: A) => {
    try {
      const result = await fn(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const e = err instanceof ToolError ? err : new ToolError("SHOPIFY_ERROR", (err as Error).message ?? String(err));
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify({ error: e.message, code: e.code, details: e.details }, null, 2) }],
      };
    }
  };
}

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;
const sourceTextArg = z
  .string()
  .describe("The doc's sourceText from fetch_google_doc (01-source.json rawText). Every text value must be found in it.");

// ---------------------------------------------------------------- Google

server.registerTool(
  "fetch_google_doc",
  {
    title: "Fetch Google Doc",
    description:
      "Reads a Google Doc with the service account. Returns plain text with paragraph boundaries, detected content type, " +
      "and inline images (already downloaded to runs/_images — pass `filePath` to upload_image; contentUri expires). " +
      "DOC_ACCESS error → BLOCK with 'share the doc with <service-account-email>'.",
    inputSchema: { docUrlOrId: z.string().describe("Google Doc URL or document id") },
    annotations: readOnly,
  },
  run(async ({ docUrlOrId }: { docUrlOrId: string }) => ({ ...(await fetchGoogleDoc(docUrlOrId)) })),
);

server.registerTool(
  "parse_brief",
  {
    title: "Parse brief (deterministic)",
    description:
      "Deterministic parser (no AI) for §7 mechanics. Returns a partial payload, productCards to resolve, featuredImage, " +
      "`missing` (required labels absent → BLOCK), `decisions` made, and `unparsed` judgement calls for the Extractor.",
    inputSchema: {
      contentType: z.enum(CONTENT_TYPES),
      text: z.string().describe("fetch_google_doc `text`"),
      images: z
        .array(
          z.object({
            afterLineIndex: z.number().int(),
            url: z.string().optional().describe("Shopify CDN URL from upload_image"),
            alt: z.string().optional(),
            role: z.enum(["featured", "inline"]).optional(),
          }),
        )
        .optional()
        .describe("Uploaded inline images to place in the body (Inspired only)"),
      links: z
        .record(z.string(), z.string())
        .optional()
        .describe("Hyperlinks from fetch_google_doc — key=normalised link text, value=URL. Used to auto-resolve product URLs from doc hyperlinks."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  run(async ({ contentType, text, images, links }: { contentType: "inspired" | "press"; text: string; images?: { afterLineIndex: number; url?: string; alt?: string; role?: "featured" | "inline" }[]; links?: Record<string, string> }) => ({
    ...parseBrief(contentType, text, images, links),
  })),
);

// ---------------------------------------------------------------- Shopify read

server.registerTool(
  "get_metafield_definitions",
  {
    title: "Article metafield definitions",
    description: "Live ARTICLE metafield definitions from the store (cached 10 min). Live definitions win over §8 — report any mismatch.",
    inputSchema: { refresh: z.boolean().optional().describe("Bypass the 10-minute cache") },
    annotations: readOnly,
  },
  run(async ({ refresh }: { refresh?: boolean }) => getMetafieldDefinitions(refresh ?? false)),
);

server.registerTool(
  "find_products",
  {
    title: "Find products",
    description:
      "Read-only product search. With `handle` (or a PDP URL) returns only the exact handle match. With `query` returns up to `limit` " +
      "results; `containsAllSignificantWords` marks titles containing every significant word of the query (auto-accept rule §4.3).",
    inputSchema: {
      handle: z.string().optional().describe("Product handle or a /products/<handle> URL"),
      query: z.string().optional().describe("Product name from the doc"),
      limit: z.number().int().min(1).max(10).optional(),
    },
    annotations: readOnly,
  },
  run(async (args: { handle?: string; query?: string; limit?: number }) => findProducts(args)),
);

server.registerTool(
  "find_article_by_source",
  {
    title: "Find article by source doc",
    description: "Finds the article tagged src:<docId> in the given blog. Returns { articleId, isPublished, adminUrl } or null.",
    inputSchema: { blogHandle: z.enum(["inspired", "press"]), docId: z.string().min(1) },
    annotations: readOnly,
  },
  run(async ({ blogHandle, docId }: { blogHandle: string; docId: string }) => ({ result: await findArticleBySource(blogHandle, docId) })),
);

server.registerTool(
  "get_article",
  {
    title: "Get article",
    description: "Full article + custom metafields. `payloadView` is in §6 payload shape (metafield values parsed) for read-back comparison.",
    inputSchema: { articleId: z.string().describe("Article GID, numeric id, or admin URL") },
    annotations: readOnly,
  },
  run(async ({ articleId }: { articleId: string }) => {
    const a = await getArticle(articleId);
    return { article: a, payloadView: toPayloadView(a), adminUrl: adminUrl("articles", a.id) };
  }),
);

// ---------------------------------------------------------------- Validation

server.registerTool(
  "validate_payload",
  {
    title: "Validate payload",
    description:
      "The same validator create/update run internally: shape, required fields, allowlist, metafield types (against live definitions), " +
      "verbatim check, placeholders, TOC ↔ h2, card JSON, single-line fields. Returns { ok, errors[], advisories[], metafields }.",
    inputSchema: {
      payload: PayloadSchema.describe("§6 payload (05-payload.json)"),
      sourceText: sourceTextArg,
      useLiveDefinitions: z.boolean().optional().describe("Check types against the store's definitions (default true)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  run(async ({ payload, sourceText, useLiveDefinitions }: { payload: unknown; sourceText: string; useLiveDefinitions?: boolean }) => {
    const defs = useLiveDefinitions === false ? undefined : await getMetafieldDefinitions();
    const v = validatePayload(payload, sourceText, defs);
    return { ok: v.ok, errors: v.errors, advisories: v.advisories, metafields: v.metafieldInputs };
  }),
);

// ---------------------------------------------------------------- Writes (Draft Writer / Media only)

server.registerTool(
  "upload_image",
  {
    title: "Upload image to Shopify Files",
    description:
      "Uploads one image (staged upload → fileCreate → wait until READY) and returns its Shopify CDN url. Give exactly one source. " +
      "Never invent alt text — pass only alt text from the doc.",
    inputSchema: {
      source: z
        .object({
          url: z.string().optional().describe("Public image URL or a Google Drive link"),
          contentUri: z.string().optional().describe("Google Docs contentUri (expires ~30 min)"),
          driveFileId: z.string().optional(),
          filePath: z.string().optional().describe("File downloaded by fetch_google_doc (inside runs/)"),
        })
        .refine((s) => [s.url, s.contentUri, s.driveFileId, s.filePath].filter(Boolean).length === 1, "Give exactly one source"),
      alt: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  run(async ({ source, alt }: { source: { url?: string; contentUri?: string; driveFileId?: string; filePath?: string }; alt?: string }) => ({
    ...(await uploadImage(source, alt)),
  })),
);

server.registerTool(
  "create_article_draft",
  {
    title: "Create article draft",
    description:
      "Creates the article as a DRAFT. Re-validates; forces isPublished:false, blog and template suffix from contentType, adds tag src:<docId>. " +
      "Refuses if a draft for this doc already exists (use update_article_draft). DRY_RUN=true returns the GraphQL variables instead.",
    inputSchema: { payload: PayloadSchema, sourceText: sourceTextArg },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  run(async ({ payload, sourceText }: { payload: unknown; sourceText: string }) => ({ ...(await createArticleDraft(payload, sourceText)) })),
);

server.registerTool(
  "update_article_draft",
  {
    title: "Update article draft",
    description:
      "Updates an existing DRAFT created from the same doc (tag src:<docId>). Refuses if the article is published. " +
      "Same validation and enforcement as create.",
    inputSchema: { articleId: z.string(), payload: PayloadSchema, sourceText: sourceTextArg },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  run(async ({ articleId, payload, sourceText }: { articleId: string; payload: unknown; sourceText: string }) => ({
    ...(await updateArticleDraft(articleId, payload, sourceText)),
  })),
);

if (cfg.env === "test") {
  server.registerTool(
    "delete_test_article",
    {
      title: "Delete test article (test env only)",
      description: "Deletes a DRAFT tagged mcp-test. Only exists when MCP_ENV=test.",
      inputSchema: { articleId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    run(async ({ articleId }: { articleId: string }) => deleteTestArticle(articleId)),
  );
}


// ---------------------------------------------------------------- Transport

if (cfg.httpPort) {
  // ---------- Streamable HTTP (Claude.ai custom connector) ----------
  // Auth mode is determined by env vars:
  //   OAuth mode:   OAUTH_BASE_URL + OAUTH_TOKEN_SECRET set → full OAuth 2.0 with SQLite
  //   API key mode: ALLOWED_API_KEYS set → legacy bearer token (Kiro/local)
  // Both modes can coexist: OAuth takes precedence for MCP traffic;
  // API keys still work as a fallback for Kiro and local testing.

  // Initialise OAuth server if configured
  let oauthServer: import("./oauth/server.js").OAuthServer | null = null;
  if (cfg.oauth) {
    const { OAuthDb } = await import("./oauth/db.js");
    const { OAuthServer } = await import("./oauth/server.js");
    const db = await OAuthDb.open(cfg.oauth.dbPath);
    oauthServer = new OAuthServer(db, cfg.oauth);
    console.error(`tov-shopify OAuth server ready (db=${cfg.oauth.dbPath})`);
  }

  function authenticate(req: IncomingMessage, res: ServerResponse): boolean {
    const authHeader = req.headers["authorization"] ?? "";

    // --- OAuth JWT path ---
    if (oauthServer) {
      const identity = oauthServer.validateBearerToken(authHeader);
      if (identity) return true;

      // No valid JWT — return proper OAuth 401 so Claude knows to start auth flow
      const prm = cfg.oauth
        ? `${cfg.oauth.baseUrl}/.well-known/oauth-protected-resource`
        : "";
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${prm}"`,
      });
      res.end(JSON.stringify({ error: "Unauthorized — sign in via OAuth", code: "AUTH_DENIED" }));
      return false;
    }

    // --- Legacy API key path (Kiro / local) ---
    if (cfg.allowedApiKeys.size === 0) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Server misconfigured: no auth method configured", code: "CONFIG" }));
      return false;
    }
    const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const urlToken = new URL(req.url ?? "", "http://localhost").searchParams.get("key") ?? "";
    const token = headerToken || urlToken;
    if (!token || !cfg.allowedApiKeys.has(token)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="tov-shopify"' });
      res.end(JSON.stringify({ error: "Unauthorized — provide a valid API key", code: "AUTH_DENIED" }));
      return false;
    }
    return true;
  }

  const httpServer = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "", "http://localhost").pathname;

    // Health check — unauthenticated
    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: "tov-shopify", env: cfg.env, auth: oauthServer ? "oauth" : "apikey" }));
      return;
    }

    // OAuth endpoints (discovery + login + token) — handled before auth check
    if (oauthServer) {
      const handled = await oauthServer.handle(req, res);
      if (handled) return;
    }

    // MCP endpoint
    if (pathname === "/mcp") {
      if (!authenticate(req, res)) return;
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(cfg.httpPort, () => {
    console.error(
      `tov-shopify HTTP server ready on port ${cfg.httpPort} (store=${cfg.storeDomain}, env=${cfg.env}, dryRun=${cfg.dryRun}, auth=${oauthServer ? "oauth" : "apikey"})`,
    );
  });
} else {
  // ---------- stdio (Kiro / local MCP inspector) ----------
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `tov-shopify MCP server ready (store=${cfg.storeDomain || "unset"}, env=${cfg.env}, dryRun=${cfg.dryRun}, api=${cfg.apiVersion})`,
  );
}
