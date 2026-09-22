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

async function login() {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: {
      login: process.env.PTO_LOGIN || "qa_engineer",
      password: process.env.PTO_PASSWORD || "QaTest-2026!",
    },
    timeout: 60000,
  });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
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
const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();
const review =
  reviews.find((r) => (r.locations || []).some((l) => l.rect && l.documentId && l.pageNumber)) ??
  reviews.find((r) => (r.locations || []).some((l) => l.documentId && l.pageNumber));
if (!review) throw new Error("no review with a place");
const loc =
  review.locations.find((l) => l.rect && l.documentId && l.pageNumber) ??
  review.locations.find((l) => l.documentId && l.pageNumber);

const page = await ctx.newPage();
const url = `${BASE}/?project=${project.id}&doc=${loc.documentId}&page=${loc.pageNumber}&from=reviews&review=${review.id}&quote=${encodeURIComponent(loc.quote || review.text || "")}`;
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
await page.getByText("Страница загружается").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3500);

async function scale() {
  const text = (await page.locator("[data-viewer-scale]").first().textContent()) ?? "";
  return Number.parseInt(text.replace(/\D/g, ""), 10);
}

const afterClick = await scale();
console.log("AFTER_CLICK", afterClick);
await page.screenshot({ path: join(shots, "prod-zoom-after-click.png") });

await page.getByRole("button", { name: "Отдалить" }).click();
await page.waitForTimeout(400);
const afterMinus = await scale();
console.log("AFTER_MINUS", afterMinus);

await page.getByRole("button", { name: "Отдалить" }).click();
await page.waitForTimeout(400);
const afterMinus2 = await scale();
console.log("AFTER_MINUS2", afterMinus2);

await page.getByRole("button", { name: "Приблизить" }).click();
await page.waitForTimeout(400);
const afterPlus = await scale();
console.log("AFTER_PLUS", afterPlus);
await page.screenshot({ path: join(shots, "prod-zoom-after-minus.png") });

const ok =
  afterClick > 0 &&
  afterClick <= 260 &&
  afterMinus < afterClick &&
  afterMinus2 < afterMinus &&
  afterPlus > afterMinus2;
console.log(ok ? "PROD_ZOOM_OK" : "PROD_ZOOM_FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
