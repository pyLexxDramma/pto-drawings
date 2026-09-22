/**
 * Плотный комплект: много чертежей + 15 ошибок, < 20 МБ.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const dest = "D:\\PTO\\пакет-проверки-ПТО";
const pdfPath = join(dest, "Северный-квартал-ПЗУ.pdf");
const dxfPath = join(dest, "Северный-квартал-ПЗУ.dxf");
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
      line(sx + 78, sy + 32, E[1][0], 5.5, true);
      line(sx + 4, sy + 10, E[1][1], 5, false, muted);
      line(sx + 152, sy + 10, "АР-ПЗУ", 7, true);
    };
    return { line, hline, box, wall, hatchBox, door, window, axis, dimH, dimV, fixture, stamp };
  };

  const TOTAL = 28;

  const notesBlock = (d, x, y) => {
    d.line(x, y, "ПРИМЕЧАНИЯ. Намеренные расхождения:", 7, true);
    for (let i = 0; i < 15; i += 1) {
      d.line(x, y - 10 - i * 9, `${i + 1}. ${E[i][0]}. ${E[i][1]}.`, 5.5);
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
    d.line(26, H - 50, `${E[4][0]}. ${E[4][1]}. ${E[10][0]}. ${E[10][1]}.`, 7, false, muted);
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
      d.line(sx + 206, oy + 248, E[13][0], 4.5, true);
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
            d.line(rx + 3, ry + rh - 38, E[12][0], 4.5, true);
            d.line(rx + 3, ry + rh - 46, E[12][1], 4.2, false, muted);
          }
          for (let k = 0; k < 8; k += 1) {
            d.fixture(rx + 8 + (k % 4) * 16, ry + 8 + Math.floor(k / 4) * 12, FIX[k]);
          }
          d.box(rx + rw - 18, ry + 6, 13, 22, 0.35);
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
    d.line(ox + 520, oy - 68, E[2][0], 8, true);
    d.line(ox + 820, oy - 68, E[2][1], 7, false, muted);
    d.box(ox + 196, oy + 360, 90, 14, 0.45);
    d.line(ox + 200, oy + 364, E[4][0], 5.5, true);
    d.box(ox + 696, oy + 360, 90, 14, 0.45);
    d.line(ox + 700, oy + 364, "+0.250", 5.5, false, muted);

    d.box(26, H - 150, 260, 88, 0.55);
    d.line(30, H - 74, "ЭКСПЛИКАЦИЯ", 7, true);
    d.line(30, H - 86, E[0][0], 6, true);
    d.line(30, H - 98, E[0][1], 6, false, muted);
    d.line(30, H - 110, E[12][0], 6, true);
    d.line(30, H - 122, E[12][1], 6, false, muted);
    d.line(30, H - 134, `${E[8][0]} / ${E[8][1]}`, 5.5);

    notesBlock(d, 26, 178);
    d.stamp(W, H, titles[variant], String(variant + 1), String(TOTAL));
  };

  const drawSite = (page) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.line(26, H - 34, "ГЕНПЛАН. Схема планировочной организации земельного участка", 14, true);
    d.line(26, H - 50, `${E[0][0]}. ${E[11][0]}. ${E[6][0]}.`, 7, false, muted);
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
    d.line(ox + 50, oy + 166, E[11][0], 6.5, true);
    d.line(ox + 50, oy + 154, E[11][1], 6, false, muted);
    for (let r = 0; r < 6; r += 1) {
      for (let c = 0; c < 14; c += 1) {
        d.box(ox + 1280 + (c % 2) * 36, oy + 40 + r * 28 + (c > 1 ? 0 : 0), 16, 10, 0.35);
      }
    }
    d.line(ox + 1280, oy + 220, E[6][0], 7, true);
    d.line(ox + 1280, oy + 208, E[6][1], 6.5, false, muted);
    d.box(ox + 40, oy + 640, 180, 80, 0.7);
    d.line(ox + 48, oy + 700, "Пожарный проезд", 7, true);
    d.line(ox + 48, oy + 686, E[2][0], 7, true);
    d.line(ox + 48, oy + 672, E[2][1], 6.5, false, muted);
    d.dimH(ox + 280, ox + 1200, oy + 240, "92 000");
    d.dimH(ox, ox + 1480, oy - 20, E[2][0]);
    notesBlock(d, 26, 200);
    d.stamp(W, H, "Генплан ПЗУ", "5", String(TOTAL));
  };

  const drawSection = (page) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.line(26, H - 34, "РАЗРЕЗ 1–1. По лестничной клетке Л1", 14, true);
    d.line(26, H - 50, `${E[5][0]}. ${E[5][1]}. ${E[10][0]}.`, 7, false, muted);
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
    d.line(ox + 20, oy + 130, E[4][0], 8, true);
    d.line(ox + 20, oy + 116, E[4][1], 7, false, muted);
    d.line(ox + 20, oy + 100, E[10][0], 7, true);
    d.line(ox + 20, oy + 86, E[10][1], 7, false, muted);
    notesBlock(d, 900, 980);
    d.stamp(W, H, "Разрез 1-1", "6", String(TOTAL));
  };

  const drawFacade = (page) => {
    const d = tools(page);
    const W = 1684;
    const H = 1191;
    d.box(12, 12, W - 24, H - 24, 1.3);
    d.line(26, H - 34, "ФАСАД 1–3. Со стороны внутриквартального проезда", 14, true);
    d.line(26, H - 50, `${E[5][0]}. ${E[7][0]}. ${E[7][1]}.`, 7, false, muted);
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
    d.line(ox + 20, oy - 20, E[5][0], 8, true);
    d.line(ox + 320, oy - 20, E[5][1], 7, false, muted);
    notesBlock(d, 26, 188);
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
      d.line(70, 240, E[6][0], 9, true);
      d.line(420, 240, E[6][1], 8, false, muted);
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
    notesBlock(d, 26, 188);
    d.stamp(W, H, title.slice(0, 28), String(8 + kind), String(TOTAL));
  };

  for (let v = 0; v < 4; v += 1) {
    drawFloor(doc.addPage([1684, 1191]), v);
  }
  drawSite(doc.addPage([1684, 1191]));
  drawSection(doc.addPage([1684, 1191]));
  drawFacade(doc.addPage([1684, 1191]));
  for (let k = 0; k < 3; k += 1) drawRoofParkNode(doc.addPage([1684, 1191]), k);

  const extraPlans = [
    "ПЛАН ЭОМ. Щиты, лотки, светильники",
    "ПЛАН ВК. Стояки ХВС/ГВС/К1",
  ];
  for (let p = 0; p < extraPlans.length; p += 1) {
    const page = doc.addPage([1684, 1191]);
    const d = tools(page);
    d.box(12, 12, 1660, 1167, 1.3);
    d.line(26, 1156, extraPlans[p], 14, true);
    for (let s = 0; s < 3; s += 1) {
      const sx = 60 + s * 530;
      d.box(sx, 240, 500, 860, 0.9);
      for (let r = 0; r < 10; r += 1) {
        for (let c = 0; c < 6; c += 1) {
          const x = sx + 12 + c * 80;
          const y = 260 + r * 82;
          d.box(x, y, 72, 70, 0.4);
          d.line(x + 3, y + 58, `${s + 1}${r}${c} ${ROOM[(r + c + p) % ROOM.length]}`, 5, true);
          for (let k = 0; k < 8; k += 1) {
            d.fixture(x + 8 + (k % 4) * 15, y + 8 + Math.floor(k / 4) * 14, FIX[k]);
          }
          if (p === 0 && r === 1 && c === 1 && s === 0) d.line(x + 3, y + 46, E[14][0], 5, true);
          if (p === 0 && r === 2 && c === 1 && s === 0) d.line(x + 3, y + 46, E[14][1], 5, false, muted);
          if (p === 1 && r === 1 && c === 2 && s === 0) d.line(x + 3, y + 46, E[9][0], 5, true);
          if (p === 1 && r === 2 && c === 2 && s === 0) d.line(x + 3, y + 46, E[9][1], 5, false, muted);
        }
      }
    }
    notesBlock(d, 26, 220);
    d.stamp(1684, 1191, extraPlans[p], String(11 + p), String(TOTAL));
  }

  const longNote = [
    `Объект: МКД «Северный квартал», стадия П. ${E[10][0]}. ${E[10][1]}.`,
    `Кадастровый квартал 77:01:0004012. ${E[2][0]}. ${E[2][1]}.`,
    `Экспликация: ${E[0][0]}. ${E[0][1]}.`,
    `Высотная схема: ${E[4][0]}. ${E[4][1]}. ${E[5][0]}. ${E[5][1]}.`,
    `Пожарная безопасность: ${E[7][0]}. ${E[7][1]}. Класс Ф1.3, С0.`,
    `Конструкция: монолитный каркас, газобетон 400, минвата 150.`,
    `Вертикальный транспорт: ${E[8][0]}. ${E[8][1]}. ${E[13][0]}. ${E[13][1]}.`,
    `Парковка: ${E[6][0]}. ${E[6][1]}. Гостевых — 12.`,
    `Благоустройство: ${E[11][0]}. ${E[11][1]}.`,
    `Водоснабжение: ${E[9][0]}. ${E[9][1]}. ${E[3][0]}. ${E[3][1]}.`,
    `Электроснабжение II категория. ${E[14][0]}. ${E[14][1]}.`,
    `Квартирография: ${E[12][0]}. ${E[12][1]}.`,
    `Штампы листов: ${E[1][0]}. ${E[1][1]}.`,
    "МГН: пандус 1:12, лифт 1000 кг заявлен на плане 1 этажа.",
    "Мусороудаление — площадка на 6 баданов, радиус 100 м.",
    "Состав тома: ПЗ, ПЗУ, ГП, АР, КР, ВК, ОВ, ЭОМ, СС, ПОС, ОДИ.",
    "Фасады согласованы с АГР. Ограждение кровли 1.2 м.",
    "Пожарные проезды с двух продольных сторон, кольцевой объезд.",
    "Нагрузки по ТУ РСО. Категория надёжности ХВС — I.",
    "Контрольный комплект для конвейера ПТО и таблицы замечаний.",
  ];

  for (let sheet = 0; sheet < 6; sheet += 1) {
    const page = doc.addPage([595, 842]);
    const d = tools(page);
    d.line(36, 810, `ПОЯСНИТЕЛЬНАЯ ЗАПИСКА. Лист ${13 + sheet} из ${TOTAL}`, 12, true);
    let y = 788;
    const chunk = longNote.slice(sheet * 4, sheet * 4 + 4);
    for (let i = 0; i < 8; i += 1) {
      const para = chunk[i % 4] ?? longNote[i % longNote.length];
      d.line(36, y, `${sheet * 8 + i + 1}.`, 9, true);
      y -= 4;
      for (const row of wrapWords(para, 90)) {
        d.line(50, y, row, 8);
        y -= 11;
      }
      y -= 5;
    }
    d.line(36, 24, `Текст, лист ${13 + sheet}.`, 7, false, muted);
  }

  const EQUIP = [
    [E[3][0], "7", "Расхождение с заданием"],
    [E[3][1], "4", "Задание на проектирование"],
    [E[9][0], "1", "Ввод в здание"],
    [E[9][1], "1", "ТУ водоканала"],
    ["Счетчик ВСХН-15 Ду15", "2", "Секция 1"],
    ["Задвижка Ду100 Ру16", "4", "ИТП"],
    ["Насос К 20/30", "2", "Рабочий + резерв"],
    ["Фильтр сетчатый Ду50", "2", "Узел учёта"],
    [E[14][0], "1", "ГРЩ"],
    [E[14][1], "1", "ТУ электросетей"],
  ];

  for (let sheet = 0; sheet < 6; sheet += 1) {
    const page = doc.addPage([842, 595]);
    const d = tools(page);
    d.line(24, 568, `ВЕДОМОСТЬ. Лист ${19 + sheet} из ${TOTAL}`, 12, true);
    d.line(24, 552, `${E[3][0]}. ${E[8][0]}. ${E[14][0]}.`, 7, false, muted);
    const cols = [36, 400, 50, 280];
    const rows = 20;
    const top = 536;
    const width = cols.reduce((a, b) => a + b, 0);
    for (let r = 0; r <= rows; r += 1) d.hline(24, top - r * 22, 24 + width, top - r * 22, 0.45);
    let cx = 24;
    for (let c = 0; c <= cols.length; c += 1) {
      d.hline(cx, top, cx, top - rows * 22, 0.45);
      cx += cols[c] ?? 0;
    }
    const cell = (c, r, text, isBold = false) => {
      d.line(28 + cols.slice(0, c).reduce((a, b) => a + b, 0), top - 22 * r - 15, String(text).slice(0, 58), 7, isBold);
    };
    cell(0, 0, "Поз", true);
    cell(1, 0, "Наименование", true);
    cell(2, 0, "Кол.", true);
    cell(3, 0, "Примечание", true);
    for (let r = 1; r < rows; r += 1) {
      const base = EQUIP[(r + sheet * 3) % EQUIP.length];
      cell(0, r, String(sheet * 19 + r));
      cell(1, r, `${base[0]} · ${sheet + 1}.${r}`, r <= 4);
      cell(2, r, base[1]);
      cell(3, r, `${base[2]} · ось ${String.fromCharCode(64 + ((r % 12) + 1))}`);
    }
  }

  for (let sheet = 0; sheet < 4; sheet += 1) {
    const page = doc.addPage([595, 842]);
    const d = tools(page);
    d.line(36, 810, `СВОДКА РАСХОЖДЕНИЙ. Лист ${25 + sheet} из ${TOTAL}`, 12, true);
    let y = 786;
    const slice = E.slice(sheet * 4, sheet * 4 + 4);
    for (const [a, b] of slice.length ? slice : [E[14]]) {
      d.line(36, y, a, 9, true);
      y -= 14;
      d.line(36, y, b, 9, false, muted);
      y -= 20;
    }
    for (let i = 0; i < 9; i += 1) {
      for (let j = 0; j < 8; j += 1) {
        d.box(40 + j * 66, 40 + i * 36, 60, 30, 0.35);
        page.drawCircle({ x: 52 + j * 66, y: 54 + i * 36, size: 3, borderColor: ink, borderWidth: 0.4 });
        d.line(58 + j * 66, 52 + i * 36, FIX[j % FIX.length], 5);
      }
    }
  }

  const bytes = await doc.save();
  writeFileSync(pdfPath, bytes);
  return bytes;
}

function cp1251(text) {
  const extra = new Map([
    ["Ё", 0xa8], ["ё", 0xb8], ["«", 0xab], ["»", 0xbb],
    ["№", 0xb9], ["—", 0x97], ["–", 0x96], ["·", 0xb7], ["°", 0xb0],
  ]);
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) out[i] = code;
    else if (code >= 0x410 && code <= 0x44f) out[i] = code - 0x410 + 0xc0;
    else if (extra.has(text[i])) out[i] = extra.get(text[i]);
    else out[i] = 0x3f;
  }
  return out;
}

function buildDxf() {
  const tags = [];
  const tag = (code, value) => {
    tags.push(String(code), String(value));
  };
  const line = (x1, y1, x2, y2, layer = "0") => {
    tag(0, "LINE"); tag(8, layer);
    tag(10, x1.toFixed(2)); tag(20, y1.toFixed(2)); tag(30, "0.0");
    tag(11, x2.toFixed(2)); tag(21, y2.toFixed(2)); tag(31, "0.0");
  };
  const circle = (x, y, r, layer = "GRAPH") => {
    tag(0, "CIRCLE"); tag(8, layer);
    tag(10, x.toFixed(2)); tag(20, y.toFixed(2)); tag(30, "0.0"); tag(40, r.toFixed(2));
  };
  const rect = (x, y, w, h, layer = "GRAPH") => {
    line(x, y, x + w, y, layer);
    line(x + w, y, x + w, y + h, layer);
    line(x + w, y + h, x, y + h, layer);
    line(x, y + h, x, y, layer);
  };
  const text = (x, y, h, value, layer = "TEXT") => {
    tag(0, "TEXT"); tag(8, layer);
    tag(10, x.toFixed(2)); tag(20, y.toFixed(2)); tag(30, "0.0");
    tag(40, h.toFixed(2)); tag(1, value); tag(7, "STANDARD"); tag(72, 0);
  };

  tag(0, "SECTION"); tag(2, "HEADER");
  tag(9, "$ACADVER"); tag(1, "AC1009");
  tag(9, "$DWGCODEPAGE"); tag(3, "ANSI_1251");
  tag(9, "$INSUNITS"); tag(70, 4);
  tag(0, "ENDSEC");
  tag(0, "SECTION"); tag(2, "TABLES");
  tag(0, "TABLE"); tag(2, "LTYPE"); tag(70, 1);
  tag(0, "LTYPE"); tag(2, "CONTINUOUS"); tag(70, 64); tag(3, "Solid"); tag(72, 65); tag(73, 0); tag(40, "0.0");
  tag(0, "ENDTAB");
  tag(0, "TABLE"); tag(2, "LAYER"); tag(70, 6);
  for (const [name, color] of [["0", 7], ["WALL", 7], ["GRAPH", 7], ["DIM", 3], ["TEXT", 2], ["TABLE", 5]]) {
    tag(0, "LAYER"); tag(2, name); tag(70, 0); tag(62, color); tag(6, "CONTINUOUS");
  }
  tag(0, "ENDTAB");
  tag(0, "TABLE"); tag(2, "STYLE"); tag(70, 1);
  tag(0, "STYLE"); tag(2, "STANDARD"); tag(70, 0); tag(40, "0.0"); tag(41, "1.0"); tag(50, "0.0"); tag(71, 0); tag(42, "2.5"); tag(3, "txt"); tag(4, "");
  tag(0, "ENDTAB"); tag(0, "ENDSEC");
  tag(0, "SECTION"); tag(2, "ENTITIES");

  rect(4, 4, 1660, 1170, "GRAPH");
  text(16, 1140, 8, "PLAN 1 ETAZHA. Sekcii 1-3. Kontrolnyi komplekt PTO", "TEXT");

  const ox = 40;
  const oy = 220;
  for (let s = 0; s < 3; s += 1) {
    const sx = ox + s * 520;
    rect(sx, oy, 500, 720, "WALL");
    rect(sx + 10, oy + 330, 480, 60, "GRAPH");
    text(sx + 180, oy + 354, 4, `KORIDOR K${s + 1}`, "TEXT");
    rect(sx + 210, oy + 300, 50, 120, "WALL");
    text(sx + 220, oy + 400, 3.4, `L${s + 1}`, "TEXT");
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const x = sx + 12 + c * 96;
        const y = oy + (r < 4 ? 8 + r * 76 : 400 + (r - 4) * 76);
        rect(x, y, 90, 70, "WALL");
        text(x + 2, y + 60, 2.2, `${s + 1}${r}${c} ${ROOM[(r + c) % ROOM.length]}`, "TEXT");
        for (let k = 0; k < 8; k += 1) {
          circle(x + 8 + (k % 4) * 18, y + 8 + Math.floor(k / 4) * 14, 1.3, "GRAPH");
        }
      }
    }
  }

  for (let i = 0; i < 15; i += 1) {
    text(16, 200 - i * 11, 3.0, `${i + 1}. ${E[i][0]}. ${E[i][1]}.`, "TEXT");
  }

  const tx = 16;
  const ty = 28;
  text(tx, ty + 8, 3, "VEDOMOST", "TABLE");
  for (let r = 0; r <= 4; r += 1) line(tx, ty - r * 6, tx + 360, ty - r * 6, "TABLE");
  text(tx + 4, ty - 5, 2.2, E[3][0], "TABLE");
  text(tx + 300, ty - 5, 2.2, "7", "TABLE");
  text(tx + 4, ty - 11, 2.2, E[3][1], "TABLE");

  tag(0, "ENDSEC");
  tag(0, "EOF");
  const bytes = cp1251(tags.join("\r\n") + "\r\n");
  writeFileSync(dxfPath, bytes);
  return bytes;
}

const pdf = await buildPdf();
const dxf = buildDxf();
console.log("PDF", pdf.length, "DXF", dxf.length);
