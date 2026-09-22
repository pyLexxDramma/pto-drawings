import { readFile } from "node:fs/promises";

const base = process.env.CHECK_BASE ?? "http://localhost:8080";
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
  users: { id: string; role: string }[];
};
const admin = db.users.find((user) => user.role === "admin");
if (!admin) throw new Error("нет админа");

const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/auth.ts");
const cookie = `${SESSION_COOKIE}=${createSessionToken(admin.id)}`;
const marker = `local-probe-${Date.now()}`;

type Body = {
  rows?: { action?: string; message?: string; name?: string }[];
  commits?: { subject?: string }[];
  starts?: unknown[];
  error?: string;
};

for (const query of [
  "kind=log&layer=all",
  "kind=processing",
  "kind=files",
  "kind=releases",
  "kind=reviews",
  "kind=edits",
  "kind=marks",
]) {
  const response = await fetch(`${base}/api/audit?${query}`, { headers: { cookie } });
  const body = (await response.json()) as Body;
  const n =
    query === "kind=releases"
      ? (body.commits?.length ?? 0)
      : (body.rows?.length ?? 0);
  const sample =
    body.rows?.[0]?.action ??
    body.rows?.[0]?.message ??
    body.rows?.[0]?.name ??
    body.commits?.[0]?.subject ??
    "";
  console.log(
    `${query} → ${response.status} n=${n}${
      body.starts ? ` starts=${body.starts.length}` : ""
    }${sample ? ` | ${sample.slice(0, 70)}` : ""}`,
  );
}

const write = await fetch(`${base}/api/log`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({
    events: [{ action: marker, ok: false, message: "проверка записи журнала", status: 599 }],
  }),
});
const after = await fetch(`${base}/api/audit?kind=log&layer=front&errors=1`, {
  headers: { cookie },
});
const body = (await after.json()) as Body;
const found = (body.rows ?? []).some((row) => row.action === marker);
console.log(`POST /api/log ${write.status}; after n=${body.rows?.length ?? 0}; marker=${found}`);
if (!found) process.exit(1);
