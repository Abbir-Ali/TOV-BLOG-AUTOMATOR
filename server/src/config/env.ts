import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Project root = nearest folder above this file that contains package.json (works from dist/ and from src/). */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
  return dir;
}

export const PROJECT_ROOT = findRoot();

let loaded = false;
/** Loads .env from the project root once (Node's built-in loader; real env vars win). */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = resolve(PROJECT_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export interface Config {
  storeDomain: string;
  allowedStores: string[];
  apiVersion: string;
  clientId?: string;
  clientSecret?: string;
  adminToken?: string;
  publicStoreUrl: string;
  googleCredentials: string;
  env: "test" | "prod";
  dryRun: boolean;
  /** Streamable HTTP transport — undefined means stdio only */
  httpPort?: number;
  /** Comma-separated bearer tokens. Empty = HTTP auth disabled (stdio only). */
  allowedApiKeys: Set<string>;
}

const clean = (v: string | undefined) => (v ?? "").trim() || undefined;

export function getConfig(): Config {
  loadEnv();
  const e = process.env;
  const creds = clean(e.GOOGLE_APPLICATION_CREDENTIALS) ?? "./secrets/service-account.json";
  const rawPort = clean(e.HTTP_PORT);
  const httpPort = rawPort ? parseInt(rawPort, 10) : undefined;
  const allowedApiKeys = new Set(
    (e.ALLOWED_API_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
  return {
    storeDomain: (clean(e.SHOPIFY_STORE_DOMAIN) ?? "").toLowerCase(),
    allowedStores: (e.ALLOWED_STORES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    apiVersion: clean(e.SHOPIFY_API_VERSION) ?? "2026-10",
    clientId: clean(e.SHOPIFY_CLIENT_ID),
    clientSecret: clean(e.SHOPIFY_CLIENT_SECRET),
    adminToken: clean(e.SHOPIFY_ADMIN_TOKEN),
    publicStoreUrl: (clean(e.PUBLIC_STORE_URL) ?? "https://tovfurniture.com").replace(/\/+$/, ""),
    googleCredentials: isAbsolute(creds) ? creds : resolve(PROJECT_ROOT, creds),
    env: clean(e.MCP_ENV) === "prod" ? "prod" : "test",
    dryRun: clean(e.DRY_RUN)?.toLowerCase() === "true",
    httpPort,
    allowedApiKeys,
  };
}

/** Rule 7 — store guard. Throws unless SHOPIFY_STORE_DOMAIN is in ALLOWED_STORES. */
export function assertStoreAllowed(cfg: Config = getConfig()): void {
  if (!cfg.storeDomain) throw new ToolError("STORE_GUARD", "SHOPIFY_STORE_DOMAIN is not set in .env");
  if (!cfg.allowedStores.includes(cfg.storeDomain)) {
    throw new ToolError(
      "STORE_GUARD",
      `Store ${cfg.storeDomain} is not in ALLOWED_STORES (${cfg.allowedStores.join(", ") || "empty"}). Refusing.`,
    );
  }
}

export type ErrorCode =
  | "STORE_GUARD"
  | "AUTH"
  | "AUTH_DENIED"
  | "THROTTLED"
  | "SHOPIFY_ERROR"
  | "USER_ERRORS"
  | "VALIDATION"
  | "PUBLISHED"
  | "NOT_FOUND"
  | "NOT_ALLOWED"
  | "DOC_ACCESS"
  | "IMAGE"
  | "CONFIG";

/** Error with a stable code the agents can branch on (see §9). */
export class ToolError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
