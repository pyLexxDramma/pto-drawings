// Проверка горизонтальной прокрутки в блоке расшифровки: Shift + колесо
// и горизонталь трекпада двигают широкую таблицу.
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE || "http://localhost:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

let failed = 0;
function check(name, ok, extra = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"} — ${name}${extra ? ` — ${extra}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
check("login", auth.ok(), String(auth.status()));

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });
const openProject = page.getByRole("button", { name: "Открыть проект" });
if (await openProject.count()) await openProject.click().catch(() => undefined);
await page.waitForTimeout(800);
const rows = page.locator("[data-project-row]");
await rows.first().waitFor({ timeout: 20000 });
if ((await page.locator("[data-document-row]").count()) === 0) {
  await rows.first().locator("button").first().click();
  await page.waitForTimeout(1500);
}

await page.locator("[data-document-row] button").first().click();
await page.waitForTimeout(4000);
await page.locator(".markdown-body").first().waitFor({ timeout: 20000 });

// В демо таблицы узкие, поэтому дописываем широкую: важно проверить жест, а не
// содержимое листа.
const wide = await page.evaluate(() => {
  const body = document.querySelector(".markdown-body");
  if (!body) return null;
  const table = document.createElement("table");
  const row = (cells, tag) =>
    `<tr>${cells.map((text) => `<${tag}>${text}</${tag}>`).join("")}</tr>`;
  const heads = Array.from({ length: 14 }, (_, i) => `Колонка обмера №${i + 1}`);
  const data = Array.from({ length: 14 }, (_, i) => `значение ${i + 1} по проекту`);
  table.innerHTML = `<thead>${row(heads, "th")}</thead><tbody>${row(data, "td")}</tbody>`;
  body.appendChild(table);
  return { over: body.scrollWidth - body.clientWidth };
});

check("широкий текст на листе", Boolean(wide && wide.over > 8), wide ? `запас ${wide.over}px` : "нет");
if (!wide || wide.over <= 8) {
  await browser.close();
  process.exit(1);
}

const body = page.locator(".markdown-body").first();
const box = await body.boundingBox();
const point = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 200) };
await page.mouse.move(point.x, point.y);

// Shift + колесо: браузер отдаёт deltaY, обработчик переводит его в горизонталь.
await page.mouse.wheel(0, 240, { shift: true }).catch(async () => {
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 240);
  await page.keyboard.up("Shift");
});
await page.keyboard.down("Shift");
await page.mouse.wheel(0, 240);
await page.keyboard.up("Shift");
await page.waitForTimeout(400);
const afterShift = await body.evaluate((el) => el.scrollLeft);
check("Shift + колесо сдвинул текст", afterShift > 4, `scrollLeft ${afterShift}`);

// Горизонталь трекпада приходит как deltaX.
await page.mouse.wheel(-200, 0);
await page.waitForTimeout(400);
const afterBack = await body.evaluate((el) => el.scrollLeft);
check("горизонталь трекпада вернула назад", afterBack < afterShift, `scrollLeft ${afterBack}`);

// Обычное колесо не перехватываем: вертикаль должна работать как раньше.
const canScrollDown = await page.evaluate(() => {
  const pane = document.querySelector(".markdown-body")?.parentElement;
  return pane ? pane.scrollHeight - pane.clientHeight > 8 : false;
});
const beforeLeft = await body.evaluate((el) => el.scrollLeft);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(400);
const [paneAfter, leftAfter] = await Promise.all([
  page.evaluate(() => document.querySelector(".markdown-body")?.parentElement?.scrollTop ?? -1),
  body.evaluate((el) => el.scrollLeft),
]);
check("обычное колесо не двигает по горизонтали", leftAfter === beforeLeft, `${beforeLeft} → ${leftAfter}`);
if (canScrollDown) {
  check("обычное колесо листает вниз", paneAfter > 0, String(paneAfter));
} else {
  console.log("инфо — лист короче панели, вертикаль проверять нечем");
}

await page.screenshot({ path: `${process.env.TEMP}/shot-hscroll.png` });
await browser.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки прошли");
process.exit(failed ? 1 : 0);
