/** Быстрый осмотр прода: проекты, документы комплекта, замечания, геометрия DXF. */
const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

/** Прод иногда рвёт первое соединение — пробуем несколько раз. */
async function fetchRetry(url, init = {}, tries = 6) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

async function login() {
  const res = await fetchRetry(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie() || [])
    .map((c) => c.split(";")[0])
    .join("; ");
}

const cookie = await login();
const get = async (path) => {
  const res = await fetchRetry(`${base}${path}`, { headers: { cookie } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
};

const { body: projects } = await get("/api/projects");
for (const p of projects.projects || []) {
  console.log(`project ${p.id} — ${p.name}`);
}

const projectId = process.argv[2];
if (projectId) {
  const { body: docs } = await get(`/api/documents?projectId=${projectId}`);
  for (const d of docs.documents || []) {
    console.log(
      `  doc ${d.id} ${d.originalName} kit=${d.kitId ?? "-"}/${d.kitRole ?? "-"} status=${d.status} pages=${d.pageCount} mode=${d.pipelineMode ?? "-"}`,
    );
  }
  const { body: reviews } = await get(`/api/projects/${projectId}/reviews`);
  for (const r of reviews.reviews || []) {
    console.log(
      `  review #${r.number} ${r.origin} ${r.severity} ${r.section}: ${(r.text || r.aiFinding).slice(0, 70)}`,
    );
    for (const l of r.locations || []) {
      console.log(`     → ${l.documentName} стр.${l.pageNumber} «${(l.quote || "").slice(0, 60)}»`);
    }
  }
  const cad = (docs.documents || []).find((d) => /\.(dxf|dwg)$/i.test(d.originalName));
  if (cad) {
    const geo = await get(`/api/documents/${cad.id}/pages/1/geometry`);
    console.log(
      `  geometry ${cad.originalName}: status=${geo.status} bytes=${(geo.text || JSON.stringify(geo.body) || "").length}`,
    );
    if (geo.text) console.log("   ", geo.text.split("\n").slice(0, 6).join(" ⏎ "));
  }
}
