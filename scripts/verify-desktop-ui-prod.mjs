/**
 * Прод после десктопного адаптива: шкала текста от ширины окна, таблица
 * замечаний влезает без горизонтальной прокрутки, колонка проектов растёт с
 * окном и сворачивается на узком, панель листа с одной акцентной кнопкой.
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";
const OUT_DIR = path.resolve("samples/shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const SIZES = [
  { tag: "1100", width: 1100, height: 760, expectSm: "11px", narrow: true },
  { tag: "1440", width: 1440, height: 900, expectSm: "11px", narrow: false },
  { tag: "2560", width: 2560, height: 1400, expectSm: "12px", narrow: false },
];

const browser = await chromium.launch({ headless: true });

try {
  for (const size of SIZES) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: size.width, height: size.height },
    });
    const auth = await context.request.post(`${BASE}/api/auth/login`, {
      data: { login: LOGIN, password: PASSWORD },
    });
    if (!auth.ok()) {
      check(`${size.tag}: login`, false, String(auth.status()));
      await context.close();
      continue;
    }

    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    const scale = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        sm: s.getPropertyValue("--ui-t-sm").trim(),
        measure: s.getPropertyValue("--md-measure").trim(),
      };
    });
    check(
      `${size.tag}: шкала текста`,
      scale.sm === size.expectSm,
      `--ui-t-sm=${scale.sm}, ждали ${size.expectSm}`,
    );
    const densityAttr = await page.evaluate(
      () => document.documentElement.dataset.density ?? "нет",
    );
    check(
      `${size.tag}: настройки плотности нет`,
      densityAttr === "нет",
      `data-density=${densityAttr}`,
    );

    const rows = page.locator("[data-project-row]");
    const projectCount = await rows.count();
    check(`${size.tag}: проекты видны`, projectCount > 0, `${projectCount} шт.`);
    if (projectCount === 0) {
      await context.close();
      continue;
    }

    const asideW = await page
      .locator("aside")
      .first()
      .boundingBox()
      .then((b) => (b ? Math.round(b.width) : 0));
    check(
      `${size.tag}: колонка проектов по окну`,
      size.width >= 1800 ? asideW >= 280 : asideW >= 192 && asideW <= 360,
      `${asideW}px`,
    );

    await rows.first().locator("button").first().click();
    await page.waitForTimeout(2500);

    // --- таблица замечаний ---
    const stage = page.getByRole("button", { name: /^Таблица замечаний / });
    if (await stage.count()) {
      await stage.first().click();
      await page.waitForTimeout(3000);
      const table = await page.evaluate(() => {
        const t = document.querySelector("table");
        const scroller = t?.closest(".overflow-auto");
        if (!t || !scroller) return null;
        const remark = document.querySelector("tbody tr td:nth-child(4)");
        const remarkText = remark?.querySelector(".max-w-\\[78ch\\]");
        const place = document.querySelector("tbody tr td:nth-child(5)");
        return {
          overflow: scroller.scrollWidth - scroller.clientWidth,
          fixed: getComputedStyle(t).tableLayout,
          remarkW: remark ? Math.round(remark.getBoundingClientRect().width) : 0,
          // Ширина самого текста, а не ячейки: колонка гибкая и на 2560 огромна.
          textW: remarkText
            ? Math.round(remarkText.getBoundingClientRect().width)
            : 0,
          placeW: place ? Math.round(place.getBoundingClientRect().width) : 0,
          rows: document.querySelectorAll("tbody tr").length,
        };
      });
      if (table) {
        check(
          `${size.tag}: таблица без горизонтальной прокрутки`,
          table.overflow <= 2,
          `перебор ${table.overflow}px, строк ${table.rows}`,
        );
        check(`${size.tag}: table-fixed`, table.fixed === "fixed", table.fixed);
        check(
          `${size.tag}: колонка «Замечание» читаемая`,
          table.remarkW >= 200,
          `${table.remarkW}px`,
        );
        check(
          `${size.tag}: строка замечания не тянется`,
          table.textW > 0 && table.textW <= 900,
          `текст ${table.textW}px в ячейке ${table.remarkW}px`,
        );
        check(
          `${size.tag}: «Где в ПД» шире на большом экране`,
          size.width >= 1840 ? table.placeW >= 500 : table.placeW >= 170,
          `${table.placeW}px`,
        );
      } else {
        check(`${size.tag}: таблица найдена`, false);
      }
      await page.screenshot({
        path: path.join(OUT_DIR, `prod-ui-${size.tag}-table.png`),
      });
    }

    // --- лист ---
    const sheet = page.getByRole("button", { name: /^Расшифровка / });
    if (await sheet.count()) {
      await sheet.first().click();
      await page.waitForTimeout(5000);

      const collapsed =
        (await page.getByRole("button", { name: "Показать проекты и листы" }).count()) > 0;
      check(
        `${size.tag}: дерево ${size.narrow ? "свёрнуто" : "открыто"} на листе`,
        collapsed === size.narrow,
        `свёрнуто=${collapsed}`,
      );

      const mark = page.getByRole("button", { name: "Отметить ошибку" }).first();
      if (await mark.count()) {
        const filled = await mark.evaluate((el) => {
          const bg = getComputedStyle(el).backgroundColor;
          return { bg, accent: bg.replace(/\s/g, "") === "rgb(37,99,235)" };
        });
        check(
          `${size.tag}: «Отметить ошибку» акцентная`,
          filled.accent,
          filled.bg,
        );
      } else {
        check(`${size.tag}: «Отметить ошибку» на месте`, false);
      }

      const searchHint = await page
        .locator("kbd", { hasText: "/" })
        .count();
      check(`${size.tag}: подсказка «/» у поиска`, searchHint > 0);

      const noStub = await page.getByText("PDF · DWG для сверки").count();
      check(`${size.tag}: заглушка PDF·DWG убрана`, noStub === 0);

      await page.screenshot({
        path: path.join(OUT_DIR, `prod-ui-${size.tag}-sheet.png`),
      });
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(
  `\nитог: ${checks.length - failed.length}/${checks.length} проверок прошло`,
);
if (failed.length) {
  console.log("не прошло:");
  for (const f of failed) console.log(` - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
