import { zipSync, strToU8 } from "fflate";

/**
 * Минимальный писатель XLSX на уже подключённом fflate: книга — это ZIP с
 * несколькими XML. Готовые библиотеки тянут под сотню пакетов, а на VPS с 4 ГБ
 * сборка и без того на грани.
 */

export type CellFill = "none" | "red" | "yellow" | "green";

export type Cell = {
  value: string | number;
  fill?: CellFill;
  bold?: boolean;
  wrap?: boolean;
};

export type SheetSpec = {
  name: string;
  /** Ширины колонок в символах. */
  columns: number[];
  rows: Cell[][];
  /** Закрепить первую строку. */
  freezeHeader?: boolean;
};

const FILL_ARGB: Record<Exclude<CellFill, "none">, string> = {
  red: "FFF8CBAD",
  yellow: "FFFFE699",
  green: "FFE2EFDA",
};

const FILL_ORDER: Exclude<CellFill, "none">[] = ["red", "yellow", "green"];

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Управляющие символы Excel не принимает.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Индекс стиля в cellXfs. Порядок должен совпадать с styles.xml:
 * 0 обычный, 1 жирный, 2 перенос, 3 жирный+перенос, далее заливки.
 */
function styleIndex(cell: Cell): number {
  const base = (cell.bold ? 1 : 0) + (cell.wrap ? 2 : 0);
  if (!cell.fill || cell.fill === "none") return base;
  const fillPos = FILL_ORDER.indexOf(cell.fill);
  return 4 + fillPos * 4 + base;
}

function stylesXml(): string {
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    ...FILL_ORDER.map(
      (key) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="${FILL_ARGB[key]}"/><bgColor indexed="64"/></patternFill></fill>`,
    ),
  ];

  // Для каждой заливки — те же 4 комбинации bold/wrap, что и без заливки.
  const xfs: string[] = [];
  const push = (fillId: number) => {
    // base = bold + 2*wrap — тот же порядок, что в styleIndex().
    for (const base of [0, 1, 2, 3]) {
      const bold = base % 2 === 1;
      const wrap = base >= 2;
      const applyFill = fillId > 0 ? ' applyFill="1"' : "";
      xfs.push(
        `<xf numFmtId="0" fontId="${bold ? 1 : 0}" fillId="${fillId}" borderId="1" xfId="0" applyFont="1" applyBorder="1"${applyFill} applyAlignment="1">` +
          `<alignment vertical="top"${wrap ? ' wrapText="1"' : ""}/>` +
          `</xf>`,
      );
    }
  };

  push(0);
  FILL_ORDER.forEach((_, index) => push(2 + index));

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="10"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="10"/><name val="Calibri"/></font>' +
    "</fonts>" +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    '<borders count="2"><border/>' +
    '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>' +
    '<top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border>' +
    "</borders>" +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

function sheetXml(sheet: SheetSpec): string {
  const cols = sheet.columns
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");

  const rows = sheet.rows
    .map((cells, rowIndex) => {
      const row = rowIndex + 1;
      const body = cells
        .map((cell, colIndex) => {
          const ref = `${columnName(colIndex)}${row}`;
          const style = styleIndex(cell);
          if (typeof cell.value === "number") {
            return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
          }
          const value = esc(String(cell.value ?? ""));
          if (!value) return `<c r="${ref}" s="${style}"/>`;
          return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`;
        })
        .join("");
      return `<row r="${row}">${body}</row>`;
    })
    .join("");

  const pane = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : "";

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    pane +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    "</worksheet>"
  );
}

export function buildXlsx(sheet: SheetSpec): Buffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${esc(sheet.name).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>` +
        "</workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    ),
    "xl/styles.xml": strToU8(stylesXml()),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(sheet)),
  };

  return Buffer.from(zipSync(files, { level: 6 }));
}
