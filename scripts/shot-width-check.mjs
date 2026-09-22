/**
 * Баг 0098: панель расшифровки тянется по ширине, текст не мелкий, справа нет
 * пустоты, а раздвинутая граница помнится между листами.
 *   PTO_BASE_URL=https://pto.tw1.su PTO_PASSWORD=... node scripts/shot-width-check.mjs
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PTO_BASE_URL || "http://localhost:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const OUT_DIR = path.resolve("samples/shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Ожидаемый кегль расшифровки по ширине окна — три ступени. Долю считаем от
 * рабочей области (чертёж + расшифровка), а не от окна: список проектов слева
 * занимает фиксированные пиксели и на ноутбуке съедает несколько процентов.
 */
const EXPECT = [
  { width: 1440, font: 13, minShare: 40 },
  { width: 1920, font: 14, minShare: 40 },
  { width: 2560, font: 15, minShare: 40 },
];

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
let auth = null;
for (let i = 0; i < 6 && !auth?.ok(); i += 1) {
  try {
    auth = await context.request.post(`${BASE}/api/auth/login`, {
      data: { login: LOGIN, password: PASSWORD },
      timeout: 60000,
    });
  } catch {
    await new Promise((r) => setTimeout(r, 4000));
  }
}
if (!auth?.ok()) {
  console.error("login failed");
  await browser.close();
  process.exit(1);
}

/** Открыть первый готовый лист первого проекта. */
async function openSheet(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  const rows = page.locator("[data-project-row]");
  await rows.first().waitFor({ timeout: 90000 });
  const fixture = rows.filter({ hasText: "UI-фикстура" });
  await ((await fixture.count()) ? fixture.first() : rows.first())
    .locator("button")
    .first()
    .click();
  await page.waitForTimeout(2000);
  await page
    .locator("[data-project-files] button")
    .filter({ hasText: ".pdf" })
    .first()
    .click();
  await page.locator("[data-sheet-body]").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
}

function measure() {
  const body = document.querySelector("[data-sheet-body]");
  const pane = body?.parentElement;
  if (!body || !pane) return null;
  const paras = Array.from(body.querySelectorAll("p, li"));
  const widest = paras.reduce(
    (max, el) => Math.max(max, Math.round(el.getBoundingClientRect().width)),
    0,
  );
  const long = paras.find((el) => (el.textContent || "").length > 60) ?? body;
  const handle = document.querySelector("[data-split-handle]");
  const work = handle?.parentElement;
  return {
    paneW: Math.round(pane.clientWidth),
    widest,
    font: Math.round(parseFloat(getComputedStyle(long).fontSize)),
    windowW: window.innerWidth,
    workW: Math.round(work?.clientWidth ?? window.innerWidth),
  };
}

for (const step of EXPECT) {
  const page = await context.newPage();
  await page.setViewportSize({ width: step.width, height: 1000 });
  await openSheet(page);
  const m = await page.evaluate(measure);
  if (!m) {
    check(`${step.width}: панель расшифровки найдена`, false);
    await page.close();
    continue;
  }
  const share = Math.round((m.paneW / m.workW) * 100);
  const fill = Math.round((m.widest / m.paneW) * 100);
  console.log(
    `\n[${step.width}] панель ${m.paneW}px (${share}% рабочей области, ${Math.round((m.paneW / m.windowW) * 100)}% окна) · текст ${m.widest}px (${fill}% панели) · кегль ${m.font}px`,
  );
  check(
    `${step.width}: кегль расшифровки ${step.font}px`,
    m.font === step.font,
    `${m.font}px`,
  );
  check(
    `${step.width}: панель занимает не меньше ${step.minShare}% рабочей области`,
    share >= step.minShare,
    `${share}%`,
  );
  check(
    `${step.width}: текст занимает ширину панели, справа не пусто`,
    fill >= 85,
    `${fill}% панели, свободно ${m.paneW - m.widest}px`,
  );
  await page.screenshot({ path: path.join(OUT_DIR, `width-${step.width}.png`) });
  await page.close();
}

// ------------------------------------------- раздвинутая граница помнится

const page = await context.newPage();
await page.setViewportSize({ width: 1920, height: 1000 });
await openSheet(page);
// Ширину помним раздельно для чертежа и ведомости, поэтому и тянем, и сверяем
// на листах-чертежах: переход «ведомость → чертёж» меняет долю законно.
const drawingSheets = page.locator(
  '[data-page-strip] [data-page]:not([aria-label*="Таблица"])',
);
if ((await drawingSheets.count()) < 2) {
  console.log("skip память ширины — в комплекте меньше двух листов-чертежей");
  await page.close();
  await browser.close();
  console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
  process.exit(failures ? 1 : 0);
}
await drawingSheets.first().click();
await page.waitForTimeout(2500);
const start = await page.evaluate(measure);
const handle = page.locator("[data-split-handle]").first();
if (await handle.count()) {
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 260, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const wider = await page.evaluate(measure);
  check(
    "граница двигается: расшифровка стала шире",
    wider.paneW > start.paneW + 100,
    `${start.paneW}px → ${wider.paneW}px`,
  );
  // Другой лист-чертёж не должен возвращать узкую колонку.
  await drawingSheets.nth(1).click();
  await page.waitForTimeout(2500);
  const afterSheet = await page.evaluate(measure);
  check(
    "ширина помнится при переходе на другой лист",
    afterSheet.paneW > start.paneW + 60,
    `${afterSheet.paneW}px против исходных ${start.paneW}px`,
  );
  await openSheet(page);
  await drawingSheets.first().click();
  await page.waitForTimeout(2500);
  const afterReload = await page.evaluate(measure);
  check(
    "ширина помнится после повторного открытия файла",
    afterReload.paneW > start.paneW + 60,
    `${afterReload.paneW}px против исходных ${start.paneW}px`,
  );
} else {
  check("разделитель панелей найден", false, "нет [data-split-handle]");
}
await page.screenshot({ path: path.join(OUT_DIR, "width-split-kept.png") });
await page.close();

await browser.close();
console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
process.exit(failures ? 1 : 0);
