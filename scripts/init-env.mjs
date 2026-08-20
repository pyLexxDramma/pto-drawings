import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), ".env.local");

if (existsSync(target)) {
  console.log(".env.local уже есть — ничего не меняю");
  process.exit(0);
}

const lines = [
  "# Создано npm run init:env. Файл не попадает в git.",
  `PTO_SESSION_SECRET=${randomBytes(32).toString("hex")}`,
  `PTO_INGEST_TOKEN=${randomBytes(24).toString("hex")}`,
  "",
];

writeFileSync(target, lines.join("\n"), "utf8");
console.log(".env.local создан: секрет сессии и токен ингеста сгенерированы");
