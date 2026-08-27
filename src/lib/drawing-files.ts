/** Допустимые форматы чертежей: PDF и CAD (DWG/DXF). */

export type DrawingExt = "pdf" | "dwg" | "dxf";

export function getDrawingExt(name: string): DrawingExt | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".dwg")) return "dwg";
  if (lower.endsWith(".dxf")) return "dxf";
  return null;
}

export function isCadExt(ext: DrawingExt | null | undefined): boolean {
  return ext === "dwg" || ext === "dxf";
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
    type === "application/x-dxf"
  );
}

export function mimeForExt(ext: DrawingExt): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "dwg") return "application/acad";
  return "application/dxf";
}

/** Собрать displayName из title + расширения исходного файла. */
export function resolveDisplayName(titleRaw: string, fileName: string): string {
  const ext = getDrawingExt(fileName) ?? "pdf";
  const title = titleRaw.trim();
  if (!title) return fileName;
  if (getDrawingExt(title)) return title;
  return `${title}.${ext}`;
}

export const DRAWING_ACCEPT =
  "application/pdf,.pdf,.dwg,.dxf,application/acad,image/vnd.dwg,application/dxf,image/vnd.dxf,.zip,application/zip,application/x-zip-compressed";

export const DRAWING_ACCEPT_HINT = "PDF, DWG, DXF или ZIP (PDF + DWG)";

/** Короткая подсказка в кнопках и drag-drop. */
export const UPLOAD_BUTTON_LABEL = "Загрузить для расшифровки";

/** Пояснение на пустом экране и в диалоге. */
export const UPLOAD_HELP_LINES = [
  "Один PDF или DWG — расшифровка этого файла.",
  "PDF и DWG вместе — выберите оба файла или ZIP-архив: текст из PDF, чертёж DWG для сверки.",
] as const;
