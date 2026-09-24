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
  const reviews = await (
    await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
  ).json();
  const withReviews = new Set(
    (reviews.reviews || []).flatMap((review) =>
      (review.locations || []).map((loc) => loc.documentId),
    ),
  );
  const docs2 = docs.documents || [];
  const doc =
    docs2.find(
      (item) =>
        item.readyPages > 1 && item.pageCount > 1 && withReviews.has(item.id),
    ) ?? docs2.find((item) => item.readyPages > 1 && item.pageCount > 1);
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

const back = page.getByRole("button", { name: "Назад" });
check("кнопка возврата в строке расшифровки", (await back.count()) > 0, await back.first().innerText());

// Шаг возврата виден в подсказке: уходим на другой лист — обещает лист 1.
await page.getByRole("button", { name: "Следующий лист" }).first().click();
await page.waitForTimeout(1200);
const hint = await back.first().getAttribute("title");
check("после перехода помнит лист", /листу\s*1/i.test(hint || ""), hint || "");
await page.screenshot({ path: "samples/shots/fix-text-back.png" });

await back.first().click();
await page.waitForTimeout(1200);
const hintNow = await back.first().getAttribute("title");
check(
  "возврат сработал",
  !/листу\s*1/i.test(hintNow || ""),
  `подсказка теперь: ${hintNow}`,
);

// Сценарий инженера: раскрыл список, выбрал замечание, нажал «Назад».
const header = page.getByRole("button", { name: /Замечаний по листу/ });
if (await header.count()) {
  await header.first().click();
  await page.waitForTimeout(400);
  await page
    .locator("ul.max-h-40 > li")
    .first()
    .locator("button")
    .first()
    .click();
  await page.waitForTimeout(1200);
  const picked = await back.first().getAttribute("title");
  check(
    "после выбора замечания первый шаг — снять замечание",
    /снять выбранное замечание/i.test(picked || ""),
    picked || "",
  );
  await back.first().click();
  await page.waitForTimeout(1200);
  const stillHere = await header.count();
  const listRows = await page.locator("ul.max-h-40 > li").count();
  const focused = await page.locator(".pto-remark-text").count();
  check("остались на листе со списком замечаний", stillHere > 0);
  check("список снова свёрнут", listRows === 0, `строк: ${listRows}`);
  check("подсветка выбранного снята", focused === 0, `подсветок цитаты: ${focused}`);
  await page.screenshot({ path: "samples/shots/fix-back-to-list.png" });
}

// «Свернуть текст» должно быть последним в строке.
const row = back.first().locator("xpath=..");
const order = await row.evaluate((node) =>
  Array.from(node.querySelectorAll("button"))
    .map((item) => item.getAttribute("title") || item.textContent?.trim() || "")
    .filter(Boolean),
);
console.log("кнопки строки:", order.join(" | "));
check(
  "«скрыть расшифровку» в правом краю",
  /Скрыть расшифровку/.test(order[order.length - 1] || ""),
  order[order.length - 1],
);
await page.screenshot({ path: "samples/shots/fix-text-row.png" });

const failed = checks.filter((item) => !item.pass).length;
console.log(failed ? `VERIFY FAIL ${failed}` : "VERIFY PASS");
await browser.close();
process.exit(failed ? 1 : 0);
