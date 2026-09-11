// Разовая диагностика: что рендерится на проде и какие ошибки в консоли.
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
console.log("login", auth.status());

const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("console.error:", msg.text().slice(0, 300));
});
page.on("pageerror", (err) => console.log("pageerror:", String(err).slice(0, 500)));
page.on("response", (res) => {
  if (res.status() >= 400) console.log("http", res.status(), res.url().slice(0, 120));
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
console.log("--- текст страницы ---");
console.log((await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600));
await page.screenshot({ path: `${process.env.TEMP}/shot-prod-debug.png` });
await browser.close();
