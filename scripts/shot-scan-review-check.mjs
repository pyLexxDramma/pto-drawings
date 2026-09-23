/**
 * Баг 0094: что происходит на нашей стороне, когда конвейер присылает находку
 * со скана — лист прочитан моделью по изображению, рамки нет, важность низкая.
 * Проверяем: строка в таблице, переход на лист, плашка «текстового слоя нет»,
 * подсветка цитаты в расшифровке, счётчик во вкладке «Агент ИИ (ошибки)».
 *
 *   PTO_BASE_URL=http://127.0.0.1:3100 node scripts/shot-scan-review-check.mjs
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PTO_BASE_URL || "http://localhost:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const OUT_DIR = path.resolve("samples/shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  ignoreHTTPSErrors: true,
});
const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});
if (!auth.ok()) {
  console.error(`login failed ${auth.status()}`);
  await browser.close();
  process.exit(1);
}

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const rows = page.locator("[data-project-row]");
await rows.first().waitFor({ timeout: 90000 });
const fixture = rows.filter({ hasText: "UI-фикстура" });
await ((await fixture.count()) ? fixture.first() : rows.first())
  .locator("button")
  .first()
  .click();
await page.waitForTimeout(2000);

// ------------------------------------------------ строка со скана в таблице
await page.getByRole("button", { name: /^Таблица замечаний / }).first().click();
await page.locator("[data-review-id]").first().waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

const scanRow = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("[data-review-id]"));
  const row = rows.find((r) => /прочитано моделью по изображению/i.test(r.textContent || ""));
  if (!row) return null;
  return {
    severity: row.querySelector("select")?.value ?? null,
    remark: (row.children[3]?.textContent || "").trim().slice(0, 140),
    place: (row.children[4]?.textContent || "").trim(),
  };
});
if (!scanRow) {
  check("замечание со скана есть в таблице", false, "строка с пометкой не найдена");
} else {
  console.log(`     строка: ${scanRow.remark}`);
  check("замечание со скана есть в таблице", true, scanRow.place);
  check(
    "важность низкая, как присылает конвейер на сканах",
    scanRow.severity === "low",
    `severity=${scanRow.severity}`,
  );
  check(
    "пометка «прочитано моделью по изображению» видна инженеру",
    /прочитано моделью по изображению/i.test(scanRow.remark),
  );
}
await page.screenshot({ path: path.join(OUT_DIR, "scan-review-table.png") });

// --------------------------------------------- переход на лист и плашка про слой
const placeLink = page
  .locator("[data-review-id]")
  .filter({ hasText: /прочитано моделью по изображению/i })
  .locator("a, button")
  .filter({ hasText: /лист \d/ })
  .first();
if (await placeLink.count()) {
  await placeLink.click();
  await page.waitForTimeout(4000);
  const banner = page.getByText(/На листе нет текстового слоя/i);
  const bannerSeen = await banner.first().isVisible().catch(() => false);
  check("на чертеже видна плашка «нет текстового слоя»", bannerSeen);
  const showInText = page.getByRole("button", { name: /Показать в тексте/i });
  const canJump = await showInText.first().isVisible().catch(() => false);
  check("есть переход «Показать в тексте»", canJump);
  if (canJump) {
    await showInText.first().click();
    await page.waitForTimeout(1500);
  }
  const marks = await page.evaluate(() => {
    const body = document.querySelector("[data-sheet-body]");
    const hits = Array.from(body?.querySelectorAll("mark") ?? []);
    const withQuote = Array.from(body?.querySelectorAll("section") ?? []).find((s) =>
      s.querySelector("mark"),
    );
    return {
      count: hits.length,
      first: (hits[0]?.textContent || "").slice(0, 60),
      anchors: body?.querySelectorAll("mark[data-focus-quote]").length ?? 0,
      section: (withQuote?.querySelector("h2")?.textContent || "").trim(),
    };
  });
  check(
    "служебный раздел с цитатой раскрыт сам — цитата модели видна",
    /Описание чертежа/i.test(marks.section),
    marks.section || "раздела с подсветкой нет",
  );
  check(
    "цитата годится целью прокрутки",
    marks.anchors > 0,
    `якорей ${marks.anchors}`,
  );
  check(
    "цитата из описания модели подсвечена в расшифровке",
    marks.count > 0,
    `подсветок ${marks.count}${marks.first ? `, первая «${marks.first}»` : ""}`,
  );
  await page.screenshot({ path: path.join(OUT_DIR, "scan-review-sheet.png") });
} else {
  check("в строке есть ссылка на лист", false);
}

// --------------------------------- вкладка «Агент ИИ (ошибки)» знает про скан
const menu = page.getByLabel(/^(Админ|Инженер|Заказчик):/).first();
if (await menu.count()) {
  await menu.click();
  await page.waitForTimeout(600);
  const logs = page.getByRole("menuitem", { name: /Журнал/i });
  if (await logs.count()) {
    await logs.first().click();
    await page.waitForTimeout(1500);
    const agentTab = page.getByRole("tab", { name: /Агент ИИ/i });
    if (await agentTab.count()) {
      const label = (await agentTab.first().textContent()) || "";
      await agentTab.first().click();
      await page.waitForTimeout(1200);
      const text = await page.evaluate(() => document.body.textContent || "");
      check(
        "вкладка «Агент ИИ» объясняет, что лист прочитан по картинке",
        /прочитан по картинке|текстового слоя нет/i.test(text),
        label.trim(),
      );
      await page.screenshot({ path: path.join(OUT_DIR, "scan-review-agent.png") });
    } else {
      check("вкладка «Агент ИИ (ошибки)» на месте", false);
    }
  } else {
    check("в меню есть «Журналы правок»", false);
  }
} else {
  check("меню администратора найдено", false);
}

await browser.close();
console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
process.exit(failures ? 1 : 0);
