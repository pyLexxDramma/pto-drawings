// Скриншоты локального стенда: таблица замечаний, тулбар листа, меню пользователя.
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE = process.env.PTO_BASE_URL || "http://localhost:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const PROJECT = process.env.PTO_PROJECT || "Жуковский";
const OUT = process.env.PTO_SHOT || path.join(os.tmpdir(), "demo-table.png");
const SHEET_OUT = OUT.replace(/\.png$/, "-sheet.png");
const MENU_OUT = OUT.replace(/\.png$/, "-menu.png");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
if (!auth.ok()) {
  console.error("login failed", auth.status());
  await browser.close();
  process.exit(1);
}

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });
await page.getByRole("button", { name: "Открыть проект" }).click().catch(() => undefined);
await page.waitForTimeout(800);

const rows = page.locator("[data-project-row]");
console.log("проектов в списке:", await rows.count());
const wanted = rows.filter({ hasText: PROJECT }).first();
await ((await wanted.count()) ? wanted : rows.first()).locator("button").first().click();
await page.waitForTimeout(1500);

const stage = page.getByRole("button", { name: /^Таблица замечаний (\d+\/\d+|—)$/ });
console.log("этап «Таблица замечаний»:", await stage.count());
await stage.first().click();
await page.waitForTimeout(2500);

const tableRows = page.locator("tbody tr").filter({ has: page.locator("select") });
console.log("строк в таблице:", await tableRows.count());
await page.screenshot({ path: OUT });
console.log("таблица:", OUT);

// --- лист: в тулбаре должна остаться только «Ошибка» ---
await page.getByRole("button", { name: /К чертежам/ }).click();
await page.waitForTimeout(1200);
await page.locator("[data-project-files] button").filter({ hasText: ".pdf" }).first().click();
await page.waitForTimeout(4000);
await page.screenshot({ path: SHEET_OUT });
console.log("лист:", SHEET_OUT);

const userButton = page
  .locator('button[aria-haspopup="menu"]')
  .filter({ hasText: "▾" })
  .last();
await userButton.click();
await page.waitForTimeout(700);
await page.screenshot({ path: MENU_OUT });
console.log("меню пользователя:", MENU_OUT);
console.log(
  "пункты меню:",
  (await page.locator("[role=menu]").first().innerText()).replace(/\n+/g, " | "),
);
await browser.close();
