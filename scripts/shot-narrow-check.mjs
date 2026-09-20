/**
 * Узкое десктопное окно: дерево проектов должно свернуться само при открытии
 * листа, плюс пустое состояние таблицы под фильтром, который ничего не находит.
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PTO_BASE_URL || "http://localhost:8080";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const OUT_DIR = path.resolve("samples/shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1100, height: 760 },
});
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
await page.waitForTimeout(2500);

const rows = page.locator("[data-project-row]");
await rows.first().locator("button").first().click();
await page.waitForTimeout(2000);

await page.getByRole("button", { name: /^Расшифровка / }).first().click();
await page.waitForTimeout(3500);
const collapsed = await page
  .getByRole("button", { name: "Показать проекты и листы" })
  .count();
console.log("1100: дерево свёрнуто при открытии листа =", collapsed > 0);
await page.screenshot({ path: path.join(OUT_DIR, "narrow-1100-sheet.png") });

// Пустое состояние: поиск, который точно ничего не найдёт.
await page.getByRole("button", { name: /^Таблица замечаний / }).first().click();
await page.waitForTimeout(2000);
const search = page.getByPlaceholder("Поиск");
if (await search.count()) {
  await search.first().fill("zzzнетничего");
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: path.join(OUT_DIR, "narrow-1100-empty.png") });

await browser.close();
console.log("готово:", OUT_DIR);
