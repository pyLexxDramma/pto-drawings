/**
 * Ручная проверка вкладок «Журнал действий» и «Ошибки обработки»: заходим под
 * первым админом из базы, не спрашивая пароль. Токен не печатаем.
 */
import { readFile } from "node:fs/promises";

const base = process.env.CHECK_BASE ?? "http://localhost:8080";

// Секрет сессии Next берёт из .env.local, а tsx его сам не читает.
for (const file of [".env.local", ".env"]) {
  const text = await readFile(file, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

const db = JSON.parse(await readFile("data/db.json", "utf8")) as {
  users: { id: string; role: string; login: string }[];
};
const admin = db.users.find((user) => user.role === "admin");
if (!admin) throw new Error("В базе нет админа");

const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/auth.ts");
const cookie = `${SESSION_COOKIE}=${createSessionToken(admin.id)}`;

for (const query of ["kind=log&layer=all", "kind=log&errors=1", "kind=processing"]) {
  const response = await fetch(`${base}/api/audit?${query}`, {
    headers: { cookie },
  });
  const payload = (await response.json()) as { rows?: unknown[]; error?: string };
  console.log(
    `${query} → ${response.status}, строк: ${payload.rows?.length ?? 0}${
      payload.error ? `, ошибка: ${payload.error}` : ""
    }`,
  );
  if (payload.rows?.length) console.log("  ", JSON.stringify(payload.rows[0]));
}
