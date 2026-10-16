#!/usr/bin/env node
/**
 * User management CLI for the TOV Blog MCP OAuth server.
 *
 * Usage (after npm run build):
 *   node dist/scripts/admin.js add    abbir@tovfurniture.com
 *   node dist/scripts/admin.js passwd abbir@tovfurniture.com
 *   node dist/scripts/admin.js remove abbir@tovfurniture.com
 *   node dist/scripts/admin.js list
 *
 * Or via npm:
 *   npm run admin -- add abbir@tovfurniture.com
 */

import { createInterface } from "node:readline/promises";
import { getConfig, loadEnv } from "../config/env.js";
import { hashPassword } from "../oauth/crypto.js";
import { OAuthDb } from "../oauth/db.js";

loadEnv();
const cfg = getConfig();

if (!cfg.oauth) {
  console.error("OAuth is not configured. Set OAUTH_BASE_URL and OAUTH_TOKEN_SECRET in .env");
  process.exit(1);
}

const db = await OAuthDb.open(cfg.oauth.dbPath);
const rl = createInterface({ input: process.stdin, output: process.stdout });

async function promptPassword(prompt: string): Promise<string> {
  // Node readline doesn't hide input — warn the user
  process.stdout.write(`\x1b[33m(password will be visible — run in a private terminal)\x1b[0m\n`);
  const pw = await rl.question(prompt);
  if (pw.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  return pw;
}

const [, , command, email] = process.argv;

switch (command) {
  case "add": {
    if (!email) { console.error("Usage: admin add <email>"); process.exit(1); }
    const normalised = email.toLowerCase();
    if (cfg.oauth.allowedEmails.size > 0 && !cfg.oauth.allowedEmails.has(normalised)) {
      console.error(`❌ ${email} is not in ALLOWED_EMAILS. Add it to the env var first.`);
      process.exit(1);
    }
    const existing = db.getUserByEmail(normalised);
    if (existing) { console.error(`User ${email} already exists. Use 'passwd' to change the password.`); process.exit(1); }
    const pw = await promptPassword(`Password for ${email}: `);
    const hash = hashPassword(pw);
    const id = db.createUser(normalised, hash);
    console.log(`✅ Created user ${email} (id=${id})`);
    break;
  }

  case "passwd": {
    if (!email) { console.error("Usage: admin passwd <email>"); process.exit(1); }
    const user = db.getUserByEmail(email);
    if (!user) { console.error(`User ${email} not found.`); process.exit(1); }
    const pw = await promptPassword(`New password for ${email}: `);
    const hash = hashPassword(pw);
    db.updatePassword(email, hash);
    console.log(`✅ Password updated for ${email}`);
    break;
  }

  case "remove": {
    if (!email) { console.error("Usage: admin remove <email>"); process.exit(1); }
    db.deactivateUser(email);
    db.revokeAllUserTokens(db.getUserByEmail(email)?.id ?? -1);
    console.log(`✅ Deactivated ${email} and revoked all their tokens`);
    break;
  }

  case "list": {
    const users = db.listUsers();
    if (!users.length) { console.log("No users found."); break; }
    console.log("\nUsers:");
    for (const u of users) {
      const status = u.is_active ? "✅ active" : "❌ disabled";
      console.log(`  ${u.email.padEnd(40)} ${status}  (created ${u.created_at})`);
    }
    break;
  }

  default:
    console.error(`
TOV Blog MCP — user management

Commands:
  add    <email>   Create a new user (prompts for password)
  passwd <email>   Change a user's password
  remove <email>   Deactivate a user and revoke all their tokens
  list             List all users
    `);
    process.exit(1);
}

rl.close();
