/**
 * Окошко «Разобрано N из M», отдельная вкладка разобранных и возврат места в
 * рабочую вкладку.
 *   PTO_PASSWORD=... node scripts/probe-prod-resolved.mjs
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

// Проект с наибольшим числом замечаний, у которых есть место в ПД.
const projects = (await (await ctx.request.get(`${BASE}/api/projects`)).json())
  .projects || [];
let target = null;
for (const project of projects) {
  const payload = await (
    await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
  ).json();
  const reviews = payload.reviews || [];
  const withPlace = reviews.filter((item) =>
    (item.locations || []).some((loc) => loc.documentId && loc.pageNumber),
  );
  if (!target || withPlace.length > target.withPlace.length) {
    target = { project, reviews, withPlace };
  }
}
if (!target || target.withPlace.length === 0) {
  console.log("Нет проекта с замечаниями и местами — нечего проверять");
  await browser.close();
  process.exit(1);
}
console.log(
  `Проект: ${target.project.name} · замечаний ${target.reviews.length} · с местом ${target.withPlace.length}`,
);

// Ставим итог разбора одному замечанию, в конце вернём «не разобрано».
const victim = target.withPlace[0];
const restore = victim.verdict;
await ctx.request.patch(
  `${BASE}/api/projects/${target.project.id}/reviews/${victim.id}`,
  { data: { verdict: "confirmed" } },
);

const page = await ctx.newPage();
await page.goto(`${BASE}/?project=${target.project.id}`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForTimeout(3000);

const summary = page.getByRole("button", { name: /Разобрано \d+ из \d+/ });
const summaryCount = await summary.count();
ok("окошко итогов в левой колонке", summaryCount > 0, `найдено ${summaryCount}`);
const summaryText = summaryCount ? await summary.first().innerText() : "";
console.log(`   текст окошка: ${summaryText.replace(/\s+/g, " ")}`);
await page.screenshot({ path: "samples/shots/resolved-summary.png" });

// Клик открывает отдельную вкладку.
const [tab] = await Promise.all([
  ctx.waitForEvent("page"),
  summary.first().click(),
]);
await tab.waitForLoadState("domcontentloaded");
await tab.waitForTimeout(2500);
ok("вкладка /reviews открылась", tab.url().includes("/reviews?project="), tab.url());
const heading = await tab.getByRole("heading").first().innerText();
ok("заголовок вкладки", /Разобранные замечания/.test(heading), heading);
const rows = await tab.locator("tbody tr").count();
ok("строки разобранных", rows > 0, `${rows}`);
const dots = await tab.locator("tbody tr span.rounded-full").count();
ok("цветные кружки в строках", dots > 0, `${dots}`);
const legend = await tab.getByText("Что значат кружки").count();
ok("расшифровка кружков", legend > 0);
await tab.screenshot({ path: "samples/shots/resolved-tab.png", fullPage: true });


// Ссылка на место должна вернуть в рабочую вкладку и показать лист.
const place = tab.locator("tbody tr button").first();
const placeText = await place.innerText();
await tab.bringToFront();
await place.click();
await page.waitForTimeout(4500);
const viewerOpen = await page.locator("canvas").count();
ok(
  "рабочая вкладка показала лист",
  viewerOpen > 0,
  `canvas ${viewerOpen}, место «${placeText.replace(/\s+/g, " ")}»`,
);
const pagesOpen = ctx.pages().length;
ok(
  "вкладка разобранных закрылась или уступила фокус",
  pagesOpen === 1 || tab.isClosed(),
  `вкладок ${pagesOpen}, закрыта: ${tab.isClosed()}`,
);
await page.bringToFront();
await page.screenshot({ path: "samples/shots/resolved-back-to-work.png" });

await ctx.request.patch(
  `${BASE}/api/projects/${target.project.id}/reviews/${victim.id}`,
  { data: { verdict: restore } },
);
await browser.close();
console.log(fails.length ? `Провалено: ${fails.join(", ")}` : "Все проверки прошли");
process.exit(fails.length ? 1 : 0);
