/**
 * PDF, на котором конвейер обязан вызвать модель (не DXF-шорткат).
 * 8 листов A2 с чертежами + сложная таблица + 15 расхождений.
 * Вектор пишется во временный файл, затем flatten-qa-vlm-force.py
 * растрирует листы (нет текстового слоя → VLM не пропускается)
 * и укладывает размер в 8–18 МБ (лимит сервера 20 МБ).
 *
 *   node scripts/build-qa-vlm-force.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PDFDocument, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "samples");
const pack = join(root, "..", "пакет-проверки-ПТО");
const pdfPath = join(dest, "qa-vlm-force-vector.pdf");
const outPdf = join(dest, "qa-vlm-force.pdf");
const errPath = join(dest, "qa-vlm-force-errors.txt");
const fontPath = "C:/Windows/Fonts/arial.ttf";
const fontBoldPath = "C:/Windows/Fonts/arialbd.ttf";
const ink = rgb(0.05, 0.06, 0.08);
const muted = rgb(0.32, 0.34, 0.38);
const thin = rgb(0.45, 0.48, 0.52);
const hatch = rgb(0.55, 0.58, 0.62);

const E = [
  ["площадь застройки принята 2450 м2", "по расчёту ПЗУ площадь равна 2180 м2"],
  ["масштаб чертежа 1:100", "в задании указан масштаб 1:200"],
  ["длина участка L=12.50 м", "по обмеру длина участка L=11.80 м"],
  ["счетчик ВСХН-20 количество 7 шт", "по заданию требуется 4 шт ВСХН-20"],
  ["отметка чистого пола +0.150", "в разрезе отметка чистого пола +0.250"],
  ["высота здания 54.00 м", "по разрезу высота здания 51.60 м"],
  ["машиномест в стилобате 86", "по расчёту требуется 72 машиноместа"],
  ["степень огнестойкости II", "в задании степень огнестойкости III"],
  ["грузоподъёмность лифта 1000 кг", "по заданию лифт 630 кг"],
  ["ввод водопровода Ду100", "по ТУ ввод водопровода Ду80"],
  ["надземных этажей 17", "в задании надземных этажей 16"],
  ["озеленение участка 28 %", "по ПЗЗ озеленение не менее 35 %"],
  ["площадь квартиры 105 равна 38.4 м2", "по обмеру квартира 105 равна 42.1 м2"],
  ["ширина лестничного марша 1.20 м", "по нормам ширина марша 1.35 м"],
  ["расчётная мощность 250 кВт", "по ТУ электроснабжения 180 кВт"],
];

const FIX = ["ПСВ", "ОП-5", "АПС", "Ду15", "220В", "Св.", "ИПР", "Кран"];
const APT = ["Студия", "1-комн.", "2-комн.", "3-комн.", "Евродвушка"];
const ROOM = [
  "Тамбур", "Вестибюль", "Охрана", "Колясочная", "Кухня-ниша", "С/у общ.",
  "Кладовая", "ИТП", "Эл.щит.", "Венткамера", "Насосная", "Узел учёта",
  "Мусорокам.", "Уборка", "Техкоридор", "Коридор",
];
const DECOY = [
  "бетон B25", "арматура A500", "утеплитель 150", "стяжка 60", "гидроизоляция",
  "окна 5К", "двери EI30", "перегородка 120", "стяжка ЦПС", "пароизоляция",
  "кровля ПВХ", "парапет 600", "ограждение 1.2", "отмостка 1000", "отмостка уклон",
  "ливнёвка Ду150", "канализация Ду100", "теплосеть Ду80", "газ не предусмотрен",
  "вент. шахта", "дымоудаление", "подпор воздуха", "ИТП узел", "ВРУ-0.4",
  "щит этажный", "лоток 200", "кабель АВВГ", "заземление", "молниезащита",
  "АПС адресная", "СОУЭ 3 тип", "ОП-5 2шт", "кран Ду50", "ПК-1",
];
const EQ = ["К1", "К2", "К3", "В1", "В2", "Т1", "Т2", "Г1", "Э1", "СС1", "П1", "П2"];

mkdirSync(dest, { recursive: true });

function wrapWords(text, max) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function buildPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(fontPath));
  const bold = await doc.embedFont(
    readFileSync(existsSync(fontBoldPath) ? fontBoldPath : fontPath),
  );

  const tools = (page) => {
    const line = (x, y, text, size = 8, isBold = false, color = ink) => {
      page.drawText(String(text), { x, y, size, font: isBold ? bold : font, color });
    };
    const hline = (x1, y1, x2, y2, thickness = 0.45, color = ink) => {
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
    };
    const box = (x, y, w, h, thickness = 0.7) => {
      page.drawRectangle({ x, y, width: w, height: h, borderColor: ink, borderWidth: thickness });
    };
    const wall = (x, y, w, h) => {
      page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.12, 0.13, 0.15) });
    };
    const hatchBox = (x, y, w, h, step = 5) => {
      box(x, y, w, h, 0.55);
      const max = w + h;
      for (let i = -h; i < max; i += step) {
        const x1 = x + Math.max(0, i);
        const y1 = y + Math.max(0, -i);
        const x2 = x + Math.min(w, i + h);
        const y2 = y + Math.min(h, w - i);
        if (x2 > x1) hline(x1, y1, x2, y2, 0.22, hatch);
      }
    };
    const door = (x, y, w, flipX = 1, flipY = 1) => {
      hline(x, y, x + w * flipX, y, 1.0);
      const steps = 6;
      for (let i = 0; i < steps; i += 1) {
        const a0 = (Math.PI / 2) * (i / steps);
        const a1 = (Math.PI / 2) * ((i + 1) / steps);
        hline(
          x + Math.cos(a0) * w * flipX,
          y + Math.sin(a0) * w * flipY,
          x + Math.cos(a1) * w * flipX,
          y + Math.sin(a1) * w * flipY,
          0.35,
          thin,
        );
      }
    };
    const window = (x, y, len, horiz = true) => {
      if (horiz) {
        hline(x, y - 1.8, x + len, y - 1.8, 0.8);
        hline(x, y + 1.8, x + len, y + 1.8, 0.8);
      } else {
        hline(x - 1.8, y, x - 1.8, y + len, 0.8);
        hline(x + 1.8, y, x + 1.8, y + len, 0.8);
      }
    };
    const axis = (x, y, label) => {
      page.drawCircle({ x, y, size: 6.2, borderColor: ink, borderWidth: 0.7 });
      line(x - (label.length > 1 ? 4 : 2), y - 2.3, label, 7, true);
    };
    const dimH = (x1, x2, y, text) => {
      hline(x1, y, x2, y, 0.4);
      hline(x1, y - 2.5, x1, y + 2.5, 0.4);
      hline(x2, y - 2.5, x2, y + 2.5, 0.4);
      line((x1 + x2) / 2 - String(text).length * 1.5, y + 2.5, text, 5.5, true);
    };
    const dimV = (y1, y2, x, text) => {
      hline(x, y1, x, y2, 0.4);
      hline(x - 2.5, y1, x + 2.5, y1, 0.4);
      hline(x - 2.5, y2, x + 2.5, y2, 0.4);
      page.drawText(String(text), {
        x: x + 3, y: (y1 + y2) / 2 - 10, size: 5.5, font: bold, color: ink, rotate: degrees(90),
      });
    };
    const fixture = (x, y, kind) => {
      page.drawCircle({ x, y, size: 2.0, borderColor: ink, borderWidth: 0.4 });
      line(x + 2.8, y - 1.2, kind, 3.6, false, thin);
    };
    const clutter = (W, H) => {
      for (let i = 0; i < 36; i += 1) {
        line(W - 250, H - 70 - i * 9, `${String(i + 1).padStart(2, "0")} ${DECOY[i % DECOY.length]}`, 4.2, false, thin);
      }
      for (let r = 0; r < 10; r += 1) {
        for (let c = 0; c < 18; c += 1) {
          const x = 28 + c * 52;
          const y = 108 - r * 8;
          if (y < 22) continue;
          line(x, y, `${EQ[(r + c) % EQ.length]}-${r + 1}${String(c + 1).padStart(2, "0")}`, 3.4, false, thin);
        }
      }
      for (let i = 0; i < 48; i += 1) {
        const x = 320 + (i % 16) * 78;
        const y = 92 - Math.floor(i / 16) * 22;
        page.drawCircle({ x, y, size: 2.4, borderColor: thin, borderWidth: 0.3 });
        line(x + 4, y - 1.4, FIX[i % FIX.length], 3.3, false, thin);
      }
    };
    const stamp = (W, H, sheetName, sheetNo, of) => {
      const sw = 220;
      const sh = 80;
      const sx = W - 28 - sw;
      const sy = 22;
      box(sx, sy, sw, sh, 1);
      hline(sx, sy + 22, sx + sw, sy + 22, 0.55);
      hline(sx, sy + 44, sx + sw, sy + 44, 0.55);
      hline(sx + 74, sy, sx + 74, sy + sh, 0.55);
      hline(sx + 148, sy, sx + 148, sy + sh, 0.55);
      line(sx + 4, sy + 66, "Объект", 5, false, muted);
      line(sx + 4, sy + 54, "Северный квартал", 7, true);
      line(sx + 78, sy + 66, "Лист", 5, false, muted);
      line(sx + 78, sy + 54, `${sheetNo}/${of}`, 8, true);
      line(sx + 152, sy + 66, "Стадия", 5, false, muted);
      line(sx + 152, sy + 54, "П", 8, true);
      line(sx + 4, sy + 32, sheetName.slice(0, 34), 6, true);
      line(sx + 152, sy + 10, "АР-ПЗУ", 7, true);
    };
    return { line, hline, box, wall, hatchBox, door, window, axis, dimH, dimV, fixture, stamp, clutter };
  };

  const TOTAL = 8;

  const PAIR = [
    "площадь застройки принята 2450 м2, по расчёту ПЗУ 2180 м2",
    "масштаб чертежа 1:100, в задании указан масштаб 1:200",
    "длина участка L=12.50 м, по обмеру L=11.80 м",
    "счетчик ВСХН-20: принято 7 шт, по заданию 4 шт",
    "отметка чистого пола +0.150, в разрезе +0.250",
    "высота здания 54.00 м, по разрезу 51.60 м",
    "машиномест в стилобате 86, по расчёту требуется 72",
    "степень огнестойкости принята II, в задании III",
    "лифт 1000 кг, по заданию 630 кг",
    "ввод водопровода принят Ду100, по ТУ Ду80",
    "надземных этажей 17, в задании 16",
    "озеленение участка 28 %, по ПЗЗ не менее 35 %",
    "площадь квартиры 105 равна 38.4 м2, по обмеру 42.1 м2",
    "ширина лестничного марша принята 1.20 м, по нормам 1.35 м",
    "расчётная мощность 250 кВт, по ТУ 180 кВт",
    "итого единиц оборудования 18 шт, сумма строк 12",
  ];
  const notesBlock = (d, x, y) => {
    d.line(x, y, "Сводка показателей листа", 7, true);
    for (let i = 0; i < PAIR.length; i += 1) {
      d.line(x, y - 10 - i * 9, `${i + 1}. ${PAIR[i]}.`, 5.5);
    }
  };

  const drawFloor = (page, variant) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.box(16, 16, W - 32, H - 32, 0.45);
    const titles = [
      "ПЛАН 1 ЭТАЖА. Блок-секции 1–3",
      "ПЛАН ТИПОВОГО ЭТАЖА (2–16). Секции 1–3",
      "ПЛАН ТЕХНИЧЕСКОГО ЭТАЖА",
      "ПЛАН ПОДВАЛА. ИТП / ВК / ЭОМ / СС",
    ];
    d.line(26, H - 34, titles[variant], 14, true);
    d.line(26, H - 50, `${PAIR[4]}. ${PAIR[10]}.`, 7, false, muted);
    d.line(980, H - 34, "N", 11, true);
    d.hline(984, H - 68, 984, H - 40, 1.1);

    const ox = 70;
    const oy = 200;
    const secW = 500;
    const names = ["1", "2", "3", "4", "5", "6", "7"];
    const letters = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "И", "К", "Л", "М", "Н", "П", "Р", "С", "Т"];

    for (let s = 0; s < 3; s += 1) {
      const sx = ox + s * secW;
      for (let i = 0; i <= 6; i += 1) {
        const x = sx + i * 78;
        d.hline(x, oy, x, oy + 620, 0.22, thin);
        d.axis(x, oy + 640, letters[(s * 6 + i) % letters.length]);
      }
      for (let i = 0; i <= 6; i += 1) {
        const y = oy + i * 103;
        d.hline(sx, y, sx + 468, y, 0.22, thin);
        if (s === 0) d.axis(ox - 28, y, names[i]);
      }
      d.wall(sx - 3, oy - 3, 474, 7);
      d.wall(sx - 3, oy + 616, 474, 7);
      d.wall(sx - 3, oy - 3, 7, 626);
      d.wall(sx + 464, oy - 3, 7, 626);

      d.box(sx + 8, oy + 258, 452, 52, 0.75);
      d.line(sx + 170, oy + 278, `КОРИДОР К${s + 1}`, 8, true);

      d.box(sx + 196, oy + 230, 48, 110, 1.2);
      for (let st = 0; st < 8; st += 1) d.hline(sx + 204, oy + 240 + st * 8, sx + 236, oy + 240 + st * 8, 0.55);
      d.line(sx + 206, oy + 322, `Л${s + 1}`, 7, true);
      d.line(sx + 206, oy + 248, PAIR[13], 4.5, true);
      d.box(sx + 250, oy + 250, 32, 40, 1.0);
      d.line(sx + 254, oy + 266, "ЛФ", 6, true);
      d.line(sx + 252, oy + 256, variant === 0 ? "1000кг" : "630кг", 4.5, true);

      const wet = new Set([2, 5, 8, 11]);
      let n = 0;
      for (const band of [
        [8, 318, 5],
        [8, 8, 5],
      ]) {
        const [bx, by, count] = band;
        for (let i = 0; i < count; i += 1) {
          if (i === 2) continue;
          const rw = 74;
          const rh = band[1] === 318 ? 292 : 242;
          const rx = sx + bx + (i < 2 ? i : i - 1) * 78;
          const ry = oy + by;
          const num = `${s + 1}${String(100 + variant * 20 + n).slice(1)}`;
          const name = variant < 2
            ? (n % 3 === 0 ? APT[(n + s + variant) % APT.length] : ROOM[(n + s * 3) % ROOM.length])
            : ROOM[(n + variant + s) % ROOM.length];
          if (wet.has(n) || name.includes("ИТП") || name.includes("С/у") || name.includes("Насос")) {
            d.hatchBox(rx, ry, rw, rh, 6);
          } else d.box(rx, ry, rw, rh, 0.8);
          d.line(rx + 3, ry + rh - 11, num, 6.5, true);
          d.line(rx + 3, ry + rh - 20, name, 5.5);
          const area = n === 2 && s === 0 && variant === 0 ? "38.4" : (22 + ((n * 7 + s * 3 + variant) % 48)) + "." + ((n + s) % 10);
          d.line(rx + 3, ry + rh - 29, `S=${area} м2`, 5, false, muted);
          if (n === 2 && s === 0 && variant === 0) {
            d.line(rx + 3, ry + rh - 38, PAIR[12], 4.5, true);
          }
          for (let k = 0; k < 16; k += 1) {
            d.fixture(rx + 6 + (k % 4) * 16, ry + 8 + Math.floor(k / 4) * 10, FIX[k % FIX.length]);
          }
          d.box(rx + rw - 22, ry + 6, 8, 10, 0.3);
          d.box(rx + rw - 12, ry + 6, 8, 14, 0.3);
          d.box(rx + 6, ry + rh - 58, 22, 10, 0.3);
          d.line(rx + 3, ry + 4, `ось ${letters[(n + s) % letters.length]}/${n + 1}`, 3.4, false, thin);
          d.door(rx + 8, band[1] === 318 ? ry : ry + rh, 12, 1, band[1] === 318 ? -1 : 1);
          n += 1;
        }
      }
      for (let w = 0; w < 5; w += 1) {
        d.window(sx + 16 + w * 90, oy + 620, 28, true);
        d.window(sx + 16 + w * 90, oy, 28, true);
      }
      d.dimH(sx, sx + 468, oy - 22, `${46 + s}.${s}00`);
    }

    d.dimH(ox, ox + 1468, oy - 48, "146 800");
    d.dimV(oy, oy + 620, ox - 48, "62 000");
    d.line(ox + 520, oy - 68, PAIR[2], 8, true);
    d.box(ox + 196, oy + 360, 220, 14, 0.45);
    d.line(ox + 200, oy + 364, PAIR[4], 5.5, true);

    d.box(26, H - 150, 360, 88, 0.55);
    d.line(30, H - 74, "ЭКСПЛИКАЦИЯ", 7, true);
    d.line(30, H - 86, PAIR[0], 6, true);
    d.line(30, H - 98, PAIR[12], 6, true);
    d.line(30, H - 110, PAIR[8], 6, true);
    d.line(30, H - 122, PAIR[13], 6, true);

    d.stamp(W, H, titles[variant], String(variant + 1), String(TOTAL));
  };

  const drawSite = (page) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.line(26, H - 34, "ГЕНПЛАН. Схема планировочной организации земельного участка", 14, true);
    d.line(26, H - 50, `${PAIR[0]}. ${PAIR[11]}. ${PAIR[6]}.`, 7, false, muted);
    const ox = 80;
    const oy = 220;
    d.box(ox, oy, 1480, 780, 1.1);
    for (let i = 0; i < 18; i += 1) d.hline(ox + i * 82, oy, ox + i * 82, oy + 780, 0.2, thin);
    for (let i = 0; i < 10; i += 1) d.hline(ox, oy + i * 86, ox + 1480, oy + i * 86, 0.2, thin);
    d.wall(ox + 280, oy + 260, 920, 14);
    d.wall(ox + 280, oy + 620, 920, 14);
    d.wall(ox + 280, oy + 260, 14, 374);
    d.wall(ox + 1186, oy + 260, 14, 374);
    d.wall(ox + 580, oy + 260, 10, 374);
    d.wall(ox + 880, oy + 260, 10, 374);
    d.line(ox + 680, oy + 430, "ЗДАНИЕ А", 16, true);
    d.line(ox + 620, oy + 410, E[0][0], 8, true);
    d.line(ox + 620, oy + 396, E[0][1], 7, false, muted);
    d.hatchBox(ox + 40, oy + 40, 200, 160, 7);
    d.line(ox + 50, oy + 180, "Озеленение", 8, true);
    d.line(ox + 50, oy + 166, PAIR[11], 6.5, true);
    for (let r = 0; r < 6; r += 1) {
      for (let c = 0; c < 14; c += 1) {
        d.box(ox + 1280 + (c % 2) * 36, oy + 40 + r * 28 + (c > 1 ? 0 : 0), 16, 10, 0.35);
      }
    }
    d.line(ox + 1280, oy + 220, PAIR[6], 7, true);
    d.box(ox + 40, oy + 640, 180, 80, 0.7);
    d.line(ox + 48, oy + 700, "Пожарный проезд", 7, true);
    d.line(ox + 48, oy + 686, PAIR[2], 7, true);
    d.dimH(ox + 280, ox + 1200, oy + 240, "92 000");
    d.dimH(ox, ox + 1480, oy - 20, PAIR[2]);
    d.stamp(W, H, "Генплан ПЗУ", "5", String(TOTAL));
  };

  const drawSection = (page) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.line(26, H - 34, "РАЗРЕЗ 1–1. По лестничной клетке Л1", 14, true);
    d.line(26, H - 50, `${PAIR[5]}. ${PAIR[10]}.`, 7, false, muted);
    const ox = 180;
    const oy = 160;
    d.hline(ox - 40, oy + 80, ox + 1280, oy + 80, 1.1);
    d.line(ox - 38, oy + 86, "земля", 6, false, muted);
    for (let f = 0; f < 18; f += 1) {
      const y = oy + 80 + f * 42;
      d.hline(ox, y, ox + 720, y, f === 0 || f === 17 ? 1.3 : 0.55);
      d.line(ox - 70, y - 2, f === 0 ? "-3.000" : f === 1 ? "+0.150" : `+${((f - 1) * 3).toFixed(3)}`, 6);
      if (f > 0 && f < 18) {
        d.box(ox + 240, y, 70, 42, 0.6);
        for (let s = 0; s < 4; s += 1) d.hline(ox + 248, y + 6 + s * 8, ox + 302, y + 6 + s * 8, 0.45);
        d.box(ox + 320, y + 6, 28, 30, 0.7);
        d.box(ox + 20, y + 8, 90, 26, 0.4);
        d.box(ox + 400, y + 8, 280, 26, 0.4);
        for (let w = 0; w < 6; w += 1) d.window(ox + 410 + w * 42, y + 34, 18, true);
      }
    }
    d.dimV(oy + 80, oy + 80 + 17 * 42, ox + 760, E[5][0]);
    d.dimV(oy + 80, oy + 80 + 16 * 42, ox + 800, E[5][1]);
    d.line(ox + 20, oy + 130, PAIR[4], 8, true);
    d.line(ox + 20, oy + 116, PAIR[10], 7, true);
    d.stamp(W, H, "Разрез 1-1", "6", String(TOTAL));
  };

  const drawFacade = (page) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.line(26, H - 34, "ФАСАД 1–3. Со стороны внутриквартального проезда", 14, true);
    d.line(26, H - 50, `${PAIR[5]}. ${PAIR[7]}.`, 7, false, muted);
    const ox = 80;
    const oy = 200;
    d.box(ox, oy, 1320, 760, 1.2);
    for (let s = 0; s < 3; s += 1) {
      const sx = ox + s * 440;
      d.hline(sx, oy, sx, oy + 760, 1.0);
      for (let f = 0; f < 17; f += 1) {
        const y = oy + 20 + f * 42;
        for (let w = 0; w < 8; w += 1) {
          d.box(sx + 20 + w * 50, y, 28, 22, 0.45);
          if (w % 3 === 0) d.hline(sx + 22 + w * 50, y + 11, sx + 46 + w * 50, y + 11, 0.3, thin);
        }
      }
      d.box(sx + 180, oy + 20, 50, 80, 1.0);
      d.line(sx + 188, oy + 56, `Л${s + 1}`, 7, true);
    }
    d.dimV(oy, oy + 760, ox + 1340, "54.00");
    d.dimV(oy, oy + 720, ox + 1370, "51.60");
    d.line(ox + 20, oy - 20, PAIR[5], 8, true);
    d.stamp(W, H, "Фасад 1-3", "7", String(TOTAL));
  };

  const drawRoofParkNode = (page, kind) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    const title = kind === 0
      ? "ПЛАН КРОВЛИ. Выходы Л1–Л3, ограждение"
      : kind === 1
        ? "ПЛАН СТИЛОБАТА. Парковка и пожарные проезды"
        : "УЗЕЛ УЧЁТА ВОДЫ. Обвязка ИТП";
    d.line(26, H - 34, title, 14, true);
    if (kind === 0) {
      d.box(80, 280, 1400, 700, 1.1);
      for (let s = 0; s < 3; s += 1) {
        d.box(160 + s * 420, 520, 80, 120, 1.2);
        d.line(170 + s * 420, 575, `Л${s + 1}`, 10, true);
        d.box(260 + s * 420, 540, 50, 50, 0.8);
        d.line(268 + s * 420, 560, "вент", 6);
      }
      for (let i = 0; i < 40; i += 1) d.box(100 + (i % 20) * 68, 320 + Math.floor(i / 20) * 80, 50, 40, 0.35);
      d.line(90, 250, E[5][0], 8, true);
      d.line(400, 250, `${E[10][0]}. ${E[10][1]}.`, 7);
    } else if (kind === 1) {
      for (let r = 0; r < 12; r += 1) {
        for (let c = 0; c < 22; c += 1) {
          d.box(70 + c * 70, 260 + r * 58, 58, 42, 0.35);
          d.line(74 + c * 70, 288 + r * 58, `${r + 1}${String(c + 1).padStart(2, "0")}`, 5);
        }
      }
      d.line(70, 240, PAIR[6], 9, true);
    } else {
      for (let i = 0; i < 10; i += 1) {
        for (let j = 0; j < 14; j += 1) {
          const x = 70 + j * 110;
          const y = 260 + i * 72;
          d.box(x, y, 96, 58, 0.45);
          page.drawCircle({ x: x + 16, y: y + 28, size: 6, borderColor: ink, borderWidth: 0.5 });
          d.line(x + 26, y + 26, `${FIX[j % FIX.length]}-${i + 1}`, 6);
          d.line(x + 6, y + 44, `поз.${i * 14 + j + 1}`, 5, true);
          if (i === 2 && j === 1) {
            d.line(x + 6, y + 8, E[3][0], 5, true);
            d.line(x + 6, y + 18, "7 шт", 5, true);
          }
          if (i === 3 && j === 1) d.line(x + 6, y + 8, E[3][1], 5, false, muted);
          if (i === 4 && j === 2) d.line(x + 6, y + 8, E[9][0], 5, true);
          if (i === 5 && j === 2) d.line(x + 6, y + 8, E[9][1], 5, false, muted);
        }
      }
    }
    d.stamp(W, H, title.slice(0, 28), String(6 + kind), String(TOTAL));
  };

  const drawTep = (page) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.box(16, 16, W - 32, H - 32, 0.45);
    d.line(26, H - 34, "ТЕХНИКО-ЭКОНОМИЧЕСКИЕ ПОКАЗАТЕЛИ. Сложная ведомость", 14, true);
    d.line(26, H - 50, "Объединённые ячейки, цветные строки. Сверять с чертежами 1–7.", 7, false, muted);

    const tx = 40;
    const ty = 1040;
    const rowH = 28;
    const cols = [50, 520, 180, 180, 140];
    const tableW = cols.reduce((a, b) => a + b, 0);
    const fill = (x, y, w, h, color) => {
      page.drawRectangle({ x, y, width: w, height: h, color });
    };
    const xs = [tx];
    for (const w of cols) xs.push(xs[xs.length - 1] + w);
    const rows = [
      { span: true, fill: rgb(0.14, 0.36, 0.66), color: rgb(1, 1, 1), cells: ["ТЕХНИКО-ЭКОНОМИЧЕСКИЕ ПОКАЗАТЕЛИ И ВЕДОМОСТЬ"] },
      { fill: rgb(0.82, 0.89, 0.97), cells: ["Поз", "Наименование", "По проекту", "По заданию", "Пом."] },
      { span: true, fill: rgb(0.9, 0.91, 0.93), cells: ["1. Площади и объёмы"] },
      { fill: rgb(1, 0.93, 0.7), cells: ["1", "площадь застройки принята 2450 м2, по расчёту ПЗУ 2180 м2", "2450", "2180", "ПЗУ"] },
      { cells: ["2", "высота здания 54.00 м, по разрезу 51.60 м", "54.00", "51.60", "фасад"] },
      { span: true, fill: rgb(0.9, 0.91, 0.93), cells: ["2. Инженерное оборудование"] },
      { fill: rgb(1, 0.84, 0.84), cells: ["3", "счетчик ВСХН-20: принято 7 шт, по заданию 4 шт", "7", "4", "ошибка"] },
      { span: true, fill: rgb(1, 0.93, 0.7), cells: ["4  ввод водопровода принят Ду100, по ТУ Ду80"] },
      { cells: ["5", "лифт 1000 кг, по заданию 630 кг", "1000", "630", "Л1"] },
      { span: true, fill: rgb(0.9, 0.91, 0.93), cells: ["3. Технико-экономические показатели"] },
      { cells: ["6", "надземных этажей 17, в задании 16", "17", "16", "ПЗ"] },
      { fill: rgb(1, 0.84, 0.84), cells: ["7", "озеленение участка 28 %, по ПЗЗ не менее 35 %", "28", "35", "норма"] },
      { cells: ["8", "расчётная мощность 250 кВт, по ТУ 180 кВт", "250", "180", "ЭОМ"] },
      { cells: ["9", "машиномест в стилобате 86, по расчёту требуется 72", "86", "72", "ПЗУ"] },
      { fill: rgb(1, 0.93, 0.7), cells: ["10", "степень огнестойкости принята II, в задании III", "II", "III", "ПЗ"] },
      { span: true, fill: rgb(1, 0.89, 0.77), cells: ["итого единиц оборудования 18 шт, сумма строк 12"] },
      { span: true, fill: rgb(0.9, 0.91, 0.93), cells: ["4. Справочные показатели (без расхождений, шум для модели)"] },
      { cells: ["11", "Площадь участка, м2", "8640", "8640", "ПЗУ"] },
      { cells: ["12", "Строительный объём, м3", "41200", "41200", "АР"] },
      { cells: ["13", "Жилая площадь, м2", "9860", "9860", "АР"] },
      { cells: ["14", "Общая площадь квартир, м2", "12440", "12440", "АР"] },
      { cells: ["15", "Число квартир", "216", "216", "ПЗ"] },
      { cells: ["16", "Детская площадка, м2", "180", "180", "ПЗУ"] },
      { cells: ["17", "Спортплощадка, м2", "240", "240", "ПЗУ"] },
      { cells: ["18", "Контейнерная, м2", "36", "36", "ПЗУ"] },
      { cells: ["19", "Нагрузка на покрытие, кПа", "2.4", "2.4", "КР"] },
      { cells: ["20", "Снеговой район", "III", "III", "КР"] },
    ];
    for (let r = 0; r < rows.length; r += 1) {
      const y = ty - (r + 1) * rowH;
      const row = rows[r];
      if (row.fill) fill(tx, y, tableW, rowH, row.fill);
      d.box(tx, y, tableW, rowH, 0.55);
      if (row.span) {
        d.line(tx + 8, y + 9, row.cells[0], 8, true, row.color || ink);
      } else {
        let x = tx;
        for (let c = 0; c < cols.length; c += 1) {
          d.hline(x, y, x, y + rowH, 0.45);
          d.line(x + 6, y + 9, row.cells[c] ?? "", 7, r === 1, row.color || ink);
          x += cols[c];
        }
      }
    }

    d.hatchBox(1220, 220, 400, 520, 6);
    d.box(1280, 380, 260, 160, 1.2);
    d.line(1320, 450, "ЗДАНИЕ А", 12, true);
    d.line(1240, 200, "ввод водопровода Ду80", 8, true);
    d.line(1240, 184, E[9][0], 7, false, muted);
    notesBlock(d, 26, 200);
    d.stamp(W, H, "ТЭП и ведомость", "8", String(TOTAL));
  };

  drawFloor(doc.addPage([1684, 1191]), 0);
  drawFloor(doc.addPage([1684, 1191]), 1);
  drawSite(doc.addPage([1684, 1191]));
  drawSection(doc.addPage([1684, 1191]));
  drawFacade(doc.addPage([1684, 1191]));
  drawRoofParkNode(doc.addPage([1684, 1191]), 1);
  drawRoofParkNode(doc.addPage([1684, 1191]), 2);
  drawTep(doc.addPage([1684, 1191]));

  const bytes = await doc.save();
  writeFileSync(pdfPath, bytes);
  return bytes;
}

const ERRORS = `Что должен найти ИИ (заложено намеренно)
Файл qa-vlm-force.pdf — 8 листов A2, растр. Модель обязана вызваться.
Сверять: нашёл / не нашёл / нашёл не то.

01  площадь застройки 2450 / 2180 м2
02  масштаб 1:100 / 1:200
03  длина L=12.50 / 11.80 м
04  ВСХН-20: 7 шт / 4 шт
05  отметка пола +0.150 / +0.250
06  высота здания 54.00 / 51.60 м
07  машиноместа 86 / 72
08  огнестойкость II / III
09  лифт 1000 / 630 кг
10  ввод Ду100 / Ду80
11  этажей 17 / 16
12  озеленение 28 % / не менее 35 %
13  квартира 105: 38.4 / 42.1 м2
14  ширина марша 1.20 / 1.35 м
15  мощность 250 / 180 кВт
16  итого оборудования 18 шт при сумме строк 12
`;

mkdirSync(dest, { recursive: true });
const pdf = await buildPdf();
writeFileSync(errPath, ERRORS);
mkdirSync(pack, { recursive: true });
for (const name of ["qa-vlm-force-errors.txt"]) {
  writeFileSync(join(pack, name), ERRORS);
}
console.log("VECTOR", pdfPath, pdf.length);

const flatten = join(root, "scripts", "flatten-qa-vlm-force.py");
const py = spawnSync("python", [flatten, pdfPath, outPdf], {
  stdio: "inherit",
  shell: true,
});
if (py.status !== 0) process.exit(py.status ?? 1);
