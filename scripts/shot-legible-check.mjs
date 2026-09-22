/**
 * Проверка этапа «читаемый масштаб»: режим «Читаемо» в тулбаре поднимает
 * масштаб так, чтобы подписи листа читались, и плашка с предложением
 * появляется только когда подписи мельче порога.
 * Скриншоты — samples/shots/legible-*.png.
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
  viewport: { width: 1440, height: 900 },
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

const stage = page.getByRole("button", { name: /^Расшифровка / });
await stage.first().waitFor({ timeout: 30000 });
await stage.first().click();

const sheets = page.locator("[data-page-strip] [data-page]");
await sheets.first().waitFor({ timeout: 30000 });
await sheets.first().click();

const scaleBtn = page.locator("[data-viewer-scale]");
await scaleBtn.waitFor({ timeout: 40000 });
await page.waitForTimeout(2500);

// ------------------------------------------------- единая строка состояния

const layers = await page.evaluate(() => ({
  toolbars: document.querySelectorAll("[data-viewer-toolbar]").length,
  // Линейка и подсказка про мышь теперь внутри строки состояния, не отдельно.
  scalebarsOutsideStatus: Array.from(
    document.querySelectorAll("[data-viewer-scalebar]"),
  ).filter((el) => !el.closest(".pointer-events-none.absolute.inset-x-2")).length,
  hintPill: document.body.innerText.includes("тяни мышью"),
}));
check("тулбар один", layers.toolbars === 1, `${layers.toolbars}`);
check(
  "линейка не отдельной плашкой",
  layers.scalebarsOutsideStatus === 0,
  `вне строки: ${layers.scalebarsOutsideStatus}`,
);

const toolbarH = await page.evaluate(() => {
  const el = document.querySelector("[data-viewer-toolbar]");
  return el ? el.getBoundingClientRect().height : 0;
});
check(
  "кнопки тулбара не ниже 24px",
  toolbarH >= 24,
  `высота панели ${Math.round(toolbarH)}px`,
);

// ------------------------------------------------------------ режим «Читаемо»

const legible = page.locator("[data-viewer-legible]");
const warning = page.getByText(/подписи не читаются/);

/** Ищем лист, который «по ширине» открывается мельче порога читаемости. */
let tiny = null;
const total = await sheets.count();
for (let i = 0; i < Math.min(total, 8); i += 1) {
  await sheets.nth(i).click();
  await page.waitForTimeout(1800);
  if (await warning.count()) {
    tiny = i;
    break;
  }
}

if (tiny === null) {
  console.log("     листа мельче порога в фикстуре нет — проверяем только меню");
  await sheets.first().click();
  await page.waitForTimeout(1500);
  await scaleBtn.click();
  await legible.waitFor({ timeout: 10000 });
  check("пункт «Читаемо» есть в меню масштаба", true);
  await page.keyboard.press("Escape");
} else {
  console.log(`     лист ${tiny + 1}: плашка «подписи не читаются» показана`);
  await page.screenshot({ path: path.join(OUT_DIR, "legible-1440-before.png") });
  const before = parseInt(await scaleBtn.innerText(), 10);

  await scaleBtn.click();
  await legible.waitFor({ timeout: 10000 });
  check("пункт «Читаемо» есть в меню масштаба", true);
  await legible.click();
  await page.waitForTimeout(1500);

  const after = parseInt(await scaleBtn.innerText(), 10);
  console.log(`     масштаб: ${before}% → ${after}%`);
  check("«Читаемо» поднимает масштаб", after > before, `${before}% → ${after}%`);
  check(
    "плашка о мелких подписях ушла",
    (await warning.count()) === 0,
    `видима: ${(await warning.count()) > 0}`,
  );
  await page.screenshot({ path: path.join(OUT_DIR, "legible-1440-after.png") });
}

await browser.close();
console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
process.exit(failures ? 1 : 0);
