import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * All crypto for the OAuth server — pure Node.js built-ins, no dependencies.
 *
 * JWT format: base64url(header).base64url(payload).base64url(HMAC-SHA256 signature)
 * Password hashing: SHA-256(salt + password) stored as "salt:hash" (hex)
 * PKCE: S256 — SHA-256(code_verifier) compared against stored code_challenge
 */

// ---- Helpers ----

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

// ---- Random tokens ----

export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function randomB64url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

// ---- PKCE ----

/** Verify that SHA-256(code_verifier) === stored code_challenge (base64url). */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
  } catch {
    return false;
  }
}

// ---- JWT (HS256) ----

export interface JwtPayload {
  sub: string;       // user id as string
  email: string;
  iat: number;       // issued at
  exp: number;       // expires at
  type: "access" | "refresh";
}

export function signJwt(payload: JwtPayload, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts as [string, string, string];
    const expected = createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url");
    // Timing-safe compare
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(fromB64url(body).toString()) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- Password hashing ----

/** Hash a password: returns "hex_salt:hex_hash" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

/** Verify a password against a stored "salt:hash" string */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const computed = createHash("sha256").update(salt + password).digest("hex");
    return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

// ---- Auth code ----

/** Generate a short-lived opaque auth code */
export function generateAuthCode(): string {
  return randomBytes(24).toString("base64url");
}

/** Hash a refresh token for storage (so raw tokens aren't in the DB) */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
