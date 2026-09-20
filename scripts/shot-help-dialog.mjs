/**
 * Снимок инструкции из меню Админ — проверяем краткость и подсветку.
 *   PTO_BASE_URL=http://localhost:8080 node scripts/shot-help-dialog.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "http://localhost:8080";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});

const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByRole("button", { name: /Админ|Инженер/ }).first().click();
await page.getByRole("menuitem", { name: /Инструкция/ }).first().click();

const dialog = page.getByRole("dialog", { name: "Инструкция" });
await dialog.waitFor({ timeout: 30000 });
const body = dialog.locator("div").first();

const size = await body.evaluate((el) => ({
  scroll: el.scrollHeight,
  visible: el.clientHeight,
  words: (el.innerText || "").trim().split(/\s+/).length,
}));
console.log(
  `инструкция: ${size.words} слов, ${size.scroll}px при окне ${size.visible}px`,
);

await dialog.screenshot({ path: join(shots, "help-top.png") });
const shotCount = Math.ceil(size.scroll / size.visible);
for (let i = 1; i < shotCount; i += 1) {
  await body.evaluate((el, step) => {
    el.scrollTop = el.clientHeight * step;
  }, i);
  await page.waitForTimeout(200);
  await dialog.screenshot({ path: join(shots, `help-${i + 1}.png`) });
}
console.log("снимков:", shotCount);
await browser.close();
