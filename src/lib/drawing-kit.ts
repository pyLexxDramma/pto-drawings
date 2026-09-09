import { unzipSync } from "fflate";
import {
  getDrawingExt,
  isCadExt,
  isDrawingFile,
  normalizeFileName,
  type DrawingExt,
} from "@/lib/drawing-files";

export type KitRole = DrawingExt;

export type DrawingKitFiles = {
  pdf: { name: string; buffer: Buffer };
  cad: { name: string; buffer: Buffer; ext: "dwg" | "dxf" };
};

const ZIP_MIMES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

export function isZipFile(file: { name: string; type?: string }): boolean {
  if (file.name.toLowerCase().endsWith(".zip")) return true;
  return ZIP_MIMES.has((file.type ?? "").toLowerCase());
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1] ?? path;
  if (name.startsWith("._") || name.startsWith(".")) return "";
  if (path.includes("__MACOSX/")) return "";
  return fixZipName(name);
}

/**
 * Имена в ZIP без UTF-8 flag: Windows Explorer → CP866, macOS → UTF-8.
 * Сначала пробуем UTF-8 (иначе кириллица ломается в «коробки»).
 */
function fixZipName(name: string): string {
  if (!/[\u0080-\u00FF]/.test(name)) return normalizeFileName(name);
  const bytes = Uint8Array.from(name, (ch) => ch.charCodeAt(0) & 0xff);
  try {
    const asUtf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[А-Яа-яЁёA-Za-z]/.test(asUtf8)) return normalizeFileName(asUtf8);
  } catch {
    /* не UTF-8 — ниже CP866 */
  }
  try {
    return normalizeFileName(new TextDecoder("ibm866").decode(bytes));
  } catch {
    return normalizeFileName(name);
  }
}

export type ZipEntry = { name: string; buffer: Buffer; ext: DrawingExt };

/**
 * Всё пригодное из архива, в порядке имён. Ограничения «один PDF на архив»
 * нет: инженеры кидают комплект целиком, и каждый файл идёт своим документом.
 */
export function extractDrawingFilesFromZip(buffer: Buffer): ZipEntry[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch {
    throw Object.assign(new Error("Не удалось распаковать ZIP"), { status: 400 });
  }

  const found: ZipEntry[] = [];
  for (const [path, data] of Object.entries(entries)) {
    const name = baseName(path);
    if (!name) continue;
    const ext = getDrawingExt(name);
    if (!ext) continue;
    if (data.byteLength === 0) continue;
    found.push({ name, buffer: Buffer.from(data), ext });
  }

  if (found.length === 0) {
    throw Object.assign(
      new Error("В архиве нет PDF, DWG, DXF или DOC/DOCX"),
      { status: 400 },
    );
  }

  return found.sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

/**
 * Комплект «чертёж + модель»: ровно один PDF и ровно один DWG/DXF. Если в
 * архиве больше файлов — это не комплект, а пачка, её грузим по одному.
 */
export function asDrawingKit(entries: ZipEntry[]): DrawingKitFiles | null {
  if (entries.length !== 2) return null;
  const pdf = entries.find((item) => item.ext === "pdf");
  const cad = entries.find((item) => item.ext === "dwg" || item.ext === "dxf");
  if (!pdf || !cad) return null;
  return {
    pdf: { name: pdf.name, buffer: pdf.buffer },
    cad: {
      name: cad.name,
      buffer: cad.buffer,
      ext: cad.ext as "dwg" | "dxf",
    },
  };
}

export function detectDrawingKitUpload(files: File[]): File[] | null {
  if (files.length !== 2) return null;
  let pdf: File | null = null;
  let cad: File | null = null;
  for (const file of files) {
    if (!isDrawingFile(file)) return null;
    const ext = getDrawingExt(file.name);
    if (!ext) return null;
    if (ext === "pdf") {
      if (pdf) return null;
      pdf = file;
    } else if (isCadExt(ext)) {
      if (cad) return null;
      cad = file;
    } else {
      return null;
    }
  }
  return pdf && cad ? [pdf, cad] : null;
}

export function kitLabelFromName(name: string): string {
  return name.replace(/\.(zip|pdf|dwg|dxf)$/i, "").trim() || name;
}
