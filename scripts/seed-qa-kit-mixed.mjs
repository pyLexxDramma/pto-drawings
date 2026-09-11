/**
 * Комплект для проверки подсветки: PDF (3 листа) + DXF (1 лист).
 * В каждом файле есть текст, таблица и чертёж, и в обоих — одни и те же
 * намеренные ошибки. После загрузки замечания приходят ингестом (origin ai),
 * если известен PTO_INGEST_TOKEN прода, иначе создаются от инженера.
 *
 *   node scripts/seed-qa-kit-mixed.mjs                     # собрать + загрузить + засеять
 *   node scripts/seed-qa-kit-mixed.mjs --build             # только файлы в samples/
 *   node scripts/seed-qa-kit-mixed.mjs --project=<id>      # в готовый проект
 *   node scripts/seed-qa-kit-mixed.mjs --reviews-only --project=<id> --pdf=<id> --cad=<id>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "samples");
const pdfFile = join(outDir, "qa-kit-mixed.pdf");
const dxfFile = join(outDir, "qa-kit-mixed.dxf");
const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";
const fontPath = "C:/Windows/Fonts/arial.ttf";
const fontBoldPath = "C:/Windows/Fonts/arialbd.ttf";
const ink = rgb(0.08, 0.09, 0.12);
const muted = rgb(0.35, 0.38, 0.42);
const buildOnly = process.argv.includes("--build");
const reviewsOnly = process.argv.includes("--reviews-only");
/** Аргументы важнее окружения: иначе прошлый PTO_PROJECT_ID уводит в другой проект. */
const arg = (name) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};

mkdirSync(outDir, { recursive: true });

/**
 * Цитаты замечаний. Каждая строка встречается дословно и в текстовом слое PDF,
 * и в TEXT-объектах DXF — иначе подсветка «Где в ПД» не найдёт место.
 */
const Q = {
  area: "площадь застройки принята 2450 м2",
  areaCalc: "по расчёту ПЗУ площадь равна 2180 м2",
  scale: "масштаб чертежа 1:100",
  scaleTask: "в задании указан масштаб 1:200",
  dim: "длина участка L=12.50 м",
  dimSurvey: "по обмеру длина участка L=11.80 м",
  qty: "счетчик ВСХН-20 количество 7 шт",
  qtyTask: "по заданию требуется 4 шт ВСХН-20",
  level: "отметка чистого пола +0.150",
  levelCut: "в разрезе отметка чистого пола +0.250",
};

// ----------------------------------------------------------------------- PDF

async function buildPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(fontPath));
  const bold = await doc.embedFont(
    readFileSync(existsSync(fontBoldPath) ? fontBoldPath : fontPath),
  );

  const writer = (page, x0, startY) => {
    let y = startY;
    return {
      line(text, size = 10, isBold = false, color = ink, dx = 0) {
        if (text) {
          page.drawText(text, {
            x: x0 + dx,
            y,
            size,
            font: isBold ? bold : font,
            color,
          });
        }
        y -= size + 6;
      },
      gap(px = 8) {
        y -= px;
      },
      get y() {
        return y;
      },
    };
  };

  const grid = (page, x, yTop, colWidths, rowH, rows) => {
    const width = colWidths.reduce((a, b) => a + b, 0);
    for (let r = 0; r <= rows; r += 1) {
      page.drawLine({
        start: { x, y: yTop - r * rowH },
        end: { x: x + width, y: yTop - r * rowH },
        thickness: 0.7,
        color: ink,
      });
    }
    let cx = x;
    for (let c = 0; c <= colWidths.length; c += 1) {
      page.drawLine({
        start: { x: cx, y: yTop },
        end: { x: cx, y: yTop - rows * rowH },
        thickness: 0.7,
        color: ink,
      });
      cx += colWidths[c] ?? 0;
    }
  };

  const cell = (page, x, y, text, size = 9, isBold = false) => {
    page.drawText(text, {
      x,
      y,
      size,
      font: isBold ? bold : font,
      color: ink,
    });
  };

  // —— Лист 1: текст + экспликация + схема ——
  {
    const page = doc.addPage([595, 842]);
    const w = writer(page, 44, 800);
    w.line("ПОЯСНИТЕЛЬНАЯ ЗАПИСКА. Раздел ПЗУ. Лист 1", 14, true);
    w.line("Объект: жилой дом «Северный квартал», стадия П", 10, false, muted);
    w.gap();
    w.line("1. Общие сведения", 11, true);
    w.line("Участок расположен в границах кадастрового квартала.", 10);
    w.line("Планировка выполнена по заданию на проектирование от 12.03.2026.", 10);
    w.gap();
    w.line("2. Площадь застройки", 11, true);
    w.line(`Согласно экспликации ${Q.area}.`, 10);
    w.line(`При этом ${Q.areaCalc}.`, 10);
    w.line("Расхождение не устранено — требуется согласование с ГИПом.", 10, false, muted);
    w.gap();
    w.line("3. Высотная привязка", 11, true);
    w.line(`На плане ${Q.level}.`, 10);
    w.line(`Однако ${Q.levelCut}.`, 10);
    w.gap(6);

    const tableTop = w.y - 6;
    grid(page, 44, tableTop, [220, 110, 130], 18, 4);
    cell(page, 50, tableTop - 13, "Наименование показателя", 9, true);
    cell(page, 276, tableTop - 13, "Экспликация", 9, true);
    cell(page, 392, tableTop - 13, "Расчёт ПЗУ", 9, true);
    cell(page, 50, tableTop - 31, "Площадь застройки, м2", 9);
    cell(page, 276, tableTop - 31, "2450", 9);
    cell(page, 392, tableTop - 31, "2180", 9);
    cell(page, 50, tableTop - 49, "Отметка чистого пола", 9);
    cell(page, 276, tableTop - 49, "+0.150", 9);
    cell(page, 392, tableTop - 49, "+0.250", 9);
    cell(page, 50, tableTop - 67, "Масштаб основного чертежа", 9);
    cell(page, 276, tableTop - 67, "1:100", 9);
    cell(page, 392, tableTop - 67, "1:200", 9);

    // Схема к записке
    const sy = tableTop - 100;
    page.drawRectangle({
      x: 44,
      y: sy - 150,
      width: 507,
      height: 150,
      borderColor: ink,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x: 120,
      y: sy - 120,
      width: 250,
      height: 90,
      borderColor: ink,
      borderWidth: 1.4,
    });
    cell(page, 200, sy - 80, "ЗДАНИЕ А", 11, true);
    cell(page, 130, sy - 138, Q.dim, 9, true);
    cell(page, 300, sy - 138, Q.dimSurvey, 8);
    cell(page, 400, sy - 60, "схема · без масштаба", 8);
    cell(page, 44, sy - 168, "Конец листа 1. Классификатор: text.", 8);
  }

  // —— Лист 2: чертёж + штамп + примечания ——
  {
    const page = doc.addPage([842, 595]);
    const { width, height } = page.getSize();
    page.drawRectangle({
      x: 20,
      y: 20,
      width: width - 40,
      height: height - 40,
      borderColor: ink,
      borderWidth: 1.2,
    });
    const axes = [
      [70, 110, 700, 110],
      [70, 110, 70, 470],
      [700, 110, 700, 470],
      [70, 470, 700, 470],
    ];
    for (const [x1, y1, x2, y2] of axes) {
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: 1,
        color: ink,
      });
    }
    page.drawRectangle({
      x: 150,
      y: 190,
      width: 420,
      height: 220,
      borderColor: ink,
      borderWidth: 1.6,
    });
    page.drawText("ЗДАНИЕ А", {
      x: 300,
      y: 300,
      size: 16,
      font: bold,
      color: ink,
    });
    page.drawText(Q.dim, { x: 240, y: 160, size: 12, font: bold, color: ink });
    page.drawText(Q.dimSurvey, { x: 240, y: 142, size: 9, font, color: muted });
    page.drawText(Q.level, { x: 240, y: 424, size: 11, font: bold, color: ink });
    page.drawText(Q.levelCut, { x: 430, y: 424, size: 9, font, color: muted });

    // Штамп-таблица
    const sx = width - 300;
    const sy = 140;
    for (let r = 0; r <= 4; r += 1) {
      page.drawLine({
        start: { x: sx, y: sy - r * 22 },
        end: { x: sx + 260, y: sy - r * 22 },
        thickness: 0.8,
        color: ink,
      });
    }
    for (const cx of [sx, sx + 130, sx + 260]) {
      page.drawLine({
        start: { x: cx, y: sy },
        end: { x: cx, y: sy - 88 },
        thickness: 0.8,
        color: ink,
      });
    }
    page.drawText("Штамп листа", { x: sx + 6, y: sy + 8, size: 9, font: bold, color: ink });
    page.drawText("Масштаб", { x: sx + 6, y: sy - 15, size: 9, font, color: ink });
    page.drawText(Q.scale, { x: sx + 136, y: sy - 15, size: 9, font: bold, color: ink });
    page.drawText("По заданию", { x: sx + 6, y: sy - 37, size: 9, font, color: ink });
    page.drawText(Q.scaleTask, { x: sx + 136, y: sy - 37, size: 8, font, color: muted });
    page.drawText("Ведомость", { x: sx + 6, y: sy - 59, size: 9, font, color: ink });
    page.drawText(Q.qty, { x: sx + 136, y: sy - 59, size: 8, font, color: ink });
    page.drawText("По заданию", { x: sx + 6, y: sy - 81, size: 9, font, color: ink });
    page.drawText(Q.qtyTask, { x: sx + 136, y: sy - 81, size: 8, font, color: muted });
    page.drawText("Лист 2 · генплан · drawing", { x: 30, y: 34, size: 9, font, color: muted });
  }

  // —— Лист 3: ведомость + примечания + фрагмент схемы ——
  {
    const page = doc.addPage([842, 595]);
    const { height } = page.getSize();
    const w = writer(page, 36, height - 40);
    w.line("ВЕДОМОСТЬ ОБОРУДОВАНИЯ. Водоснабжение. Лист 3", 13, true);
    w.line("Объект: жилой дом «Северный квартал». Стадия П.", 9, false, muted);
    w.gap(10);

    const top = w.y;
    const cols = [46, 380, 60, 240];
    grid(page, 36, top, cols, 20, 6);
    const rowY = (r) => top - 20 * r - 14;
    cell(page, 44, rowY(0), "Поз", 9, true);
    cell(page, 96, rowY(0), "Наименование и техническая характеристика", 9, true);
    cell(page, 482, rowY(0), "Кол.", 9, true);
    cell(page, 548, rowY(0), "Примечание", 9, true);
    cell(page, 50, rowY(1), "1", 9);
    cell(page, 96, rowY(1), "Счетчик холодной воды ВСХН-15 Ду15", 9);
    cell(page, 490, rowY(1), "2", 9);
    cell(page, 548, rowY(1), "Подвал, блок-секция 1", 9);
    cell(page, 50, rowY(2), "2", 9);
    cell(page, 96, rowY(2), Q.qty, 9, true);
    cell(page, 490, rowY(2), "7", 9);
    cell(page, 548, rowY(2), "Расхождение с заданием", 9);
    cell(page, 50, rowY(3), "3", 9);
    cell(page, 96, rowY(3), "Счетчик холодной воды ВСХН-40 Ду40", 9);
    cell(page, 490, rowY(3), "1", 9);
    cell(page, 548, rowY(3), "ИТП", 9);
    cell(page, 50, rowY(4), "4", 9);
    cell(page, 96, rowY(4), "Задвижка клиновая Ду100 Ру16", 9);
    cell(page, 490, rowY(4), "4", 9);
    cell(page, 548, rowY(4), "Ввод в здание", 9);
    cell(page, 50, rowY(5), "5", 9);
    cell(page, 96, rowY(5), "Фильтр сетчатый Ду50", 9);
    cell(page, 490, rowY(5), "2", 9);
    cell(page, 548, rowY(5), "Узел учёта", 9);

    const notesTop = top - 20 * 6 - 24;
    const n = writer(page, 36, notesTop);
    n.line("Примечания", 11, true);
    n.line(`1. К поз.2: ${Q.qtyTask}.`, 10);
    n.line(`2. Площадь застройки в записке: ${Q.area}, тогда как ${Q.areaCalc}.`, 10);
    n.line(`3. Высотная привязка: ${Q.level}, а ${Q.levelCut}.`, 10);
    n.line(`4. Штамп: ${Q.scale}, при этом ${Q.scaleTask}.`, 10);
    n.line("Конец листа 3. Классификатор: table.", 8, false, muted);

    page.drawRectangle({
      x: 600,
      y: 60,
      width: 200,
      height: 130,
      borderColor: ink,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x: 640,
      y: 90,
      width: 120,
      height: 70,
      borderColor: ink,
      borderWidth: 1.4,
    });
    cell(page, 660, rowY(0) - 320, "фрагмент схемы узла", 8);
  }

  const bytes = await doc.save();
  writeFileSync(pdfFile, bytes);
  console.log("PDF:", pdfFile, bytes.length, "байт");
  return bytes;
}

// ----------------------------------------------------------------------- DXF

/** DXF R12 пишем в cp1251 — так ezdxf на конвейере прочитает кириллицу. */
const CP1251_EXTRA = new Map([
  ["Ё", 0xa8],
  ["ё", 0xb8],
  ["«", 0xab],
  ["»", 0xbb],
  ["№", 0xb9],
  ["—", 0x97],
  ["–", 0x96],
  ["·", 0xb7],
  ["°", 0xb0],
]);

function cp1251(text) {
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code < 0x80) out[i] = code;
    else if (code >= 0x410 && code <= 0x44f) out[i] = code - 0x410 + 0xc0;
    else if (CP1251_EXTRA.has(ch)) out[i] = CP1251_EXTRA.get(ch);
    else out[i] = 0x3f;
  }
  return out;
}

function buildDxf() {
  const tags = [];
  const tag = (code, value) => {
    tags.push(String(code));
    tags.push(String(value));
  };
  const line = (x1, y1, x2, y2, layer = "0") => {
    tag(0, "LINE");
    tag(8, layer);
    tag(10, x1.toFixed(2));
    tag(20, y1.toFixed(2));
    tag(30, "0.0");
    tag(11, x2.toFixed(2));
    tag(21, y2.toFixed(2));
    tag(31, "0.0");
  };
  const rect = (x, y, w, h, layer = "0") => {
    line(x, y, x + w, y, layer);
    line(x + w, y, x + w, y + h, layer);
    line(x + w, y + h, x, y + h, layer);
    line(x, y + h, x, y, layer);
  };
  const text = (x, y, height, value, layer = "TEXT") => {
    tag(0, "TEXT");
    tag(8, layer);
    tag(10, x.toFixed(2));
    tag(20, y.toFixed(2));
    tag(30, "0.0");
    tag(40, height.toFixed(2));
    tag(1, value);
    tag(7, "STANDARD");
    tag(72, 0);
  };

  tag(0, "SECTION");
  tag(2, "HEADER");
  tag(9, "$ACADVER");
  tag(1, "AC1009");
  tag(9, "$DWGCODEPAGE");
  tag(3, "ANSI_1251");
  tag(9, "$INSUNITS");
  tag(70, 4);
  tag(9, "$EXTMIN");
  tag(10, "0.0");
  tag(20, "0.0");
  tag(30, "0.0");
  tag(9, "$EXTMAX");
  tag(10, "420.0");
  tag(20, "297.0");
  tag(30, "0.0");
  tag(0, "ENDSEC");

  tag(0, "SECTION");
  tag(2, "TABLES");
  tag(0, "TABLE");
  tag(2, "LTYPE");
  tag(70, 1);
  tag(0, "LTYPE");
  tag(2, "CONTINUOUS");
  tag(70, 64);
  tag(3, "Solid line");
  tag(72, 65);
  tag(73, 0);
  tag(40, "0.0");
  tag(0, "ENDTAB");
  tag(0, "TABLE");
  tag(2, "LAYER");
  tag(70, 4);
  for (const [name, color] of [
    ["0", 7],
    ["GRAPH", 7],
    ["DIM", 3],
    ["TEXT", 2],
    ["TABLE", 5],
  ]) {
    tag(0, "LAYER");
    tag(2, name);
    tag(70, 0);
    tag(62, color);
    tag(6, "CONTINUOUS");
  }
  tag(0, "ENDTAB");
  tag(0, "TABLE");
  tag(2, "STYLE");
  tag(70, 1);
  tag(0, "STYLE");
  tag(2, "STANDARD");
  tag(70, 0);
  tag(40, "0.0");
  tag(41, "1.0");
  tag(50, "0.0");
  tag(71, 0);
  tag(42, "2.5");
  tag(3, "txt");
  tag(4, "");
  tag(0, "ENDTAB");
  tag(0, "ENDSEC");

  tag(0, "SECTION");
  tag(2, "ENTITIES");

  // Рамка листа и основная надпись
  rect(5, 5, 410, 287, "GRAPH");
  rect(10, 10, 400, 277, "GRAPH");

  // —— Зона чертежа: здание, оси, размеры ——
  rect(30, 120, 230, 130, "GRAPH");
  rect(60, 150, 170, 80, "GRAPH");
  line(30, 110, 260, 110, "DIM");
  line(30, 106, 30, 114, "DIM");
  line(260, 106, 260, 114, "DIM");
  text(40, 240, 6, "ГЕНПЛАН УЧАСТКА. ЗДАНИЕ А", "TEXT");
  text(110, 185, 5, "ЗДАНИЕ А", "TEXT");
  text(70, 98, 3.5, Q.dim, "DIM");
  text(70, 90, 2.5, Q.dimSurvey, "DIM");
  text(150, 255, 3.5, Q.level, "DIM");
  text(150, 248, 2.5, Q.levelCut, "DIM");

  // —— Зона примечаний (текст) ——
  text(30, 78, 3.5, "ПРИМЕЧАНИЯ:", "TEXT");
  text(30, 70, 2.5, `1. Согласно экспликации ${Q.area}.`, "TEXT");
  text(30, 63, 2.5, `2. При этом ${Q.areaCalc}.`, "TEXT");
  text(30, 56, 2.5, "3. Расхождение не устранено, требуется согласование с ГИПом.", "TEXT");
  text(30, 49, 2.5, `4. По ведомости ${Q.qty}.`, "TEXT");
  text(30, 42, 2.5, `5. Однако ${Q.qtyTask}.`, "TEXT");

  // —— Зона таблицы: ведомость оборудования ——
  const tx = 275;
  const ty = 250;
  const rowH = 9;
  const colW = [12, 78, 14, 26];
  const tableW = colW.reduce((a, b) => a + b, 0);
  for (let r = 0; r <= 6; r += 1) {
    line(tx, ty - r * rowH, tx + tableW, ty - r * rowH, "TABLE");
  }
  let cx = tx;
  for (let c = 0; c <= colW.length; c += 1) {
    line(cx, ty, cx, ty - 6 * rowH, "TABLE");
    cx += colW[c] ?? 0;
  }
  const cellText = (col, row, value, height = 2.2) => {
    const x = tx + colW.slice(0, col).reduce((a, b) => a + b, 0) + 1.5;
    text(x, ty - row * rowH - rowH + 2.5, height, value, "TABLE");
  };
  text(tx, ty + 4, 3.5, "ВЕДОМОСТЬ ОБОРУДОВАНИЯ", "TABLE");
  cellText(0, 1, "Поз", 2.4);
  cellText(1, 1, "Наименование", 2.4);
  cellText(2, 1, "Кол", 2.4);
  cellText(3, 1, "Примечание", 2.4);
  cellText(0, 2, "1");
  cellText(1, 2, "Счетчик холодной воды ВСХН-15 Ду15");
  cellText(2, 2, "2");
  cellText(3, 2, "Подвал");
  cellText(0, 3, "2");
  cellText(1, 3, Q.qty);
  cellText(2, 3, "7");
  cellText(3, 3, "Ошибка");
  cellText(0, 4, "3");
  cellText(1, 4, "Счетчик холодной воды ВСХН-40 Ду40");
  cellText(2, 4, "1");
  cellText(3, 4, "ИТП");
  cellText(0, 5, "4");
  cellText(1, 5, "Задвижка клиновая Ду100 Ру16");
  cellText(2, 5, "4");
  cellText(3, 5, "Ввод");
  cellText(0, 6, "5");
  cellText(1, 6, Q.qtyTask);
  cellText(2, 6, "4");
  cellText(3, 6, "По заданию");

  // —— Основная надпись (штамп) ——
  const sx = 275;
  const sy = 20;
  rect(sx, sy, 130, 40, "GRAPH");
  line(sx, sy + 13, sx + 130, sy + 13, "GRAPH");
  line(sx, sy + 26, sx + 130, sy + 26, "GRAPH");
  line(sx + 55, sy, sx + 55, sy + 40, "GRAPH");
  text(sx + 2, sy + 30, 2.6, "Объект", "TEXT");
  text(sx + 58, sy + 30, 2.6, "Жилой дом Северный квартал", "TEXT");
  text(sx + 2, sy + 17, 2.6, "Масштаб", "TEXT");
  text(sx + 58, sy + 17, 2.8, Q.scale, "TEXT");
  text(sx + 2, sy + 4, 2.4, "По заданию", "TEXT");
  text(sx + 58, sy + 4, 2.4, Q.scaleTask, "TEXT");

  tag(0, "ENDSEC");
  tag(0, "EOF");

  const body = tags.join("\r\n") + "\r\n";
  const bytes = cp1251(body);
  writeFileSync(dxfFile, bytes);
  console.log("DXF:", dxfFile, bytes.length, "байт");
  return bytes;
}

// ------------------------------------------------------------------- API часть

async function fetchRetry(url, init = {}, tries = 6) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      last = err;
      console.log(`retry ${i + 1}/${tries}:`, err?.cause?.code || err.message);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

function cookieFromSetCookie(headers) {
  const raw = headers.getSetCookie?.() || [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = headers.get("set-cookie");
  if (!single) return "";
  return single
    .split(",")
    .map((p) => p.split(";")[0].trim())
    .filter((p) => p.includes("="))
    .join("; ");
}

async function login() {
  const res = await fetchRetry(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `login ${res.status}`);
  const cookie = cookieFromSetCookie(res.headers);
  if (!cookie) throw new Error("нет cookie сессии");
  return cookie;
}

async function api(cookie, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("cookie", cookie);
  const res = await fetchRetry(`${base}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${path} ${res.status}`);
  return body;
}

async function ensureProject(cookie) {
  const { projects } = await api(cookie, "/api/projects");
  const existing = projects.find((p) => p.name === "QA комплект PDF+DWG");
  if (existing) return existing.id;
  const created = await api(cookie, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "QA комплект PDF+DWG",
      description:
        "Текст, таблица и чертёж в PDF и DXF с одинаковыми ошибками — для проверки подсветки",
    }),
  });
  return created.project.id;
}

async function uploadKit(cookie, projectId, pdfBytes, dxfBytes) {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("title", "QA комплект PDF+DWG");
  form.append(
    "pdf",
    new Blob([pdfBytes], { type: "application/pdf" }),
    "qa-kit-mixed.pdf",
  );
  form.append(
    "cad",
    new Blob([dxfBytes], { type: "application/dxf" }),
    "qa-kit-mixed.dxf",
  );
  return api(cookie, "/api/documents/kit", { method: "POST", body: form });
}

async function waitDone(cookie, docId, label) {
  for (let i = 0; i < 150; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const { document } = await api(cookie, `/api/documents/${docId}`);
    const pages = document.pages?.length || 0;
    console.log(
      `… ${label}: ${document.status} шаг=${document.processingStep ?? "-"} листов=${pages}/${document.pageCount}`,
    );
    if (document.status === "done" && pages >= 1) return document;
    if (document.status === "error") {
      console.log(`!! ${label}: ${document.errorMessage || "ошибка обработки"}`);
      return document;
    }
  }
  throw new Error(`таймаут обработки ${label}`);
}

function reviewItems(pdfDoc, cadDoc) {
  const loc = (doc, pageNumber, quote) =>
    doc
      ? [{ documentId: doc.id, documentName: doc.originalName, pageNumber, quote }]
      : [];
  const cadPages = Math.max(cadDoc?.pageCount ?? 0, 1);
  const cadPage = (n) => Math.min(n, cadPages);

  return [
    {
      section: "ПЗУ",
      severity: "high",
      aiFinding: `В записке ${Q.area}, а ${Q.areaCalc} — расхождение 270 м2.`,
      text: "Расхождение площади застройки между экспликацией и расчётом ПЗУ.",
      locations: [
        ...loc(pdfDoc, 1, Q.area),
        ...loc(cadDoc, cadPage(1), Q.area),
      ],
    },
    {
      section: "ГП",
      severity: "high",
      aiFinding: `В штампе ${Q.scale}, при этом ${Q.scaleTask}.`,
      text: "Масштаб чертежа не соответствует заданию на проектирование.",
      locations: [
        ...loc(pdfDoc, 2, Q.scale),
        ...loc(cadDoc, cadPage(1), Q.scale),
      ],
    },
    {
      section: "ГП",
      severity: "medium",
      aiFinding: `Размер на чертеже ${Q.dim}, а ${Q.dimSurvey}.`,
      text: "Длина участка на чертеже расходится с обмером.",
      locations: [
        ...loc(pdfDoc, 2, Q.dim),
        ...loc(cadDoc, cadPage(1), Q.dim),
      ],
    },
    {
      section: "АР",
      severity: "medium",
      aiFinding: `На плане ${Q.level}, а ${Q.levelCut}.`,
      text: "Отметка чистого пола не совпадает с разрезом.",
      locations: [
        ...loc(pdfDoc, 1, Q.level),
        ...loc(cadDoc, cadPage(1), Q.level),
      ],
    },
    {
      section: "ВК",
      severity: "high",
      aiFinding: `В ведомости ${Q.qty}, но ${Q.qtyTask}.`,
      text: "Количество счётчиков ВСХН-20 завышено против задания.",
      locations: [
        ...loc(pdfDoc, 3, Q.qty),
        ...loc(cadDoc, cadPage(1), Q.qty),
      ],
    },
  ];
}

/** Сначала пробуем ингест (замечания будут «от ИИ»), иначе — от инженера. */
async function publishReviews(cookie, projectId, items) {
  const token = process.env.PTO_INGEST_TOKEN || "";
  if (token) {
    const res = await fetchRetry(`${base}/api/projects/${projectId}/reviews`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reviews: items.map((item) => ({ ...item, origin: "ai" })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log("Ингест ИИ:", JSON.stringify(body));
      return "ai";
    }
    console.log(`Ингест недоступен (${res.status}: ${body.error || ""}) — пишем от инженера`);
  }
  for (const item of items) {
    const { review } = await api(cookie, `/api/projects/${projectId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: item.section,
        severity: item.severity,
        text: item.text,
        locations: item.locations,
      }),
    });
    console.log("Замечание", review.number, review.section);
  }
  return "engineer";
}

// ------------------------------------------------------------------------ run

if (!reviewsOnly) {
  const pdfBytes = await buildPdf();
  const dxfBytes = buildDxf();
  if (buildOnly) {
    console.log("Только сборка файлов — загрузка пропущена.");
    process.exit(0);
  }
  globalThis.__kitBytes = { pdfBytes, dxfBytes };
}

const cookie = await login();
console.log("Вход:", LOGIN);

let projectId = arg("project");
let pdfId = arg("pdf");
let cadId = arg("cad");

if (!projectId) projectId = await ensureProject(cookie);
console.log("Проект:", projectId);

if (!reviewsOnly) {
  const { pdfBytes, dxfBytes } = globalThis.__kitBytes;
  const uploaded = await uploadKit(cookie, projectId, pdfBytes, dxfBytes);
  const docs = uploaded.documents || [];
  pdfId = docs.find((d) => /\.pdf$/i.test(d.originalName))?.id ?? "";
  cadId = docs.find((d) => /\.(dxf|dwg)$/i.test(d.originalName))?.id ?? "";
  console.log("Комплект:", uploaded.kitId, "pdf:", pdfId, "cad:", cadId);
}

const pdfDoc = pdfId ? await waitDone(cookie, pdfId, "PDF") : null;
const cadDoc = cadId ? await waitDone(cookie, cadId, "DXF") : null;
console.log(
  "Листы PDF:",
  (pdfDoc?.pages || []).map((p) => `${p.pageNumber}:${p.kind}`).join(", ") || "-",
);
console.log(
  "Листы DXF:",
  (cadDoc?.pages || []).map((p) => `${p.pageNumber}:${p.kind}`).join(", ") || "-",
);

// Дать конвейеру шанс прислать свои замечания.
if (!reviewsOnly) await new Promise((r) => setTimeout(r, 5000));

const items = reviewItems(
  pdfDoc?.status === "done" ? pdfDoc : null,
  cadDoc?.status === "done" ? cadDoc : null,
);
const before = await api(cookie, `/api/projects/${projectId}/reviews`);
const existing = before.reviews || [];
const mine = new Set(
  existing.flatMap((r) =>
    (r.locations || [])
      .filter((l) => l.documentId === pdfId || l.documentId === cadId)
      .map((l) => l.quote),
  ),
);
const fresh = items.filter((item) => !item.locations.some((l) => mine.has(l.quote)));
console.log(`Замечаний в проекте: ${existing.length}, к добавлению: ${fresh.length}`);

let origin = "уже были";
if (fresh.length > 0) origin = await publishReviews(cookie, projectId, fresh);

const after = await api(cookie, `/api/projects/${projectId}/reviews`);
console.log(`Замечаний в таблице: ${(after.reviews || []).length} (источник: ${origin})`);
console.log(`${base}/?project=${projectId}&doc=${pdfId}&page=1`);
