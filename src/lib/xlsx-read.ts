import { strFromU8, unzipSync } from "fflate";

/** Первая таблица книги → ряды строк. Без внешних xlsx-пакетов. */

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  }
  return Math.max(0, n - 1);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function innerText(xml: string): string {
  return decodeXml(xml.replace(/<[^>]+>/g, "")).trim();
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const blocks = xml.match(/<si\b[\s\S]*?<\/si>/g) ?? [];
  for (const block of blocks) {
    const parts = [...block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    out.push(decodeXml(parts.map((item) => item[1]).join("")).trim());
  }
  return out;
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  const rowBlocks = xml.match(/<row\b[\s\S]*?<\/row>/g) ?? [];
  for (const rowXml of rowBlocks) {
    const cells = [...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)];
    const line: string[] = [];
    for (const match of cells) {
      const attrs = match[1] ?? match[3] ?? "";
      const body = match[2] ?? "";
      const ref = /r="([A-Z]+[0-9]+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "inlineStr") {
        value = innerText(body);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (type === "s") {
          const index = Number(raw);
          value = Number.isFinite(index) ? (strings[index] ?? "") : "";
        } else {
          value = decodeXml(raw).trim();
        }
      }
      line[columnIndex(ref)] = value;
    }
    const width = line.length;
    const filled = Array.from({ length: width }, (_, i) => line[i] ?? "");
    if (filled.some((cell) => cell.trim())) rows.push(filled);
  }
  return rows;
}

export function readXlsxRows(data: Uint8Array): string[][] {
  const files = unzipSync(data);
  const names = Object.keys(files);
  const sharedName = names.find((name) => /sharedStrings\.xml$/i.test(name));
  const sheetName =
    names.find((name) => /worksheets\/sheet1\.xml$/i.test(name)) ??
    names.find((name) => /worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetName) throw new Error("В файле нет листа Excel");
  const strings = sharedName ? sharedStrings(strFromU8(files[sharedName])) : [];
  return sheetRows(strFromU8(files[sheetName]), strings);
}

export function readCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "," || ch === ";" || ch === "\t") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.trim());
      if (row.some((item) => item)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  row.push(cell.trim());
  if (row.some((item) => item)) rows.push(row);
  return rows;
}
