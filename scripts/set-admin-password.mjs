#!/usr/bin/env node
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const password = process.argv[2];
const login = process.argv[3] || "admin";
if (!password || password.length < 6) {
  console.error("Usage: node set-admin-password.mjs <password> [login]");
  process.exit(1);
}

const root = process.env.PTO_APP_DIR || process.cwd();
const dbPath = path.join(root, "data", "db.json");
const db = JSON.parse(readFileSync(dbPath, "utf8"));
const user = (db.users || []).find((u) => u.login === login);
if (!user) {
  console.error(`User ${login} not found`);
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
user.passwordHash = `${salt}:${hash}`;
user.disabled = false;
writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log(`OK: password updated for ${login}`);
