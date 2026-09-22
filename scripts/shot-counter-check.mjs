/**
 * Баг 0099: счётчик замечаний обновляется без переоткрытия файла, и числа в
 * полосе этапов подписаны словами — «0/1» читали как «нашлось 0 из 1».
 * Замечание создаём отметкой на чертеже и убираем за собой.
 *   PTO_BASE_URL=http://127.0.0.1:3100 node scripts/shot-counter-check.mjs
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
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 1000 },
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
await rows.first().waitFor({ timeout: 60000 });
const fixture = rows.filter({ hasText: "UI-фикстура" });
await ((await fixture.count()) ? fixture.first() : rows.first())
  .locator("button")
  .first()
  .click();
await page.waitForTimeout(2000);

// --------------------------------------------------- подписи вместо голых дробей

/** Пока проект грузится, в полосе стоит «…» — читать числа рано. */
async function stageLabel(name) {
  const tab = page.getByRole("button", { name }).first();
  for (let i = 0; i < 40; i += 1) {
    const text = (await tab.innerText()).replace(/\s+/g, " ").trim();
    if (!text.includes("…")) return text;
    await page.waitForTimeout(500);
  }
  return (await tab.innerText()).replace(/\s+/g, " ").trim();
}

const stageText = await stageLabel(/^Таблица замечаний/);
const sheetText = await stageLabel(/^Расшифровка/);
console.log(`     полоса этапов: ${sheetText} | ${stageText}`);
check(
  "замечания: числа подписаны, а не «0/2»",
  /разобрано \d+/.test(stageText) || /ещё нет/.test(stageText),
  stageText,
);
check(
  "расшифровка: числа подписаны, а не «5/5»",
  /листов \d+ из \d+/.test(sheetText) ||
    /нет файлов|режем на листы/.test(sheetText),
  sheetText,
);

// ------------------------------------------- счётчик догоняет новое замечание

function totalFrom(text) {
  const m = /Таблица замечаний\s*(\d+)/.exec(text.replace(/\s+/g, " "));
  return m ? Number(m[1]) : 0;
}
const before = totalFrom(stageText);

// Отметка на чертеже создаёт замечание инженера — это и есть «моё замечание».
await page.locator("[data-project-files] button").filter({ hasText: ".pdf" }).first().click();
await page.waitForTimeout(4000);
await page.getByRole("button", { name: "Отметить ошибку" }).click();
await page.waitForTimeout(800);
const canvas = page.locator("[data-drawing-surface], canvas").first();
const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(800);
const comment = page.locator("textarea").first();
await comment.fill(`проверка счётчика ${Date.now()}`);
await page.getByRole("button", { name: /^Сохранить/ }).first().click();
await page.waitForTimeout(2500);

const after = totalFrom(await stageLabel(/^Таблица замечаний/));
check(
  "счётчик вырос сразу после отметки, без переоткрытия файла",
  after === before + 1,
  `было ${before}, стало ${after}`,
);
await page.screenshot({ path: path.join(OUT_DIR, "counter-after-mark.png") });

// ------------------------------------------------------------------ уборка

const { projects = [] } = await (
  await context.request.get(`${BASE}/api/projects`)
).json();
let removed = 0;
for (const project of projects) {
  const res = await context.request.get(`${BASE}/api/projects/${project.id}/reviews`);
  if (!res.ok()) continue;
  const { reviews = [] } = await res.json();
  for (const review of reviews.filter((r) => /проверка счётчика/.test(r.text || ""))) {
    const del = await context.request.delete(
      `${BASE}/api/projects/${project.id}/reviews/${review.id}`,
    );
    if (del.ok()) removed += 1;
  }
}
console.log(`     проверочные замечания убраны: ${removed}`);

await browser.close();
console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
process.exit(failures ? 1 : 0);
