/** Ширина строки расшифровки на широком мониторе: не должна тянуться во всю панель. */
import { chromium } from "playwright";
import path from "node:path";

const BASE = process.env.PTO_BASE_URL || "http://localhost:8080";
const OUT_DIR = path.resolve("samples/shots");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 2560, height: 1400 },
});
await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: "admin", password: "admin123" },
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);

await page.locator("[data-project-row]").first().locator("button").first().click();
await page.waitForTimeout(2000);

// Ищем лист с текстом: идём по листам, пока в расшифровке не появятся абзацы.
await page.getByRole("button", { name: /^Расшифровка / }).first().click();
await page.waitForTimeout(3000);

for (let i = 0; i < 12; i += 1) {
  const paras = page.locator(".markdown-body p");
  if ((await paras.count()) > 0) break;
  await page.keyboard.press("j");
  await page.waitForTimeout(1200);
}

const probe = () =>
  page.evaluate(() => {
    const body = document.querySelector(".markdown-body");
    const p = document.querySelector(".markdown-body p");
    const table = document.querySelector(".markdown-body table");
    return {
      pane: body ? Math.round(body.getBoundingClientRect().width) : null,
      para: p ? Math.round(p.getBoundingClientRect().width) : null,
      table: table ? Math.round(table.getBoundingClientRect().width) : null,
    };
  });

console.log("как есть:    ", await probe());
await page.screenshot({ path: path.join(OUT_DIR, "measure-2560.png") });

// Абзац должен сжаться, таблица — нет: она живёт на своей прокрутке.
await page.evaluate(() =>
  document.documentElement.style.setProperty("--md-measure", "30ch"),
);
await page.waitForTimeout(300);
console.log("measure=30ch:", await probe());

await browser.close();
