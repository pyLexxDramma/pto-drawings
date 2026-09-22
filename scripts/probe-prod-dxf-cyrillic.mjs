/** Кириллица и места на DXF свежей пачки: цитаты, превью, геометрия. */
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 950 } });
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: process.env.PTO_LOGIN, password: process.env.PTO_PASSWORD },
  timeout: 60000,
});

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects.find((p) => /TestUI|Lexx/i.test(p.name));
const { documents = [] } = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();

const dxf = documents.find((d) => /\.dxf$/i.test(d.originalName));
const pdf = documents.find((d) => /\.pdf$/i.test(d.originalName));
console.log("DXF", dxf?.id, dxf?.originalName, "pages", dxf?.pageCount, "ready", dxf?.readyPages);
console.log("PDF", pdf?.id, pdf?.originalName);

const byDoc = {};
for (const r of reviews) for (const l of r.locations || []) {
  const key = l.documentName || l.documentId;
  byDoc[key] = (byDoc[key] || 0) + 1;
}
console.log("места по файлам:", byDoc);

const detail = await (await ctx.request.get(`${BASE}/api/documents/${dxf.id}`)).json();
const page1 = (detail.document?.pages || [])[0];
const md = page1?.markdown || "";
console.log("DXF markdown длина", md.length);
console.log("DXF кириллица в расшифровке:", /[А-Яа-яЁё]/.test(md));
console.log("DXF markdown начало:", md.slice(0, 300).replace(/\n/g, " ⏎ "));

const geo = await ctx.request.get(`${BASE}/api/documents/${dxf.id}/geometry?page=1`);
console.log("geometry status", geo.status());
if (geo.ok()) {
  const raw = await geo.text();
  const texts = [...raw.matchAll(/"text":"([^"]{2,60})"/g)].map((m) => m[1]);
  const cyr = texts.filter((t) => /[А-Яа-яЁё]/.test(t));
  const bad = texts.filter((t) => /\uFFFD/.test(t) || /Ð[\u0080-\u00BF]/.test(t));
  console.log("geometry подписей", texts.length, "кириллических", cyr.length, "битых", bad.length);
  console.log("примеры:", cyr.slice(0, 8));
  console.log("битые:", bad.slice(0, 5));
}

const page = await ctx.newPage();
await page.goto(`${BASE}/?project=${project.id}&doc=${dxf.id}&page=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    cyrOnPage: /[А-Яа-яЁё]{4,}/.test(t),
    quoteMiss: /цитата не найдена/i.test(t),
    noLayer: /нет текстового слоя/i.test(t),
    peekStrip: /лист открыт из разбора/i.test(t),
    svgTexts: document.querySelectorAll("svg text").length,
    sample: t.slice(0, 200).replace(/\n/g, " | "),
  };
});
console.log("DXF экран:", JSON.stringify(info));
await page.screenshot({ path: join(shots, "prod-dxf-fresh.png") });
await browser.close();
