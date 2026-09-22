/**
 * Кнопки Excel на вкладке разобранных: импорт своего списка и выгрузка.
 *   PTO_PASSWORD=... node scripts/probe-prod-resolved-excel.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const fails = [];
const ok = (label, pass, extra = "") => {
  console.log(`${pass ? "OK  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) fails.push(label);
};

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
  if (!target || done.length > target.done) target = { project, done: done.length };
}
console.log(`Проект: ${target.project.name} · разобрано ${target.done}`);

const tab = await ctx.newPage();
await tab.goto(`${BASE}/reviews?project=${target.project.id}`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await tab.waitForTimeout(2500);

const importButton = tab.getByRole("button", { name: "Мои замечания из Excel" });
ok("кнопка «Мои замечания из Excel»", (await importButton.count()) === 1);
const exportButton = tab.getByRole("button", { name: /Скачать Excel · \d+/ });
ok(
  "кнопка «Скачать Excel · N»",
  (await exportButton.count()) === 1,
  (await exportButton.count()) ? await exportButton.innerText() : "",
);
const headerBox = await tab.locator("header").first().boundingBox();
console.log(`Высота шапки вкладки: ${Math.round(headerBox?.height ?? 0)} px`);

const [download] = await Promise.all([
  tab.waitForEvent("download", { timeout: 30000 }),
  exportButton.click(),
]);
ok("файл выгрузился", Boolean(download), download.suggestedFilename());
await tab.screenshot({
  path: "samples/shots/resolved-excel-buttons.png",
  clip: { x: 0, y: 0, width: 1680, height: 90 },
});
await browser.close();
console.log(fails.length ? `Провалено: ${fails.join(", ")}` : "Все проверки прошли");
process.exit(fails.length ? 1 : 0);
