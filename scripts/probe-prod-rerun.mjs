import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
mkdirSync(shots, { recursive: true });
const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const PLANTED = [
  ["площадь", "2450", "2180"],
  ["масштаб", "1:100", "1:200"],
  ["длина", "12.50", "11.80"],
  ["ВСХН-20", "7", "4"],
  ["отметка", "+0.150", "+0.250"],
  ["высота", "54.00", "51.60"],
  ["машиномест", "86", "72"],
  ["огнестойк", "II", "III"],
  ["лифт", "1000", "630"],
  ["Ду100", "Ду80"],
  ["этаж", "17", "16"],
  ["озелен", "28", "35"],
  ["квартир", "38.4", "42.1"],
  ["марш", "1.20", "1.35"],
  ["мощност", "250", "180"],
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects.find((p) => /TestUI|Lexx/i.test(p.name));
if (!project) throw new Error("no TestUI");
const { documents = [] } = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();

console.log("PROJECT", project.name, project.id);
for (const d of documents) {
  console.log(
    `DOC ${d.originalName} status=${d.status} pages=${d.pageCount} created=${d.createdAt} finished=${d.pipelineFinishedAt ?? "-"} err=${d.errorMessage ?? "-"}`,
  );
}
console.log("REVIEWS", reviews.length);

const blob = reviews
  .map((r) => `${r.section} ${r.text} ${r.aiFinding} ${(r.locations || []).map((l) => l.quote).join(" ")}`)
  .join("\n")
  .toLowerCase();

for (const [i, keys] of PLANTED.entries()) {
  const hit = keys.every((k) => blob.includes(String(k).toLowerCase()));
  const partial = keys.filter((k) => blob.includes(String(k).toLowerCase()));
  console.log(`PLANTED ${i + 1} ${hit ? "FULL" : partial.length ? `PART ${partial.join(",")}` : "MISS"} ${keys.join("/")}`);
}

for (const r of reviews) {
  console.log(
    `\n#${r.number} origin=${r.origin} sev=${r.severity} recheck=${Boolean(r.needsRecheck)} section=${r.section}`,
  );
  console.log(`  ${(r.text || r.aiFinding || "").slice(0, 280)}`);
  for (const l of r.locations || []) {
    console.log(
      `  → ${l.documentName} p.${l.pageNumber} rect=${l.rect ? JSON.stringify(l.rect) : "null"} «${(l.quote || "").slice(0, 120)}»`,
    );
  }
}

const withRect = reviews.flatMap((r) =>
  (r.locations || [])
    .filter((l) => l.rect && l.documentId && l.pageNumber)
    .map((l) => ({ review: r, loc: l })),
);
const page = await ctx.newPage();

async function jump(label, loc, review) {
  const url = `${BASE}/?project=${project.id}&doc=${loc.documentId}&page=${loc.pageNumber}&from=reviews&review=${review.id}&quote=${encodeURIComponent(loc.quote || "")}`;
  console.log("\nJUMP", label, url.slice(0, 200));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  await page.getByText("Страница загружается").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const zones = document.querySelectorAll(".pto-remark-zone").length;
    const emerald = [...document.querySelectorAll("div")].filter((n) =>
      /emerald/.test(n.className || ""),
    ).length;
    const banner = /цитата не найдена/i.test(document.body.innerText);
    const loading = /Страница загружается/i.test(document.body.innerText);
    const canvases = [...document.querySelectorAll("canvas")].map((c) => ({
      w: c.width,
      h: c.height,
    }));
    return { zones, emerald, banner, loading, canvases };
  });
  console.log("HL", info);
  await page.screenshot({ path: join(shots, `rerun-${label}.png`) });
  return info;
}

if (withRect[0]) {
  await jump("rect", withRect[0].loc, withRect[0].review);
}
const noRect = reviews.flatMap((r) =>
  (r.locations || [])
    .filter((l) => !l.rect && l.documentId && l.pageNumber)
    .map((l) => ({ review: r, loc: l })),
);
if (noRect[0]) {
  await jump("norect", noRect[0].loc, noRect[0].review);
}

writeFileSync(
  join(shots, "rerun-reviews.json"),
  JSON.stringify({ project, documents: documents.map((d) => ({ name: d.originalName, status: d.status, createdAt: d.createdAt, pages: d.pageCount })), reviews }, null, 2),
);
await page.screenshot({ path: join(shots, "rerun-table.png") });
await page.goto(`${BASE}/?project=${project.id}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
await page.getByRole("button", { name: /Таблица замечаний/ }).click().catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(shots, "rerun-table.png") });
await browser.close();
