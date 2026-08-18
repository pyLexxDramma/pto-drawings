import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

const ON_VERCEL = Boolean(process.env.VERCEL);
const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const ROOT =
  process.env.DATA_ROOT || (ON_VERCEL ? "/tmp/pto" : process.cwd());
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");
const DB_BLOB = "pto/db.json";

function pdfBlobPath(storedName: string) {
  return `pto/uploads/${storedName}`;
}

export function blobConfigured() {
  return USE_BLOB;
}

export async function readDbText(): Promise<string | null> {
  if (USE_BLOB) {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: DB_BLOB, limit: 10 });
    const blob = blobs.find((item) => item.pathname === DB_BLOB);
    if (!blob) return null;
    const response = await fetch(blob.url);
    if (!response.ok) return null;
    return response.text();
  }

  try {
    return await readFile(DB_PATH, "utf8");
  } catch {
    return null;
  }
}

export async function writeDbText(json: string) {
  if (USE_BLOB) {
    const { put } = await import("@vercel/blob");
    await put(DB_BLOB, json, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_PATH, json, "utf8");
}

export async function writePdfBytes(storedName: string, buffer: Buffer) {
  if (USE_BLOB) {
    const { put } = await import("@vercel/blob");
    await put(pdfBlobPath(storedName), buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/pdf",
    });
    return;
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storedName), buffer);
}

export async function readPdfBytes(storedName: string): Promise<Buffer> {
  if (USE_BLOB) {
    const { list } = await import("@vercel/blob");
    const pathname = pdfBlobPath(storedName);
    const { blobs } = await list({ prefix: pathname, limit: 5 });
    const blob = blobs.find((item) => item.pathname === pathname);
    if (!blob) throw new Error("Файл не найден в хранилище");
    const response = await fetch(blob.url);
    if (!response.ok) throw new Error("Файл не найден в хранилище");
    return Buffer.from(await response.arrayBuffer());
  }

  return readFile(path.join(UPLOAD_DIR, storedName));
}

export async function deletePdfBytes(storedName: string) {
  if (USE_BLOB) {
    const { del, list } = await import("@vercel/blob");
    const pathname = pdfBlobPath(storedName);
    const { blobs } = await list({ prefix: pathname, limit: 5 });
    const blob = blobs.find((item) => item.pathname === pathname);
    if (blob) await del(blob.url);
    return;
  }

  try {
    await unlink(path.join(UPLOAD_DIR, storedName));
  } catch {
    // already missing
  }
}
