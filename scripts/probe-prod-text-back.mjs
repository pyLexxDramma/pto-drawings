/**
 * Строка над расшифровкой: слева возврат к листу, справа «свернуть текст».
 *   PTO_BASE_URL=https://pto.tw1.su node scripts/probe-prod-text-back.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 980 } });
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
const projects = await (await ctx.request.get(`${BASE}/api/projects`)).json();
let target = null;
for (const project of projects.projects || []) {
  const docs = await (
    await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
  ).json();
  const doc = (docs.documents || []).find(
    (item) => item.readyPages > 1 && item.pageCount > 1,
  );
  if (doc) {
    target = { project, doc };
    break;
  }
}
if (!target) {
  console.log("FAIL нет файла с двумя готовыми листами");
  await browser.close();
  process.exit(1);
}
console.log(`файл: ${target.doc.originalName} (${target.project.name})`);

const page = await ctx.newPage();
await page.goto(
  `${BASE}/?project=${target.project.id}&doc=${target.doc.id}&page=1`,
  { waitUntil: "domcontentloaded", timeout: 90000 },
);
await page.locator("[data-viewer-toolbar]").waitFor({ timeout: 60000 });
await page.waitForTimeout(1500);

const back = page.getByRole("button", { name: /^← (Назад|Лист \d+)$/ });
check("кнопка возврата в строке расшифровки", (await back.count()) > 0, await back.first().innerText());

// Уходим на другой лист — кнопка должна предложить вернуться на первый.
await page.getByRole("button", { name: "Следующий лист" }).first().click();
await page.waitForTimeout(1200);
const label = await back.first().innerText();
check("после перехода помнит лист", /Лист\s*1/.test(label), label);
await page.screenshot({ path: "samples/shots/fix-text-back.png" });

await back.first().click();
await page.waitForTimeout(1200);
const scale = await page.locator("[data-viewer-scale]").first().innerText();
const pageLabelNow = await back.first().innerText();
check(
  "возврат сработал",
  !/Лист\s*1$/.test(pageLabelNow),
  `кнопка теперь: ${pageLabelNow}, масштаб: ${scale}`,
);

// «Свернуть текст» должно быть последним в строке.
const row = back.first().locator("xpath=..");
const order = await row.evaluate((node) =>
  Array.from(node.querySelectorAll("button"))
    .map((item) => item.getAttribute("title") || item.textContent?.trim() || "")
    .filter(Boolean),
);
console.log("кнопки строки:", order.join(" | "));
check(
  "«свернуть текст» в правом краю",
  /Скрыть текст/.test(order[order.length - 1] || ""),
  order[order.length - 1],
);
await page.screenshot({ path: "samples/shots/fix-text-row.png" });

const failed = checks.filter((item) => !item.pass).length;
console.log(failed ? `VERIFY FAIL ${failed}` : "VERIFY PASS");
await browser.close();
process.exit(failed ? 1 : 0);
