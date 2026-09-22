/**
 * Проверка таблицы замечаний: префикс «файл.pdf, стр. N» срезан, поле заметки
 * свёрнуто, при сортировке по номеру есть разделители по файлу.
 * Скриншоты — samples/shots/table-*.png.
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
});
const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
if (!auth.ok()) {
  console.error("login failed", auth.status());
  await browser.close();
  process.exit(1);
}

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
const rows = page.locator("[data-project-row]");
await rows.first().waitFor({ timeout: 90000 });
const fixture = rows.filter({ hasText: "UI-фикстура" });
await ((await fixture.count()) ? fixture.first() : rows.first())
  .locator("button")
  .first()
  .click();
const tab = page.getByRole("button", { name: /^Таблица замечаний / });
await tab.first().waitFor({ timeout: 30000 });
await tab.first().click();
await page.locator("[data-review-id]").first().waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("[data-review-id]"));
  const remarkCell = (row) => row.children[3]?.textContent || "";
  return {
    total: rows.length,
    // Дубль места в формулировке: «имя.pdf, стр. N:» перед сутью.
    withPrefix: rows.filter((r) => /\.pdf,\s*стр\.?\s*\d+\s*:/i.test(remarkCell(r)))
      .length,
    textareas: document.querySelectorAll("[data-review-id] textarea").length,
    noteButtons: Array.from(
      document.querySelectorAll("[data-review-id] button"),
    ).filter((b) => /\+ заметка/.test(b.textContent || "")).length,
    // Заливка строки — только от разбора: «не разобрано» без фона.
    tintedPending: rows.filter((r) => {
      const bg = getComputedStyle(r).backgroundColor;
      return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    }).length,
    stripes: [
      ...new Set(rows.map((r) => getComputedStyle(r).borderLeftWidth)),
    ].sort(),
  };
});

console.log(
  `\nстрок=${info.total} с префиксом=${info.withPrefix} textarea=${info.textareas} «+ заметка»=${info.noteButtons}`,
);
check(
  "префикс «файл.pdf, стр. N» срезан",
  info.withPrefix === 0,
  `осталось строк: ${info.withPrefix}`,
);
check(
  "поле заметки свёрнуто в кнопку",
  info.textareas === 0 && info.noteButtons === info.total,
  `textarea=${info.textareas} кнопок=${info.noteButtons} из ${info.total}`,
);
check(
  "важность передана толщиной полосы, не одной на всех",
  info.stripes.length >= 2,
  info.stripes.join(" / "),
);
await page.screenshot({ path: path.join(OUT_DIR, "table-1920.png") });

// ------------------------------------------------------- раскрытие заметки

const note = page
  .locator("[data-review-id] button", { hasText: "+ заметка" })
  .first();
await note.click();
await page.waitForTimeout(500);
check(
  "заметка раскрывается по клику и получает фокус",
  (await page.locator("[data-review-id] textarea").count()) === 1 &&
    (await page.evaluate(() => document.activeElement?.tagName)) === "TEXTAREA",
);

// -------------------------------------------------------- группировка по файлу

const groups = await page.evaluate(() => {
  const heads = Array.from(document.querySelectorAll("tbody td[colspan]"))
    .map((td) => (td.textContent || "").trim())
    .filter(
      (text) =>
        /\.(pdf|dwg|dxf|docx?)/i.test(text) || text === "Без привязки к файлу",
    );
  return { heads, unique: new Set(heads).size };
});
console.log(`     заголовки групп: ${groups.heads.join(" | ") || "нет"}`);
check(
  "каждая группа встречается один раз — файлы не чередуются",
  groups.heads.length === groups.unique,
  `${groups.heads.length} заголовков, ${groups.unique} файлов`,
);
check(
  "«Без привязки к файлу» — последняя группа",
  groups.heads.length === 0 ||
    groups.heads.indexOf("Без привязки к файлу") === -1 ||
    groups.heads.indexOf("Без привязки к файлу") === groups.heads.length - 1,
  groups.heads.join(" | "),
);

await page.screenshot({ path: path.join(OUT_DIR, "table-1920-note.png") });
await browser.close();
console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
process.exit(failures ? 1 : 0);
