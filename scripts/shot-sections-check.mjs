/**
 * Проверка этапа «структура листа»: оглавление, липкие заголовки разделов,
 * служебные блоки конвейера свёрнуты, «Текст листа» на первом экране.
 * Скриншоты — samples/shots/sections-*.png.
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
const stage = page.getByRole("button", { name: /^Расшифровка / });
await stage.first().waitFor({ timeout: 30000 });
await stage.first().click();

const sheets = page.locator("[data-page-strip] [data-page]");
await sheets.first().waitFor({ timeout: 30000 });

// Ищем лист со служебными разделами конвейера.
let found = false;
const total = await sheets.count();
for (let i = 0; i < Math.min(total, 8); i += 1) {
  await sheets.nth(i).click();
  await page.waitForTimeout(1500);
  if (await page.locator('[data-sheet-section="service"]').count()) {
    console.log(`\n[лист ${i + 1}] служебные разделы найдены`);
    found = true;
    break;
  }
}
if (!found) {
  console.error("в фикстуре нет листа со служебными разделами");
  await browser.close();
  process.exit(1);
}

const info = await page.evaluate(() => {
  const body = document.querySelector("[data-sheet-body]");
  const pane = body?.parentElement;
  const heads = Array.from(document.querySelectorAll("[data-sheet-section]"));
  const service = heads.filter(
    (h) => h.dataset.sheetSection === "service",
  );
  const sheetText = heads.find((h) => /Текст листа/i.test(h.textContent || ""));
  return {
    toc: document.querySelectorAll("[data-sheet-toc] button").length,
    titles: heads.map((h) => (h.textContent || "").replace(/\s+/g, " ").trim()),
    heads: heads.length,
    service: service.length,
    serviceCollapsed: service.filter(
      (h) => h.querySelector("[aria-expanded]")?.getAttribute("aria-expanded") === "false",
    ).length,
    sticky: heads.length
      ? getComputedStyle(heads[0]).position
      : "",
    // «Текст листа» должен попасть в первый экран панели.
    sheetTextTop:
      sheetText && pane
        ? Math.round(
            sheetText.getBoundingClientRect().top -
              pane.getBoundingClientRect().top,
          )
        : null,
    paneH: pane ? Math.round(pane.clientHeight) : 0,
  };
});

console.log(
  `     разделов=${info.heads} служебных=${info.service} свёрнуто=${info.serviceCollapsed} оглавление=${info.toc} position=${info.sticky}`,
);
check("оглавление листа есть", info.toc >= 2, `кнопок: ${info.toc}`);
check("заголовки разделов липкие", info.sticky === "sticky", info.sticky);
check(
  "служебные разделы свёрнуты",
  info.service > 0 && info.serviceCollapsed === info.service,
  `${info.serviceCollapsed} из ${info.service}`,
);
console.log(`     разделы: ${info.titles.join(" | ")}`);
// Заголовки конвейер меняет: на части листов раздела «Текст листа» просто нет.
if (info.sheetTextTop === null) {
  console.log("skip «Текст листа» на первом экране — такого раздела на листе нет");
} else {
  check(
    "«Текст листа» на первом экране",
    info.sheetTextTop < info.paneH,
    `top=${info.sheetTextTop} высота панели=${info.paneH}`,
  );
}
await page.screenshot({ path: path.join(OUT_DIR, "sections-1920-collapsed.png") });

// -------------------------------------------------------- раскрытие служебного

const firstService = page.locator('[data-sheet-section="service"] button').first();
const title = (await firstService.innerText()).replace(/\s+/g, " ").trim();
await firstService.click();
await page.waitForTimeout(600);
const expanded = await page.evaluate(
  () =>
    document
      .querySelector('[data-sheet-section="service"] [aria-expanded]')
      ?.getAttribute("aria-expanded") === "true",
);
check(`служебный раздел раскрывается по клику`, expanded, title);
await page.screenshot({ path: path.join(OUT_DIR, "sections-1920-expanded.png") });

// ------------------------------------------------------------------ оглавление

const tocLast = page.locator("[data-sheet-toc] button").last();
const tocLabel = (await tocLast.innerText()).trim();
await tocLast.click();
// Плавная прокрутка идёт кадрами — ждём, пока панель остановится.
await page.waitForTimeout(2000);
const jump = await page.evaluate((label) => {
  const pane = document.querySelector("[data-sheet-body]")?.parentElement;
  const head = Array.from(document.querySelectorAll("[data-sheet-section]")).find(
    (el) => (el.textContent || "").includes(label),
  );
  if (!pane || !head) return null;
  return {
    scrollTop: Math.round(pane.scrollTop),
    overflow: pane.scrollHeight - pane.clientHeight,
    // 0 — раздел ровно под верхом панели, значит прыжок сработал.
    offset: Math.round(
      head.getBoundingClientRect().top - pane.getBoundingClientRect().top,
    ),
  };
}, tocLabel);
// Последний раздел короче экрана не встанет под верх: прокрутка кончилась.
const atEnd = Boolean(jump) && jump.scrollTop >= jump.overflow - 1;
check(
  `оглавление подводит раздел «${tocLabel}» к верху панели`,
  Boolean(jump) &&
    (jump.overflow <= 1 || atEnd ? jump.offset >= 0 : Math.abs(jump.offset) <= 24),
  jump
    ? `отступ=${jump.offset} scrollTop=${jump.scrollTop} запас прокрутки=${jump.overflow}`
    : "раздел не найден",
);
await page.screenshot({ path: path.join(OUT_DIR, "sections-1920-toc.png") });

await browser.close();
console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
process.exit(failures ? 1 : 0);
