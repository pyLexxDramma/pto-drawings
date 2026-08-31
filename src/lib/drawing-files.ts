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

/** Собрать displayName из title + расширения исходного файла. */
export function resolveDisplayName(titleRaw: string, fileName: string): string {
  const ext = getDrawingExt(fileName) ?? "pdf";
  const title = titleRaw.trim();
  if (!title) return fileName;
  if (getDrawingExt(title)) return title;
  return `${title}.${ext}`;
}

export const DRAWING_ACCEPT =
  "application/pdf,.pdf,.dwg,.dxf,application/acad,image/vnd.dwg,application/dxf,image/vnd.dxf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.zip,application/zip,application/x-zip-compressed";

export const DRAWING_ACCEPT_HINT =
  "PDF, DWG, DXF, DOC/DOCX или ZIP (PDF + DWG)";

/** Короткая подсказка в кнопках и drag-drop. */
export const UPLOAD_BUTTON_LABEL = "Загрузить для расшифровки";

/** Пояснение на пустом экране и в диалоге. */
export const UPLOAD_HELP_LINES = [
  "PDF, DWG или .docx — через конвейер (таблицы и сводка комплекта).",
  "Старый .doc — разбор текста на фронте; лучше пересохранить в .docx.",
  "PDF и DWG вместе — оба файла или ZIP: текст из PDF, чертёж DWG для сверки.",
] as const;
