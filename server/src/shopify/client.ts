import { assertStoreAllowed, getConfig, ToolError } from "../config/env.js";

/** §5 Shopify API details: Admin GraphQL only, pinned version, backoff on THROTTLED/5xx, stop on auth errors. */

const BACKOFF_MS = [500, 1000, 2000, 4000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(forceRefresh = false): Promise<string> {
  const cfg = getConfig();
  if (cfg.adminToken) return cfg.adminToken;
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new ToolError("CONFIG", "Set SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET in .env");
  }
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const res = await fetch(`https://${cfg.storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new ToolError("AUTH", `Shopify token request failed (${res.status}). Check client id/secret and app install. Stop the batch.`);
  }
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  const ttl = (body.expires_in ?? 3600) * 1000;
  cachedToken = { token: body.access_token, expiresAt: Date.now() + ttl - 60_000 };
  return body.access_token;
}

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
    };
  };
}

/** Wait proactively when the leaky bucket is nearly empty. */
let lastThrottle: { available: number; restoreRate: number } | null = null;
async function respectBucket(estimatedCost = 100) {
  if (!lastThrottle || lastThrottle.available >= estimatedCost) return;
  const deficit = estimatedCost - lastThrottle.available;
  await sleep(Math.ceil((deficit / Math.max(lastThrottle.restoreRate, 1)) * 1000));
}

export async function shopifyGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const cfg = getConfig();
  assertStoreAllowed(cfg);
  const url = `https://${cfg.storeDomain}/admin/api/${cfg.apiVersion}/graphql.json`;

  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    await respectBucket();
    const token = await getToken();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      throw new ToolError("SHOPIFY_ERROR", `Network error talking to Shopify: ${(err as Error).message}`);
    }

    if (res.status === 401 || res.status === 403) {
      // A client-credentials token may have expired early: refresh once before giving up.
      if (!cfg.adminToken && !refreshed) {
        refreshed = true;
        cachedToken = null;
        await getToken(true);
        continue;
      }
      throw new ToolError("AUTH", `Shopify returned ${res.status} — token/scopes problem. Stop the whole batch.`);
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      throw new ToolError("THROTTLED", `Shopify ${res.status} after ${BACKOFF_MS.length} retries`);
    }
    if (!res.ok) {
      throw new ToolError("SHOPIFY_ERROR", `Shopify HTTP ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as GqlResponse<T>;
    const ts = body.extensions?.cost?.throttleStatus;
    if (ts) lastThrottle = { available: ts.currentlyAvailable, restoreRate: ts.restoreRate };

    if (body.errors?.length) {
      const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      const accessDenied = body.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
      throw new ToolError(
        throttled ? "THROTTLED" : accessDenied ? "AUTH" : "SHOPIFY_ERROR",
        body.errors.map((e) => e.message).join("; "),
      );
    }
    if (!body.data) throw new ToolError("SHOPIFY_ERROR", "Shopify returned no data");
    return body.data;
  }
}

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

/** "gid://shopify/Article/123" → "123" */
export const numericId = (gid: string) => gid.split("/").pop() ?? gid;

export function adminUrl(resource: "articles" | "products", gid: string): string {
  const store = getConfig().storeDomain.replace(/\.myshopify\.com$/, "");
  const path = resource === "articles" ? "content/articles" : "products";
  return `https://admin.shopify.com/store/${store}/${path}/${numericId(gid)}`;
}
