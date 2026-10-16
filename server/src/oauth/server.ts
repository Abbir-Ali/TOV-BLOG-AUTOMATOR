import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config/env.js";
import {
  generateAuthCode,
  hashPassword,
  hashToken,
  randomB64url,
  signJwt,
  verifyJwt,
  verifyPassword,
  verifyPkce,
} from "./crypto.js";
import type { OAuthDb } from "./db.js";

/**
 * Self-contained OAuth 2.0 authorization server (RFC 6749 + PKCE RFC 7636).
 *
 * Endpoints (all served relative to cfg.oauth.baseUrl):
 *   GET  /.well-known/oauth-protected-resource      — PRM discovery
 *   GET  /.well-known/oauth-authorization-server    — AS metadata
 *   GET  /oauth/authorize                           — login form
 *   POST /oauth/authorize                           — submit credentials
 *   GET  /oauth/callback                            — (unused — kept for future IdP redirect)
 *   POST /oauth/token                               — code/refresh exchange
 *   POST /oauth/revoke                              — revoke refresh token
 *
 * The MCP endpoint itself validates the Bearer JWT — see index.ts.
 */

// ---- HTML helpers ----

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TOV Blog Tool</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#f5f5f5;display:flex;align-items:center;justify-content:center;
       min-height:100vh;margin:0}
  .card{background:#fff;border-radius:12px;padding:40px;width:100%;max-width:400px;
        box-shadow:0 2px 16px rgba(0,0,0,.08)}
  h1{font-size:1.25rem;margin:0 0 8px;color:#111}
  p{color:#555;font-size:.9rem;margin:0 0 24px}
  label{display:block;font-size:.85rem;font-weight:500;color:#333;margin-bottom:4px}
  input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;
        font-size:.95rem;margin-bottom:16px;outline:none}
  input:focus{border-color:#b75b63}
  button{width:100%;padding:11px;background:#b75b63;color:#fff;border:none;
         border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer}
  button:hover{background:#a04d55}
  .err{background:#fff0f0;border:1px solid #f5c2c2;color:#c00;border-radius:8px;
       padding:10px 14px;font-size:.88rem;margin-bottom:16px}
  .logo{text-align:center;margin-bottom:24px;font-size:.8rem;color:#999;
        letter-spacing:.05em;text-transform:uppercase}
</style>
</head><body><div class="card">${body}</div></body></html>`);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => { raw += c.toString(); });
    req.on("end", () => resolve(new URLSearchParams(raw)));
  });
}

// ---- Login form ----

function loginForm(params: URLSearchParams, error?: string): string {
  const qs = params.toString();
  return `
    <div class="logo">TOV Furniture</div>
    <h1>Sign in to Blog Tool</h1>
    <p>Use your TOV account email and password.</p>
    ${error ? `<div class="err">${error}</div>` : ""}
    <form method="POST" action="/oauth/authorize?${qs}">
      <label>Email</label>
      <input type="email" name="email" autocomplete="email" required autofocus>
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>`;
}

// ---- Main handler ----

export class OAuthServer {
  constructor(
    private db: OAuthDb,
    private cfg: NonNullable<Config["oauth"]>,
  ) {}

  /** Returns true if the request was handled by the OAuth server. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // ---- Discovery ----
    if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
      return this.protectedResourceMetadata(res);
    }
    if (method === "GET" && path === "/.well-known/oauth-authorization-server") {
      return this.authServerMetadata(res);
    }

    // ---- OAuth endpoints ----
    if (method === "GET"  && path === "/oauth/authorize") return this.authorizeGet(url, res);
    if (method === "POST" && path === "/oauth/authorize") return this.authorizePost(url, req, res);
    if (method === "POST" && path === "/oauth/token")     return this.token(req, res);
    if (method === "POST" && path === "/oauth/revoke")    return this.revoke(req, res);
    if (method === "POST" && path === "/oauth/register")  return this.register(req, res);

    return false; // not handled
  }

  // ---- Protected Resource Metadata (RFC 9728) ----
  private protectedResourceMetadata(res: ServerResponse): true {
    json(res, 200, {
      resource: `${this.cfg.baseUrl}/mcp`,
      authorization_servers: [this.cfg.baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"],
    });
    return true;
  }

  // ---- Authorization Server Metadata (RFC 8414) ----
  private authServerMetadata(res: ServerResponse): true {
    json(res, 200, {
      issuer: this.cfg.baseUrl,
      authorization_endpoint: `${this.cfg.baseUrl}/oauth/authorize`,
      token_endpoint: `${this.cfg.baseUrl}/oauth/token`,
      revocation_endpoint: `${this.cfg.baseUrl}/oauth/revoke`,
      registration_endpoint: `${this.cfg.baseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp:tools"],
      // CIMD support — tells Claude it can use its published identity as client_id
      client_id_metadata_document_supported: true,
    });
    return true;
  }

  // ---- GET /oauth/authorize — show login form ----
  private authorizeGet(url: URL, res: ServerResponse): true {
    const params = url.searchParams;
    const missing = ["client_id", "redirect_uri", "response_type", "code_challenge"].find(
      (p) => !params.get(p),
    );
    if (missing) {
      html(res, 400, `<h1>Bad request</h1><p>Missing parameter: ${missing}</p>`);
      return true;
    }
    if (params.get("response_type") !== "code") {
      html(res, 400, `<h1>Bad request</h1><p>Only response_type=code is supported.</p>`);
      return true;
    }
    if ((params.get("code_challenge_method") ?? "S256") !== "S256") {
      html(res, 400, `<h1>Bad request</h1><p>Only code_challenge_method=S256 is supported.</p>`);
      return true;
    }
    html(res, 200, loginForm(params));
    return true;
  }

  // ---- POST /oauth/authorize — verify credentials, issue code ----
  private async authorizePost(url: URL, req: IncomingMessage, res: ServerResponse): Promise<true> {
    const params = url.searchParams;
    const body = await readBody(req);
    const email    = body.get("email")?.trim().toLowerCase() ?? "";
    const password = body.get("password") ?? "";

    const redirectUri    = params.get("redirect_uri") ?? "";
    const codeChallenge  = params.get("code_challenge") ?? "";
    const state          = params.get("state") ?? "";

    // Validate redirect_uri — must be claude.ai or localhost (Claude Code)
    const allowedRedirects = [
      "https://claude.ai/api/mcp/auth_callback",
      "http://localhost",
      "http://127.0.0.1",
    ];
    const isAllowedRedirect = allowedRedirects.some((p) => redirectUri.startsWith(p));
    if (!isAllowedRedirect) {
      html(res, 400, `<h1>Bad request</h1><p>Invalid redirect_uri.</p>`);
      return true;
    }

    // Validate user
    // Check allowlist first (before hitting the DB) to avoid timing oracle
    if (this.cfg.allowedEmails.size > 0 && !this.cfg.allowedEmails.has(email)) {
      // Deliberate vague message — don't reveal whether the email is blocked or wrong password
      html(res, 200, loginForm(params, "Incorrect email or password. Try again."));
      return true;
    }
    const user = this.db.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      html(res, 200, loginForm(params, "Incorrect email or password. Try again."));
      return true;
    }
    // Issue auth code (5 minute TTL)
    const code = generateAuthCode();
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    this.db.createAuthCode(code, user.id, redirectUri, codeChallenge, expiresAt);

    // Redirect to Claude with the code
    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set("code", code);
    if (state) callbackUrl.searchParams.set("state", state);

    res.writeHead(302, { Location: callbackUrl.toString() });
    res.end();
    return true;
  }

  // ---- POST /oauth/token — exchange code or refresh token ----
  private async token(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const body = await readBody(req);
    const grantType = body.get("grant_type");

    if (grantType === "authorization_code") {
      return this.tokenFromCode(body, res);
    }
    if (grantType === "refresh_token") {
      return this.tokenFromRefresh(body, res);
    }

    json(res, 400, { error: "unsupported_grant_type" });
    return true;
  }

  private tokenFromCode(body: URLSearchParams, res: ServerResponse): true {
    const code         = body.get("code") ?? "";
    const codeVerifier = body.get("code_verifier") ?? "";
    const redirectUri  = body.get("redirect_uri") ?? "";

    const record = this.db.getAuthCode(code);
    if (!record) {
      json(res, 400, { error: "invalid_grant", error_description: "Code not found or expired." });
      return true;
    }
    if (record.redirect_uri !== redirectUri) {
      json(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch." });
      return true;
    }
    if (!verifyPkce(codeVerifier, record.code_challenge)) {
      json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed." });
      return true;
    }

    // Mark code as used (single-use)
    this.db.markAuthCodeUsed(code);

    const user = this.db.getUserById(record.user_id);
    if (!user) {
      json(res, 400, { error: "invalid_grant", error_description: "User not found." });
      return true;
    }

    return this.issueTokens(user.id, user.email, res);
  }

  private tokenFromRefresh(body: URLSearchParams, res: ServerResponse): true {
    const refreshToken = body.get("refresh_token") ?? "";
    const tokenHash = hashToken(refreshToken);

    const record = this.db.getRefreshToken(tokenHash);
    if (!record) {
      json(res, 400, { error: "invalid_grant", error_description: "Refresh token not found, expired or revoked." });
      return true;
    }

    const user = this.db.getUserById(record.user_id);
    if (!user) {
      json(res, 400, { error: "invalid_grant", error_description: "User not found or deactivated." });
      return true;
    }

    // Rotate: revoke old refresh token, issue new pair
    this.db.revokeRefreshToken(tokenHash);
    return this.issueTokens(user.id, user.email, res);
  }

  private issueTokens(userId: number, email: string, res: ServerResponse): true {
    const now = Math.floor(Date.now() / 1000);

    const accessToken = signJwt(
      { sub: String(userId), email, iat: now, exp: now + this.cfg.accessTokenTtl, type: "access" },
      this.cfg.tokenSecret,
    );

    const rawRefresh = randomB64url(32);
    const refreshHash = hashToken(rawRefresh);
    this.db.createRefreshToken(refreshHash, userId, now + this.cfg.refreshTokenTtl);

    json(res, 200, {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: this.cfg.accessTokenTtl,
      refresh_token: rawRefresh,
      scope: "mcp:tools",
    });
    return true;
  }

  // ---- POST /oauth/revoke ----
  private async revoke(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const body = await readBody(req);
    const token = body.get("token") ?? "";
    if (token) this.db.revokeRefreshToken(hashToken(token));
    // RFC 7009: always 200 regardless of whether token existed
    json(res, 200, {});
    return true;
  }

  // ---- POST /oauth/register — Dynamic Client Registration (RFC 7591) ----
  // Claude uses DCR to register itself as an OAuth client before starting the auth flow.
  // We accept any registration and return a stable client_id derived from the request.
  // Since our auth is user/password based, the client identity doesn't gatekeep anything.
  private async register(req: IncomingMessage, res: ServerResponse): Promise<true> {
    let body: Record<string, unknown> = {};
    try {
      let raw = "";
      await new Promise<void>((resolve) => {
        req.on("data", (c: Buffer) => { raw += c.toString(); });
        req.on("end", resolve);
      });
      if (raw) body = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* ignore parse errors */ }

    // Return a stable client_id. We use a fixed value since all clients
    // (Claude instances) share the same access model — per-user auth via login form.
    const clientId = "claude-mcp-client";
    const redirectUris = (body.redirect_uris as string[] | undefined) ?? [
      "https://claude.ai/api/mcp/auth_callback",
    ];

    json(res, 201, {
      client_id: clientId,
      client_secret_expires_at: 0, // public client — no secret
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp:tools",
    });
    return true;
  }

  // ---- Token validator (called by MCP endpoint) ----
  validateBearerToken(authHeader: string): { userId: number; email: string } | null {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return null;
    const payload = verifyJwt(token, this.cfg.tokenSecret);
    if (!payload || payload.type !== "access") return null;
    const userId = parseInt(payload.sub, 10);
    if (isNaN(userId)) return null;
    // Verify user is still active
    const user = this.db.getUserById(userId);
    if (!user) return null;
    return { userId, email: payload.email };
  }
}
