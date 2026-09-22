/**
 * Кнопка «К проектам» должна быть одна: в шапке приложения, не в таблице.
 *   PTO_BASE_URL=https://pto.tw1.su node scripts/probe-prod-back-button.mjs
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
const projects = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = (projects.projects || [])[0];
const page = await ctx.newPage();
await page.goto(`${BASE}/?project=${project.id}&reviews=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.getByRole("button", { name: /Таблица замечаний/ }).first().click();
await page.waitForTimeout(2500);
const back = page.getByRole("button", { name: "← К проектам" });
const count = await back.count();
console.log(`«К проектам» на экране таблицы: ${count}`);
await page.screenshot({ path: "samples/shots/fix-one-back.png" });
await browser.close();
process.exit(count === 1 ? 0 : 1);
