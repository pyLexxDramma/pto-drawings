/**
 * Прогон журналов на живом стенде: вход, снимок вкладок, запись в журнал,
 * повторное чтение. Пароль и cookie не печатаем.
 */
const base = (process.env.CHECK_BASE ?? "https://pto.tw1.su").replace(/\/$/, "");
const login = process.env.PTO_CHECK_LOGIN ?? "admin";
const password = process.env.PTO_CHECK_PASSWORD ?? "admin123";
const marker = `probe-log-${Date.now()}`;

function cookieFrom(response: Response): string {
  const raw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  const parts = raw
    .flatMap((item) => item.split(/,(?=[^ ;]+=)/))
    .map((item) => item.split(";")[0]?.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("Сервер не выдал сессию");
  return parts.join("; ");
}

const loginRes = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login, password }),
});
if (!loginRes.ok) {
  const payload = (await loginRes.json().catch(() => ({}))) as { error?: string };
  throw new Error(`Вход ${loginRes.status}: ${payload.error ?? "отклонён"}`);
}
const cookie = cookieFrom(loginRes);

type AuditPayload = {
  rows?: { action?: string; message?: string; name?: string; level?: string }[];
  commits?: unknown[];
  starts?: unknown[];
  error?: string;
};

async function audit(query: string): Promise<{ status: number; body: AuditPayload }> {
  const response = await fetch(`${base}/api/audit?${query}`, {
    headers: { cookie },
  });
  const body = (await response.json()) as AuditPayload;
  return { status: response.status, body };
}

const kinds = [
  "kind=log&layer=all",
  "kind=processing",
  "kind=files",
  "kind=releases",
  "kind=reviews",
  "kind=edits",
  "kind=marks",
];

console.log(`стенд ${base}`);
for (const query of kinds) {
  const { status, body } = await audit(query);
  const n =
    query === "kind=releases"
      ? (body.commits?.length ?? 0)
      : (body.rows?.length ?? 0);
  const extra =
    query === "kind=releases" ? `, запусков: ${body.starts?.length ?? 0}` : "";
  const sample =
    body.rows?.[0]?.action ??
    body.rows?.[0]?.message ??
    body.rows?.[0]?.name ??
    "";
  console.log(
    `${query} → ${status}, записей: ${n}${extra}${
      body.error ? `, ошибка: ${body.error}` : ""
    }${sample ? `, пример: ${sample.slice(0, 80)}` : ""}`,
  );
}

const write = await fetch(`${base}/api/log`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({
    events: [
      {
        action: marker,
        ok: false,
        message: "прогон журнала с прода",
        status: 599,
        url: "/probe",
      },
    ],
  }),
});
console.log(`POST /api/log → ${write.status}`);

const after = await audit("kind=log&layer=front&errors=1");
const found = (after.body.rows ?? []).some((row) => row.action === marker);
console.log(
  `журнал после записи: ${after.status}, строк: ${after.body.rows?.length ?? 0}, маркер найден: ${found}`,
);
if (!found) process.exit(1);
