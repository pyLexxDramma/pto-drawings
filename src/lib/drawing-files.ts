/** Допустимые форматы: PDF, CAD (DWG/DXF) и Word (.doc/.docx). */

export type DrawingExt = "pdf" | "dwg" | "dxf" | "doc" | "docx";

export function getDrawingExt(name: string): DrawingExt | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".dwg")) return "dwg";
  if (lower.endsWith(".dxf")) return "dxf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".doc")) return "doc";
  return null;
}

export function isCadExt(ext: DrawingExt | null | undefined): boolean {
  return ext === "dwg" || ext === "dxf";
}

export function isOfficeExt(ext: DrawingExt | null | undefined): boolean {
  return ext === "doc" || ext === "docx";
}

export function isDrawingFile(file: { name: string; type?: string }): boolean {
  if (getDrawingExt(file.name)) return true;
  const type = (file.type ?? "").toLowerCase();
  return (
    type === "application/pdf" ||
    type === "application/x-pdf" ||
    type === "application/acad" ||
    type === "application/x-acad" ||
    type === "application/autocad_dwg" ||
    type === "image/vnd.dwg" ||
    type === "application/dxf" ||
    type === "image/vnd.dxf" ||
    type === "application/x-dxf" ||
    type === "application/msword" ||
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export function mimeForExt(ext: DrawingExt): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "dwg") return "application/acad";
  if (ext === "dxf") return "application/dxf";
  if (ext === "doc") return "application/msword";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

/** UTF-8 имя, ошибочно прочитанное как CP866 (коробки ░║ вместо кириллицы). */
let cp866EncodeMap: Map<number, number> | null = null;

function getCp866EncodeMap(): Map<number, number> {
  if (cp866EncodeMap) return cp866EncodeMap;
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const decoded = new TextDecoder("ibm866").decode(bytes);
  const map = new Map<number, number>();
  for (let i = 0; i < 256; i++) map.set(decoded.charCodeAt(i), i);
  cp866EncodeMap = map;
  return map;
}

function countBoxDrawing(s: string): number {
  return (s.match(/[\u2500-\u259F]/g) ?? []).length;
}

function countCyrillic(s: string): number {
  return (s.match(/[А-Яа-яЁё]/g) ?? []).length;
}

/** Восстановить UTF-8, если имя сохранили после decode(ibm866) поверх UTF-8 байт. */
function repairUtf8MisreadAsCp866(name: string): string | null {
  if (countBoxDrawing(name) < 2) return null;
  try {
    const map = getCp866EncodeMap();
    const bytes = new Uint8Array(name.length);
    for (let i = 0; i < name.length; i++) {
      const b = map.get(name.charCodeAt(i));
      if (b === undefined) return null;
      bytes[i] = b;
    }
    const fixed = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      countCyrillic(fixed) >= 2 &&
      countBoxDrawing(fixed) < countBoxDrawing(name) &&
      !fixed.includes("\uFFFD")
    ) {
      return fixed;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Имя для UI/хранилища: NFC (macOS отдаёт NFD) + починка известного CP866-mojibake.
 */
export function normalizeFileName(name: string): string {
  let s = name.normalize("NFC").trim();
  const repaired = repairUtf8MisreadAsCp866(s);
  if (repaired) s = repaired.normalize("NFC").trim();
  return s;
}

/** Собрать displayName из title + расширения исходного файла. */
export function resolveDisplayName(titleRaw: string, fileName: string): string {
  const safeFile = normalizeFileName(fileName);
  const ext = getDrawingExt(safeFile) ?? "pdf";
  const title = normalizeFileName(titleRaw);
  if (!title) return safeFile;
  if (getDrawingExt(title)) return title;
  return `${title}.${ext}`;
}

export const DRAWING_ACCEPT =
  "application/pdf,.pdf,.dwg,.dxf,application/acad,image/vnd.dwg,application/dxf,image/vnd.dxf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.zip,application/zip,application/x-zip-compressed";

export const DRAWING_ACCEPT_HINT =
  "PDF, DWG, DXF, DOC/DOCX или ZIP с файлами";

/** Короткая подсказка в кнопках и drag-drop. */
export const UPLOAD_BUTTON_LABEL = "Загрузить для расшифровки";

/** Пояснение на пустом экране и в диалоге. */
export const UPLOAD_HELP_LINES = [
  "PDF, DWG или .docx — через конвейер (таблицы и сводка комплекта).",
  "Старый .doc — разбор текста на фронте; лучше пересохранить в .docx.",
  "PDF и DWG вместе — оба файла или ZIP: текст из PDF, чертёж DWG для сверки.",
  "ZIP с пачкой файлов — распакуем и возьмём в работу каждый по отдельности.",
] as const;
