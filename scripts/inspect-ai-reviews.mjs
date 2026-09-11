/** Кто и когда создавал замечания в проекте: origin + createdAt + автор. */
const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

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

const loginRes = await fetchRetry(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
});
const cookie = (loginRes.headers.getSetCookie() || [])
  .map((c) => c.split(";")[0])
  .join("; ");

const get = async (path) =>
  (await fetchRetry(`${base}${path}`, { headers: { cookie } })).json();

const { projects } = await get("/api/projects");
for (const project of projects) {
  const { reviews } = await get(`/api/projects/${project.id}/reviews`);
  console.log(`\n=== ${project.name} (${project.id}) — ${reviews.length} замечаний`);
  for (const r of reviews) {
    console.log(
      `#${r.number} origin=${r.origin} sev=${r.severity} created=${r.createdAt} updated=${r.updatedAt} author=${r.authorName ?? "-"}`,
    );
    console.log(`    section=${r.section}`);
    if (r.aiFinding) console.log(`    ИИ: ${r.aiFinding.slice(0, 110)}`);
    if (r.text) console.log(`    инженер: ${r.text.slice(0, 110)}`);
    for (const l of r.locations || []) {
      console.log(`    → ${l.documentName} стр.${l.pageNumber}`);
    }
  }
  const { documents } = await get(`/api/documents?projectId=${project.id}`);
  for (const d of documents) {
    console.log(
      `    файл ${d.originalName}: создан ${d.createdAt} status=${d.status} режим=${d.pipelineMode ?? "-"} модель=${d.pipelineModel ?? "-"}`,
    );
  }
}
