#!/usr/bin/env node
/** Проход «новый пользователь» (инженер) через API. */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const LOGIN = process.argv[2] || "qa_engineer";
const PASSWORD = process.argv[3] || "QaTest-2026!";

let cookie = "";

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const part = c.split(";")[0];
    if (part.startsWith("pto_session=")) cookie = part;
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const steps = [];

let r = await req("/api/auth/me");
steps.push({
  step: "1. Без входа",
  ok: r.status === 200 && r.json.user === null,
  detail: r.json,
});

r = await req("/api/auth/login", {
  method: "POST",
  body: { login: LOGIN, password: PASSWORD },
});
steps.push({
  step: "2. Вход",
  ok: r.status === 200 && r.json.user?.role === "engineer",
  detail: r.json.user,
});

r = await req("/api/auth/me");
steps.push({
  step: "3. Сессия",
  ok: r.status === 200 && r.json.user?.login === LOGIN && !r.json.defaultAdminPassword,
  detail: r.json,
});

r = await req("/api/projects");
steps.push({
  step: "4. Проекты",
  ok: r.status === 200 && Array.isArray(r.json.projects),
  detail: {
    count: r.json.projects?.length,
    names: r.json.projects?.map((p) => p.name),
  },
});

r = await req("/api/users");
steps.push({
  step: "5. Пользователи (403)",
  ok: r.status === 403,
  detail: r.json,
});

r = await req("/api/documents");
steps.push({
  step: "6. Документы",
  ok: r.status === 200,
  detail: { count: r.json.documents?.length ?? 0 },
});

r = await req("/api/auth/logout", { method: "POST" });
steps.push({ step: "7. Выход", ok: r.status === 200, detail: r.json });

r = await req("/api/auth/me");
steps.push({
  step: "8. После выхода",
  ok: r.status === 200 && r.json.user === null,
  detail: r.json,
});

const failed = steps.filter((s) => !s.ok);
const ok = failed.length === 0;
console.log(JSON.stringify({ ok, passed: steps.length - failed.length, total: steps.length, failed: failed.map((f) => f.step), steps }, null, 2));
process.exit(ok ? 0 : 1);
