import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: {
    login: process.env.PTO_LOGIN || "qa_engineer",
    password: process.env.PTO_PASSWORD || "QaTest-2026!",
  },
  timeout: 60000,
});
const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects.find((p) => /TestUI|Lexx/i.test(p.name));
const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();
console.log("REVIEWS", reviews.length, reviews.map((r) => `#${r.number}`).join(" "));

const page = await ctx.newPage();
async function open(label, loc, review) {
  const url = `${BASE}/?project=${project.id}&doc=${loc.documentId}&page=${loc.pageNumber}&from=reviews&review=${review.id}&quote=${encodeURIComponent(loc.quote || "")}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  await page.getByText("Страница загружается").waitFor({ state: "hidden", timeout: 50000 }).catch(() => {});
  await page.waitForTimeout(4500);
  const info = await page.evaluate(() => {
    const toolbar = [...document.querySelectorAll("button, span, div")].find((n) =>
      /^\d+%$/.test((n.textContent || "").trim()),
    );
    const cyr = (document.body.innerText.match(/[А-Яа-яЁё]/g) || []).length;
    const garbage = (document.body.innerText.match(/[ÃÐÑ]/g) || []).length;
    return {
      zoom: toolbar?.textContent?.trim() ?? null,
      zones: document.querySelectorAll(".pto-remark-zone").length,
      emerald: [...document.querySelectorAll("div")].filter((n) =>
        /emerald/.test(n.className || ""),
      ).length,
      banner: /цитата не найдена/i.test(document.body.innerText),
      cyr,
      sample: document.body.innerText.replace(/\s+/g, " ").slice(0, 220),
    };
  });
  console.log(label, info);
  await page.screenshot({ path: join(shots, `zoom-${label}.png`) });
}

const pdf = reviews.find((r) =>
  (r.locations || []).some((l) => l.rect && /\.pdf/i.test(l.documentName || "")),
);
const cad = reviews.find((r) =>
  (r.locations || []).some((l) => /\.dxf|\.dwg/i.test(l.documentName || "")),
);
if (pdf) {
  const loc = pdf.locations.find((l) => l.rect && /\.pdf/i.test(l.documentName || ""));
  await open("pdf", loc, pdf);
}
if (cad) {
  const loc = cad.locations.find((l) => /\.dxf|\.dwg/i.test(l.documentName || ""));
  await open("dxf", loc, cad);
}
await browser.close();
