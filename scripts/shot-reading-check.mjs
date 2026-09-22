/**
 * Проверка читаемости расшифровки: кегль, отсутствие лишней горизонтальной
 * полосы на текстовом листе, перенос в ячейках листа-таблицы.
 * Скриншоты — samples/shots/reading-*.png.
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PTO_BASE_URL || "http://localhost:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const OUT_DIR = path.resolve("samples/shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZES = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "1920", width: 1920, height: 1080 },
  { tag: "2560", width: 2560, height: 1400 },
];

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Замеры панели расшифровки: кегль, полоса прокрутки, ячейки. */
function probe() {
  const el = document.querySelector(".markdown-body");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const pane = el.parentElement;
  const cells = Array.from(el.querySelectorAll("td,th"));
  const h1 = el.querySelector("h1");
  const table = el.querySelector("table");
  return {
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    isTable: el.classList.contains("markdown-body--table"),
    paneScrollW: pane ? pane.scrollWidth : 0,
    paneClientW: pane ? pane.clientWidth : 0,
    paneOverflowX: pane ? getComputedStyle(pane).overflowX : "",
    // Заметная бирюзовая полоса — только листу-таблице.
    paneLoudBar: pane ? pane.classList.contains("pto-pane-scroll") : false,
    cellCount: cells.length,
    maxCellW: cells.length
      ? Math.round(Math.max(...cells.map((c) => c.getBoundingClientRect().width)))
      : 0,
    cellWhiteSpace: cells.length ? getComputedStyle(cells[0]).whiteSpace : "",
    h1Size: h1 ? getComputedStyle(h1).fontSize : "",
    tableFont: table ? getComputedStyle(table).fontSize : "",
  };
}

const browser = await chromium.launch();

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
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
  // Фикстура, если засеяна (ui-fixture-seed.mts): в ней есть лист каждого типа.
  const fixture = rows.filter({ hasText: "UI-фикстура" });
  const target = (await fixture.count()) ? fixture.first() : rows.first();
  await target.locator("button").first().click();

  const stage = page.getByRole("button", { name: /^Расшифровка / });
  await stage.first().waitFor({ timeout: 30000 });
  await stage.first().click();
  // Этап ведёт на первый НЕрасшифрованный лист — текста там нет по определению.
  // Для замеров нужен готовый лист, поэтому идём по полосе листов.
  const sheets = page.locator("[data-page-strip] [data-page]");
  await sheets.first().waitFor({ timeout: 30000 });

  const total = await sheets.count();
  let textProbe = null;
  let tableProbe = null;
  for (let i = 0; i < Math.min(total, 10); i += 1) {
    await sheets.nth(i).click();
    await page.waitForTimeout(1200);
    const info = await page.evaluate(probe);
    if (!info) continue;
    if (info.isTable && !tableProbe) tableProbe = info;
    if (!info.isTable && !textProbe) textProbe = info;
    if (textProbe && tableProbe) break;
  }

  // Три ступени кегля: 13px до 1800, 14px до 2200, 15px на 4K (баг 0098).
  const expectedPx = size.width >= 2200 ? 15 : size.width >= 1800 ? 14 : 13;
  console.log(`\n[${size.tag}] листов в полосе: ${total}`);

  for (const [kind, info] of [
    ["текст", textProbe],
    ["таблица", tableProbe],
  ]) {
    if (!info) {
      console.log(`     листа типа «${kind}» в комплекте нет — пропуск`);
      continue;
    }
    console.log(
      `     ${kind}: text=${info.fontSize}/${info.lineHeight} h1=${info.h1Size} table=${info.tableFont} ячеек=${info.cellCount} maxW=${info.maxCellW}`,
    );
    check(
      `${size.tag} ${kind}: кегль ${expectedPx}px`,
      Math.round(parseFloat(info.fontSize)) === expectedPx,
      info.fontSize,
    );
    check(
      `${size.tag} ${kind}: межстрочный не ниже 1.5`,
      parseFloat(info.lineHeight) / parseFloat(info.fontSize) >= 1.5,
      (parseFloat(info.lineHeight) / parseFloat(info.fontSize)).toFixed(2),
    );
    // Полоса не должна быть «всегда включена»: у текстового листа она
    // появляется сама и только если контент правда шире панели.
    check(
      `${size.tag} ${kind}: полоса ${kind === "таблица" ? "заметная" : "обычная"}`,
      info.paneLoudBar === (kind === "таблица"),
      `pto-pane-scroll=${info.paneLoudBar} overflowX=${info.paneOverflowX}`,
    );
    if (kind === "текст") {
      check(
        `${size.tag} текст: overflow-x auto, а не scroll`,
        info.paneOverflowX === "auto",
        `${info.paneOverflowX} scrollW=${info.paneScrollW} clientW=${info.paneClientW}`,
      );
    }
    if (info.cellCount) {
      check(
        `${size.tag} ${kind}: ячейки переносятся`,
        info.cellWhiteSpace !== "nowrap",
        info.cellWhiteSpace,
      );
    }
  }

  await page.screenshot({
    path: path.join(OUT_DIR, `reading-${size.tag}-sheet.png`),
  });
  await context.close();
}

await browser.close();
console.log(failures ? `\nпровалов: ${failures}` : "\nвсё сошлось");
process.exit(failures ? 1 : 0);
