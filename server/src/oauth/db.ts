import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SQLite OAuth database — uses Node 22's built-in node:sqlite module.
 * Three tables: users, auth_codes, refresh_tokens.
 */

// Node 22 built-in sqlite — dynamic import keeps older Node from crashing at startup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseClass: any;

async function getDb(path: string) {
  if (!DatabaseClass) {
    const mod = await import("node:sqlite" as string);
    DatabaseClass = mod.DatabaseSync;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseClass(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  return db;
}

export interface User {
  id: number;
  email: string;
  password_hash: string;
  is_active: number; // 1 = active, 0 = disabled
  created_at: string;
}

export interface AuthCode {
  code: string;
  user_id: number;
  redirect_uri: string;
  code_challenge: string;
  expires_at: number; // unix timestamp
  used: number; // 0 | 1
}

export interface RefreshToken {
  token_hash: string;
  user_id: number;
  expires_at: number;
  revoked: number; // 0 | 1
}

export class OAuthDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  private constructor(db: unknown) {
    this.db = db;
  }

  static async open(path: string): Promise<OAuthDb> {
    const db = await getDb(path);
    const instance = new OAuthDb(db);
    instance.migrate();
    return instance;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT    NOT NULL,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS auth_codes (
        code           TEXT    PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id),
        redirect_uri   TEXT    NOT NULL,
        code_challenge TEXT    NOT NULL,
        expires_at     INTEGER NOT NULL,
        used           INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_hash TEXT    PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL,
        revoked    INTEGER NOT NULL DEFAULT 0
      );

      -- Clean up expired records automatically on open.
      DELETE FROM auth_codes     WHERE expires_at < unixepoch();
      DELETE FROM refresh_tokens WHERE expires_at < unixepoch() OR revoked = 1;
    `);
  }

  // ---- Users ----

  getUserByEmail(email: string): User | null {
    return this.db.prepare(
      "SELECT * FROM users WHERE email = ? AND is_active = 1"
    ).get(email) as User | null;
  }

  getUserById(id: number): User | null {
    return this.db.prepare(
      "SELECT * FROM users WHERE id = ? AND is_active = 1"
    ).get(id) as User | null;
  }

  createUser(email: string, passwordHash: string): number {
    const result = this.db.prepare(
      "INSERT INTO users (email, password_hash) VALUES (?, ?)"
    ).run(email, passwordHash);
    return result.lastInsertRowid as number;
  }

  updatePassword(email: string, passwordHash: string): void {
    this.db.prepare(
      "UPDATE users SET password_hash = ? WHERE email = ? COLLATE NOCASE"
    ).run(passwordHash, email);
  }

  deactivateUser(email: string): void {
    this.db.prepare(
      "UPDATE users SET is_active = 0 WHERE email = ? COLLATE NOCASE"
    ).run(email);
  }

  listUsers(): Pick<User, "id" | "email" | "is_active" | "created_at">[] {
    return this.db.prepare(
      "SELECT id, email, is_active, created_at FROM users ORDER BY email"
    ).all() as Pick<User, "id" | "email" | "is_active" | "created_at">[];
  }

  // ---- Auth codes ----

  createAuthCode(
    code: string,
    userId: number,
    redirectUri: string,
    codeChallenge: string,
    expiresAt: number,
  ): void {
    this.db.prepare(
      "INSERT INTO auth_codes (code, user_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).run(code, userId, redirectUri, codeChallenge, expiresAt);
  }

  getAuthCode(code: string): AuthCode | null {
    return this.db.prepare(
      "SELECT * FROM auth_codes WHERE code = ? AND used = 0 AND expires_at > unixepoch()"
    ).get(code) as AuthCode | null;
  }

  markAuthCodeUsed(code: string): void {
    this.db.prepare("UPDATE auth_codes SET used = 1 WHERE code = ?").run(code);
  }

  // ---- Refresh tokens ----

  createRefreshToken(tokenHash: string, userId: number, expiresAt: number): void {
    this.db.prepare(
      "INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
    ).run(tokenHash, userId, expiresAt);
  }

  getRefreshToken(tokenHash: string): RefreshToken | null {
    return this.db.prepare(
      "SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > unixepoch()"
    ).get(tokenHash) as RefreshToken | null;
  }

  revokeRefreshToken(tokenHash: string): void {
    this.db.prepare(
      "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?"
    ).run(tokenHash);
  }

  revokeAllUserTokens(userId: number): void {
    this.db.prepare(
      "UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?"
    ).run(userId);
  }
}
