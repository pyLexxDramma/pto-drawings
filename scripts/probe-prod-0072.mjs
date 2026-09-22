import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";
const MARK = `0072 проверка ${Date.now()}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});

async function login() {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
    timeout: 60000,
  });
  if (!res.ok()) throw new Error(`login ${res.status()} ${await res.text()}`);
}

for (let i = 0; i < 8; i += 1) {
  try {
    await login();
    break;
  } catch (err) {
    if (i === 7) throw err;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects.find((p) => /TestUI|Lexx/i.test(p.name));
if (!project) throw new Error("no TestUI project");

const created = await ctx.request.post(`${BASE}/api/projects/${project.id}/reviews`, {
  data: { section: "ПЗ", text: `${MARK} api` },
});
const createdBody = await created.json();
console.log("API_POST", created.status(), createdBody.review?.severity, createdBody.review?.section, createdBody.review?.aiFinding ?? "");

const { documents = [] } = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const pdf = documents.find((d) => /\.pdf$/i.test(d.originalName));
const annRes = await ctx.request.post(`${BASE}/api/documents/${pdf.id}/annotations`, {
  data: {
    pageNumber: 1,
    rect: { x: 0.2, y: 0.2, w: 0.12, h: 0.06 },
    comment: `${MARK} mark`,
  },
});
const annBody = await annRes.json();
console.log(
  "ANN_POST",
  annRes.status(),
  annBody.review?.severity,
  annBody.review?.section,
  annBody.review?.aiFinding ?? "",
  annBody.review?.locations?.[0]?.quote,
  Boolean(annBody.review?.locations?.[0]?.rect),
);

const page = await ctx.newPage();
await page.goto(`${BASE}/?project=${project.id}&from=reviews`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.getByRole("button", { name: /Таблица замечаний/ }).click().catch(() => {});
await page.waitForTimeout(2000);
const row = page.locator("tr", { hasText: `${MARK} mark` }).first();
await row.waitFor({ timeout: 20000 });
const severityText = await row.locator("select").first().inputValue();
const options = await row.locator("select").first().locator("option").allTextContents();
console.log("TABLE_SEVERITY", severityText, "OPTIONS", options);
await page.screenshot({ path: join(shots, "prod-0072-table.png"), fullPage: true });

const ids = [createdBody.review?.id, annBody.review?.id].filter(Boolean);
for (const id of ids) {
  const del = await ctx.request.delete(`${BASE}/api/projects/${project.id}/reviews/${id}`);
  console.log("DEL", id, del.status());
}

const ok =
  created.status() === 201 &&
  createdBody.review?.severity === "unset" &&
  annRes.status() === 201 &&
  annBody.review?.severity === "unset" &&
  !annBody.review?.aiFinding &&
  annBody.review?.section === "прочее" &&
  severityText === "unset" &&
  options.includes("Не задана");
console.log(ok ? "PROD_0072_OK" : "PROD_0072_FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
