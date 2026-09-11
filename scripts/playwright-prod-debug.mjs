import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
  logs.push(`[fail] ${r.url()} ${r.failure()?.errorText || ""}`),
);

const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
console.log("login", loginRes.status());

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });
await page.getByRole("button", { name: "lexxdramma_test" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "stroitelnyy-chertezh.pdf" }).click();
await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });
await page.waitForSelector("canvas", { timeout: 60000 }).catch(() => null);
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const sync = document.querySelector("[data-sync-regions]");
  const canvas = document.querySelector("canvas");
  const err = [...document.querySelectorAll("*")]
    .map((el) => el.textContent || "")
    .find((t) => /Не удалось показать|ошибка|Error/i.test(t) && t.length < 80);
  return {
    regions: sync?.getAttribute("data-sync-regions"),
    links: sync?.getAttribute("data-sync-links"),
    canvas: canvas
      ? { w: canvas.width, h: canvas.height, display: !!canvas.offsetParent }
      : null,
    bodySnippet: document.body.innerText.slice(0, 500),
    errHint: err || null,
    workerScript: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 5),
  };
});

const worker = await context.request.get(`${BASE}/pdf.worker.min.mjs`);
console.log("worker status", worker.status(), worker.headers()["content-type"]);
console.log("info", JSON.stringify(info, null, 2));
console.log("logs (last 40):\n" + logs.slice(-40).join("\n"));

await page.screenshot({ path: "logs/prod-debug.png", fullPage: false }).catch(() => {});
await browser.close();
