/**
 * Демо-пачка ИОС4 для проверки автосборки замечаний.
 * Лист 28 — реальный, поверх свободной полосы добавлена таблица показателей
 * с несходящимся итогом. Лист 29 — те же величины с другими значениями.
 *   node scripts/build-ios4-demo.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const src = "D:\\PTO\\ИОС4_лист_28_Принципиальная_схема_отопления_Block_1_7_схема+лег.pdf";
const dest = "D:\\PTO\\пакет-проверки-ПТО";
const out = join(dest, "ИОС4-демо-листы-28-29.pdf");
const ink = rgb(0.05, 0.06, 0.08);
const muted = rgb(0.3, 0.32, 0.36);
const line = rgb(0.4, 0.43, 0.47);

mkdirSync(dest, { recursive: true });

const pdf = await PDFDocument.load(readFileSync(src));
pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(readFileSync("C:/Windows/Fonts/arial.ttf"));
const bold = await pdf.embedFont(readFileSync("C:/Windows/Fonts/arialbd.ttf"));

const sheet = pdf.getPage(0);
const { width, height } = sheet.getSize();

/** Таблица показателей: итог заложен неверным (сумма 110.2). */
const rows = [
  ["1", "Блок 1-3, административная часть", "45.2"],
  ["2", "Блок 4-5, производственная часть", "38.6"],
  ["3", "Блок 6-7, складская часть", "26.4"],
];
const totalShown = "118.0";

function table(page, top, title, notes, scaleNote) {
  const left = 90;
  const w = 700;
  const rowH = 22;
  const bodyH = rowH * (rows.length + 2);
  const notesH = 16 * notes.length + 10;
  page.drawRectangle({
    x: left,
    y: top - bodyH - notesH - 26,
    width: w,
    height: bodyH + notesH + 26,
    color: rgb(1, 1, 1),
    borderColor: line,
    borderWidth: 1,
  });
  page.drawText(title, {
    x: left + 10,
    y: top - 18,
    size: 12,
    font: bold,
    color: ink,
  });
  let y = top - 26 - rowH;
  page.drawText("№", { x: left + 12, y, size: 9.5, font: bold, color: ink });
  page.drawText("Наименование", {
    x: left + 46,
    y,
    size: 9.5,
    font: bold,
    color: ink,
  });
  page.drawText("Тепловая нагрузка, кВт", {
    x: left + 470,
    y,
    size: 9.5,
    font: bold,
    color: ink,
  });
  for (const [num, name, value] of rows) {
    y -= rowH;
    page.drawText(num, { x: left + 12, y, size: 9.5, font, color: ink });
    page.drawText(name, { x: left + 46, y, size: 9.5, font, color: ink });
    page.drawText(value, { x: left + 470, y, size: 9.5, font, color: ink });
  }
  y -= rowH;
  page.drawText("ИТОГО по системе отопления", {
    x: left + 46,
    y,
    size: 9.5,
    font: bold,
    color: ink,
  });
  page.drawText(scaleNote.total, {
    x: left + 470,
    y,
    size: 9.5,
    font: bold,
    color: ink,
  });
  y -= 18;
  for (const note of notes) {
    y -= 15;
    page.drawText(note, { x: left + 12, y, size: 9, font, color: muted });
  }
}

table(
  sheet,
  height - 30,
  "ОСНОВНЫЕ ПОКАЗАТЕЛИ СИСТЕМЫ ОТОПЛЕНИЯ",
  [
    `Тепловая нагрузка системы отопления ${totalShown} кВт`,
    "Расход теплоносителя 4.75 м3/ч",
    "Температурный график теплоносителя 95/70 °С",
    "Масштаб схемы 1:100",
  ],
  { total: totalShown },
);

// Лист 29: те же величины, другие значения — явные расхождения в комплекте.
const second = pdf.addPage([width, height]);
second.drawText("ИОС4. Лист 29. Общие данные системы отопления", {
  x: 90,
  y: height - 70,
  size: 16,
  font: bold,
  color: ink,
});
second.drawText(
  "Универсальное индустриальное здание «Industrial City» Block 1-7",
  { x: 90, y: height - 92, size: 11, font, color: muted },
);

table(
  second,
  height - 130,
  "ПОКАЗАТЕЛИ СИСТЕМЫ ОТОПЛЕНИЯ (СВОДНАЯ ТАБЛИЦА)",
  [
    "Тепловая нагрузка системы отопления 110.2 кВт",
    "Расход теплоносителя 3.95 м3/ч",
    "Температурный график теплоносителя 90/70 °С",
    "Масштаб схемы 1:200",
  ],
  { total: "110.2" },
);

const stamp = [
  "Шифр 28-ХСА-1/25-ИОС4",
  "Стадия П",
  "Лист 29",
  "Листов 6",
  "ООО «КУРСКРЕГИОНПРОЕКТ»",
];
let sy = 120;
for (const item of stamp) {
  second.drawText(item, { x: width - 420, y: sy, size: 10, font, color: ink });
  sy -= 16;
}
second.drawRectangle({
  x: width - 440,
  y: 30,
  width: 400,
  height: 110,
  borderColor: line,
  borderWidth: 1,
});

writeFileSync(out, await pdf.save());
console.log("готово:", out);
console.log("заложено: итог 118.0 против суммы 110.2; график 95/70 против 90/70;");
console.log("расход 4.75 против 3.95; масштаб 1:100 против 1:200");
