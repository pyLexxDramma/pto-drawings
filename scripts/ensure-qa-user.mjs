#!/usr/bin/env node
/**
 * Создаёт/обновляет тестового инженера для прохода «новый пользователь».
 * Usage: DATA_ROOT=/var/lib/pto node scripts/ensure-qa-user.mjs [login] [password]
 */
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const login = (process.argv[2] || "qa_engineer").toLowerCase();
const password = process.argv[3] || "QaTest-2026!";
const root = process.env.DATA_ROOT || process.env.PTO_APP_DIR || process.cwd();
const dbPath = path.join(root, "data", "db.json");

function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

if (!existsSync(dbPath)) {
  console.error(`Нет ${dbPath}`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(dbPath, "utf8"));
db.users = Array.isArray(db.users) ? db.users : [];

let user = db.users.find((item) => item.login?.toLowerCase() === login);
if (!user) {
  user = {
    id: randomUUID(),
    login,
    displayName: "QA Инженер",
    role: "engineer",
    passwordHash: hashPassword(password),
    disabled: false,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  console.log(`created ${login}`);
} else {
  user.passwordHash = hashPassword(password);
  user.role = "engineer";
  user.disabled = false;
  user.displayName = user.displayName || "QA Инженер";
  console.log(`updated ${login}`);
}

writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log(`login=${login}`);
console.log(`password=${password}`);
console.log(`role=engineer`);
