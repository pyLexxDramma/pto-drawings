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

export function extractDrawingKitFromZip(buffer: Buffer): DrawingKitFiles {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch {
    throw Object.assign(new Error("Не удалось распаковать ZIP"), { status: 400 });
  }

  let pdf: { name: string; buffer: Buffer } | null = null;
  let cad: DrawingKitFiles["cad"] | null = null;

  for (const [path, data] of Object.entries(entries)) {
    const name = baseName(path);
    if (!name) continue;
    const ext = getDrawingExt(name);
    if (!ext) continue;
    if (ext === "pdf") {
      if (pdf) {
        throw Object.assign(
          new Error("В архиве должен быть один PDF"),
          { status: 400 },
        );
      }
      pdf = { name, buffer: Buffer.from(data) };
      continue;
    }
    if (ext === "dwg" || ext === "dxf") {
      if (cad) {
        throw Object.assign(
          new Error("В архиве должен быть один DWG или DXF"),
          { status: 400 },
        );
      }
      cad = { name, buffer: Buffer.from(data), ext };
    }
  }

  if (!pdf) {
    throw Object.assign(new Error("В архиве не найден PDF"), { status: 400 });
  }
  if (!cad) {
    throw Object.assign(
      new Error("В архиве не найден DWG или DXF"),
      { status: 400 },
    );
  }

  return { pdf, cad };
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
