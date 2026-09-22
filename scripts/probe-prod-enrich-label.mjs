import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
for (let i = 0; i < 6; i += 1) {
  try {
    const res = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: {
        login: process.env.PTO_LOGIN || "qa_engineer",
        password: process.env.PTO_PASSWORD || "QaTest-2026!",
      },
      timeout: 30000,
    });
    if (res.ok()) break;
  } catch {
    if (i === 5) throw new Error("login failed");
    await new Promise((r) => setTimeout(r, 2500));
  }
}
const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects.find((p) => /TestUI|Lexx/i.test(p.name));
const page = await ctx.newPage();
await page.goto(`${BASE}/?project=${project.id}&from=reviews`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.getByRole("button", { name: /Таблица замечаний/ }).click().catch(() => {});
await page.waitForTimeout(2500);
const btn = page.getByRole("button", { name: /Проставить, где в ПД|К расшифровке/ });
const text = ((await btn.textContent()) ?? "").trim();
const old = await page.getByRole("button", { name: /К расшифровке/ }).count();
console.log("BTN", text, "OLD", old);
await browser.close();
process.exit(text.includes("Проставить, где в ПД") && old === 0 ? 0 : 1);
