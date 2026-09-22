/**
 * Блоки по статусу на вкладке разобранных и высота панели в шапке таблицы.
 *   PTO_PASSWORD=... node scripts/probe-prod-resolved-blocks.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 980 } });
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
const projects = (await (await ctx.request.get(`${BASE}/api/projects`)).json())
  .projects || [];
let target = null;
for (const project of projects) {
  const payload = await (
    await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
  ).json();
  const done = (payload.reviews || []).filter((item) => item.verdict !== "pending");
  if (!target || done.length > target.done) {
    target = { project, done: done.length };
  }
}
console.log(`Проект: ${target.project.name} · разобрано ${target.done}`);

// Таблица замечаний: высота панели-шапки.
const page = await ctx.newPage();
await page.goto(`${BASE}/?project=${target.project.id}&reviews=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.getByRole("button", { name: /Таблица замечаний/ }).first().click();
await page.waitForTimeout(3000);
const headerBox = await page.locator("header").nth(1).boundingBox();
console.log(`Высота панели в таблице: ${Math.round(headerBox?.height ?? 0)} px`);
await page.screenshot({
  path: "samples/shots/resolved-table-header.png",
  clip: { x: 0, y: 0, width: 1680, height: 120 },
});

// Вкладка разобранных: блоки по статусу.
const tab = await ctx.newPage();
await tab.goto(`${BASE}/reviews?project=${target.project.id}`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await tab.waitForTimeout(2500);
const blocks = await tab.locator("table tbody").count();
const headings = await tab.locator("table tbody tr:first-child td").allInnerTexts();
console.log(`Блоков: ${blocks}`);
for (const text of headings) {
  console.log(`   ${text.replace(/\s+/g, " ").slice(0, 90)}`);
}
const severities = await tab.locator("tbody tr td:nth-child(6)").allInnerTexts();
console.log(`Важность по порядку: ${severities.map((s) => s.trim()).join(" | ")}`);
await tab.screenshot({ path: "samples/shots/resolved-blocks.png", fullPage: true });
await browser.close();
