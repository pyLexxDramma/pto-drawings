/** Что пришло по залитому ИОС4 / TestUI — статус, листы, замечания, ошибки. */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

async function login() {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
    timeout: 60000,
  });
  if (!res.ok()) throw new Error(`login ${res.status()} ${await res.text()}`);
}

await login();

const health = await ctx.request.get(`${BASE}/api/pipeline/health`);
console.log("PIPELINE", health.status(), JSON.stringify(await health.json()).slice(0, 400));

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project =
  projects.find((p) => /TestUI|Lexx/i.test(p.name)) ??
  projects.find((p) => /TestU/i.test(p.name));
if (!project) {
  console.log("PROJECTS", projects.map((p) => p.name).join(" | "));
  throw new Error("no TestUI project");
}
console.log("PROJECT", project.id, project.name);

const docsRes = await ctx.request.get(
  `${BASE}/api/documents?projectId=${project.id}&lite=0`,
);
const docsBody = await docsRes.json();
console.log("PAUSED", docsBody.processingPaused, "docs", (docsBody.documents || []).length);

const docs = docsBody.documents || [];
docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
for (const d of docs) {
  console.log(
    [
      "DOC",
      d.createdAt,
      d.status,
      `step=${d.processingStep}`,
      `pages=${d.readyPages}/${d.pageCount}`,
      `kit=${d.kitRole ?? "-"}`,
      d.originalName,
      d.errorMessage ? `ERR=${d.errorMessage}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

const target =
  docs.find((d) => /ИОС4|IOC4|лист.?28|Принцип/i.test(d.originalName)) ??
  docs.find((d) => /2026-09-16T10:3|2026-09-16T11:3/.test(d.createdAt)) ??
  docs[0];

if (!target) throw new Error("no target doc");
console.log("\nTARGET", target.id, target.originalName);
console.log(
  JSON.stringify(
    {
      status: target.status,
      step: target.processingStep,
      page: target.processingPage,
      ready: target.readyPages,
      pages: target.pageCount,
      error: target.errorMessage,
      pageErrors: target.pageErrors,
      pageWarnings: target.pageWarnings,
      mode: target.pipelineMode,
      model: target.pipelineModel,
      elapsed: target.pipelineElapsedSec,
      finished: target.pipelineFinishedAt,
      kinds: target.kindCounts,
      anns: target.openAnnotations,
      size: target.sizeBytes,
    },
    null,
    2,
  ),
);

const full = await (await ctx.request.get(`${BASE}/api/documents/${target.id}`)).json();
const pages = full.document?.pages ?? full.pages ?? [];
console.log("FULL_PAGES", pages.length);
for (const p of pages) {
  const text = (p.text || p.markdown || p.description || "").replace(/\s+/g, " ");
  console.log(
    `  page ${p.number ?? p.pageNumber} kind=${p.kind} src=${p.source} text=${text.length} «${text.slice(0, 160)}»`,
  );
}

const md = await ctx.request.get(`${BASE}/api/documents/${target.id}/markdown`);
if (md.ok()) {
  const body = await md.text();
  console.log("MARKDOWN_LEN", body.length, body.slice(0, 220).replace(/\s+/g, " "));
  const hits = body.match(/ошибк\w*|замечан\w*|противореч\w*|несоответств\w*|расхожден\w*|неверн\w*/gi);
  console.log("MD_ISSUE_WORDS", hits ? [...new Set(hits.map((w) => w.toLowerCase()))].join(", ") : "нет");
} else {
  console.log("MARKDOWN", md.status());
}

const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();
const mine = reviews.filter((r) =>
  (r.locations || []).some((l) => l.documentId === target.id),
);
console.log("\nREVIEWS_ALL", reviews.length, "ON_FILE", mine.length);
for (const r of mine.length ? mine : reviews.slice(0, 8)) {
  const locs = r.locations || [];
  console.log(
    `#${r.number} ${r.origin} ${r.severity} ${r.verdict} ${r.section} rec=${r.needsRecheck ?? false}`,
  );
  console.log(`  text: ${(r.text || r.aiFinding || "").slice(0, 140)}`);
  for (const l of locs) {
    console.log(
      `  → ${l.documentName} p.${l.pageNumber} rect=${Boolean(l.rect)} q=«${(l.quote || "").slice(0, 80)}»`,
    );
  }
}

await browser.close();
