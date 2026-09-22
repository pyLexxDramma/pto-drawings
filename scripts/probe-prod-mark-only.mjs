import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

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
const { documents = [] } = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const pdf = documents.find((d) => /\.pdf$/i.test(d.originalName));
const { reviews: before } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();

const page = await ctx.newPage();
await page.goto(`${BASE}/?project=${project.id}&doc=${pdf.id}&page=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
await page.getByText("Страница загружается").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);

const canvases = await page.locator("canvas").all();
let best = null;
for (const c of canvases) {
  const b = await c.boundingBox();
  if (!b) continue;
  if (!best || b.width * b.height > best.area) best = { box: b, area: b.width * b.height };
}
console.log("BEST_CANVAS", best?.box);

await page.getByRole("button", { name: /Отметить ошибку/ }).first().click();
await page.waitForTimeout(300);
if (best?.box) {
  const { x, y, width, height } = best.box;
  await page.mouse.move(x + width * 0.25, y + height * 0.25);
  await page.mouse.down();
  await page.mouse.move(x + width * 0.45, y + height * 0.45, { steps: 12 });
  await page.mouse.up();
}
await page.waitForTimeout(1000);
const form = page.getByPlaceholder("Что неверно");
console.log("FORM", await form.count());
if ((await form.count()) > 0) {
  await form.fill("Проверка пометки Playwright: 2450 против 2180");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: join(shots, "prod-mark-final.png") });

const after = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();
const docs = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const anns = (docs.documents || []).flatMap((d) =>
  (d.pages || []).flatMap((p) => p.annotations || []),
);
const engineer = (after.reviews || []).filter((r) => r.origin === "engineer");
console.log("BEFORE", before.length, "AFTER", after.reviews.length, "ENG", engineer.length, "ANN", anns.length);
if (engineer.length) {
  console.log("NEW", engineer.at(-1).text, "reviewId", engineer.at(-1).id);
  const linked = anns.some((a) => a.reviewId === engineer.at(-1).id);
  console.log("LINKED_ANN", linked);
  await page.getByRole("button", { name: /Таблица замечаний/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, "prod-mark-in-table.png") });
  await ctx.request.delete(
    `${BASE}/api/projects/${project.id}/reviews/${engineer.at(-1).id}`,
  );
  const docs2 = await (
    await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
  ).json();
  const left = (docs2.documents || []).flatMap((d) =>
    (d.pages || []).flatMap((p) => p.annotations || []),
  );
  console.log("AFTER_DEL_ANN", left.length);
}

await page.goto(
  `${BASE}/?project=${project.id}&doc=${pdf.id}&page=10&from=reviews&review=${before[0]?.id}&quote=${encodeURIComponent(before[0]?.locations?.[0]?.quote || "10/28")}`,
  { waitUntil: "domcontentloaded", timeout: 90000 },
);
await page.getByText("Страница загружается").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
const hl = await page.evaluate(() => ({
  zones: document.querySelectorAll(".pto-remark-zone").length,
  green: [...document.querySelectorAll("div")].filter((n) =>
    (n.className || "").includes("emerald"),
  ).length,
  banner: /цитата не найдена/i.test(document.body.innerText),
  inText: /Показать в тексте/i.test(document.body.innerText),
}));
console.log("HL_AFTER_LOAD", hl);
await page.screenshot({ path: join(shots, "prod-highlight-loaded.png") });
await browser.close();
