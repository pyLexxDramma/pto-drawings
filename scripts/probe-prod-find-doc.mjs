/** Где лежит файл: проект, страницы, статус, число замечаний. */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const FILE_RE = new RegExp(process.env.PTO_FILE || "ИОС4", "i");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: process.env.PTO_LOGIN, password: process.env.PTO_PASSWORD },
  timeout: 60000,
});

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
for (const project of projects) {
  const { documents = [] } = await (
    await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
  ).json();
  const hit = documents.filter((d) => FILE_RE.test(d.originalName));
  if (!hit.length) continue;
  const { reviews = [] } = await (
    await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
  ).json();
  console.log(`\nПРОЕКТ ${project.name} (${project.id})`);
  for (const d of hit) {
    console.log(
      `  ${d.originalName} id=${d.id} стр.${d.pageCount} готово ${d.readyPages} статус ${d.status} kit=${d.kitId ?? "-"} ${d.createdAt ?? ""}`,
    );
    if (d.errorMessage) console.log(`  ошибка: ${d.errorMessage}`);
  }
  const places = reviews.flatMap((r) => (r.locations || []).map((l) => ({ r, l })));
  console.log(`  замечаний ${reviews.length}, мест ${places.length}`);
  for (const { r, l } of places.slice(0, 12)) {
    console.log(
      `    #${r.number} стр.${l.pageNumber} rect=${l.rect ? "да" : "НЕТ"} «${(l.quote || "").slice(0, 60)}»`,
    );
  }
}
await browser.close();
